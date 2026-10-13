import { engineSoundParams, type EngineSoundInput } from './soundParams';

/** Buffer de ruído branco de 2 s, compartilhado e em loop. */
export function noiseBuffer(ctx: BaseAudioContext, seconds = 2): AudioBuffer {
  const b = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
  const d = b.getChannelData(0);
  let s = 22222;
  for (let i = 0; i < d.length; i++) {
    s = (s * 1664525 + 1013904223) >>> 0;
    d[i] = (s / 4294967296) * 2 - 1;
  }
  return b;
}

function shaperCurve(): Float32Array<ArrayBuffer> {
  const n = 1024;
  const c = new Float32Array(new ArrayBuffer(n * 4));
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    // Saturação assimétrica leve: harmônicos pares dão "corpo" de motor.
    c[i] = Math.tanh(x * 1.8 + 0.15 * x * x);
  }
  return c;
}

/**
 * Motor de 4 cilindros por síntese aditiva: dente de serra + quadrada + sub, ruído de admissão,
 * waveshaper e passa-baixa dirigidos pela rotação/carga; assobio de turbo; blow-off e estouros.
 */
export class EngineSynth {
  readonly out: GainNode;
  private readonly saw: OscillatorNode;
  private readonly square: OscillatorNode;
  private readonly sub: OscillatorNode;
  private readonly whistle: OscillatorNode;
  private readonly gSaw: GainNode;
  private readonly gSq: GainNode;
  private readonly gSub: GainNode;
  private readonly gNoise: GainNode;
  private readonly pre: GainNode;
  private readonly lp: BiquadFilterNode;
  private readonly gWhistle: GainNode;
  private readonly master: GainNode;
  private readonly noise: AudioBuffer;
  private started = false;

  constructor(private readonly ctx: BaseAudioContext) {
    this.noise = noiseBuffer(ctx);
    this.out = ctx.createGain();
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.pre = ctx.createGain();
    const shaper = ctx.createWaveShaper();
    shaper.curve = shaperCurve();
    shaper.oversample = '2x';
    this.lp = ctx.createBiquadFilter();
    this.lp.type = 'lowpass';

    const osc = (type: OscillatorType) => {
      const o = ctx.createOscillator();
      o.type = type;
      return o;
    };
    this.saw = osc('sawtooth');
    this.square = osc('square');
    this.sub = osc('triangle');
    this.whistle = osc('sine');
    this.gSaw = ctx.createGain();
    this.gSq = ctx.createGain();
    this.gSub = ctx.createGain();
    this.gNoise = ctx.createGain();
    this.gWhistle = ctx.createGain();
    this.gWhistle.gain.value = 0;

    this.saw.connect(this.gSaw).connect(this.pre);
    this.square.connect(this.gSq).connect(this.pre);
    this.sub.connect(this.gSub).connect(this.pre);

    // Ruído de admissão passando por um passa-banda largo.
    const ns = ctx.createBufferSource();
    ns.buffer = this.noise;
    ns.loop = true;
    const nbp = ctx.createBiquadFilter();
    nbp.type = 'bandpass';
    nbp.frequency.value = 700;
    nbp.Q.value = 0.7;
    ns.connect(nbp).connect(this.gNoise).connect(this.pre);
    this.noiseSrc = ns;

    this.pre.connect(shaper).connect(this.lp).connect(this.master).connect(this.out);
    this.whistle.connect(this.gWhistle).connect(this.out);
  }

  private noiseSrc: AudioBufferSourceNode;

  start(): void {
    if (this.started) return;
    this.started = true;
    for (const o of [this.saw, this.square, this.sub, this.whistle]) o.start();
    this.noiseSrc.start();
  }

  /** Aplica o estado do motor (chamar a cada quadro). */
  update(input: EngineSoundInput): void {
    const p = engineSoundParams(input);
    const t = this.ctx.currentTime;
    const k = 0.035;
    this.saw.frequency.setTargetAtTime(p.f0, t, k);
    this.square.frequency.setTargetAtTime(p.f0 * 2, t, k);
    this.sub.frequency.setTargetAtTime(p.f0 * 0.5, t, k);
    this.whistle.frequency.setTargetAtTime(p.whistleFreq, t, 0.08);
    this.gSaw.gain.setTargetAtTime(p.gainSaw, t, k);
    this.gSq.gain.setTargetAtTime(p.gainSquare, t, k);
    this.gSub.gain.setTargetAtTime(p.gainSub, t, k);
    this.gNoise.gain.setTargetAtTime(p.gainNoise, t, k);
    this.pre.gain.setTargetAtTime(p.drive, t, k);
    this.lp.frequency.setTargetAtTime(p.cutoff, t, k);
    this.lp.Q.setTargetAtTime(p.q, t, k);
    this.master.gain.setTargetAtTime(p.master, t, k);
    this.gWhistle.gain.setTargetAtTime(p.whistleGain, t, 0.08);
  }

  private burst(freq: number, q: number, dur: number, gain: number, type: BiquadFilterType = 'bandpass', sweepTo?: number): void {
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    f.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    src.connect(f).connect(g).connect(this.out);
    src.start(t, Math.random());
    src.stop(t + dur + 0.05);
  }

  /** Blow-off do turbo: "psshh" agudo que cai de frequência. */
  blowOff(strength = 1): void {
    this.burst(5200, 1.2, 0.42, 0.22 * strength, 'bandpass', 1800);
    this.burst(2400, 0.6, 0.3, 0.12 * strength, 'highpass');
  }

  /** Estouro de escapamento: estalo grave com cauda curta. */
  pop(strength = 1): void {
    this.burst(520, 1.4, 0.11, 0.5 * strength, 'bandpass', 160);
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(95, t);
    o.frequency.exponentialRampToValueAtTime(40, t + 0.12);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.5 * strength, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
    o.connect(g).connect(this.out);
    o.start(t);
    o.stop(t + 0.18);
  }

  /** Batida na carroceria: baque grave. */
  thump(strength = 1): void {
    this.burst(180, 0.9, 0.22, 0.6 * Math.min(1.5, strength), 'lowpass', 60);
  }

  stop(): void {
    if (!this.started) return;
    for (const o of [this.saw, this.square, this.sub, this.whistle]) o.stop();
    this.noiseSrc.stop();
    this.started = false;
  }
}

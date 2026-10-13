import { noiseBuffer } from './engineSynth';

/**
 * Música do encontro: loop gerado (estilo phonk/synthwave, 128 BPM) tocado por um sequenciador de
 * agendamento antecipado. Sai por um PannerNode HRTF posicionado no palco, então a música some
 * conforme o jogador se afasta e vem de uma direção real.
 */
export class MeetMusic {
  readonly panner: PannerNode;
  readonly out: GainNode;
  private readonly lp: BiquadFilterNode;
  private readonly noise: AudioBuffer;
  private timer: number | null = null;
  private step = 0;
  private nextTime = 0;
  private readonly bpm = 128;

  // Progressão em lá menor: Am – F – C – G (notas MIDI da fundamental).
  private readonly roots = [45, 41, 48, 43];

  constructor(private readonly ctx: AudioContext, stage: { x: number; y: number; z: number }) {
    this.noise = noiseBuffer(ctx, 1);
    this.out = ctx.createGain();
    this.out.gain.value = 0.55;
    this.lp = ctx.createBiquadFilter();
    this.lp.type = 'lowpass';
    this.lp.frequency.value = 9000;
    this.panner = ctx.createPanner();
    this.panner.panningModel = 'HRTF';
    this.panner.distanceModel = 'inverse';
    this.panner.refDistance = 14;
    this.panner.rolloffFactor = 1.15;
    this.panner.maxDistance = 600;
    this.panner.positionX.value = stage.x;
    this.panner.positionY.value = stage.y;
    this.panner.positionZ.value = stage.z;
    this.out.connect(this.lp).connect(this.panner);
  }

  /** Conecta a saída (espacializada) a um destino. */
  connect(dest: AudioNode): void {
    this.panner.connect(dest);
  }

  /** Abafa a música à distância (absorção do ar). */
  setAirAbsorption(distance: number): void {
    const f = Math.max(1400, 9000 - distance * 22);
    this.lp.frequency.setTargetAtTime(f, this.ctx.currentTime, 0.2);
  }

  start(): void {
    if (this.timer !== null) return;
    this.nextTime = this.ctx.currentTime + 0.1;
    this.step = 0;
    this.timer = window.setInterval(() => this.schedule(), 40);
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private schedule(): void {
    const stepDur = 60 / this.bpm / 4; // semicolcheia
    while (this.nextTime < this.ctx.currentTime + 0.25) {
      this.playStep(this.step, this.nextTime);
      this.nextTime += stepDur;
      this.step = (this.step + 1) % 64;
    }
  }

  private playStep(step: number, t: number): void {
    const s = step % 16;
    const bar = Math.floor(step / 16) % 4;
    // Bumbo em 4x4 com síncope; caixa/palma no 2 e 4; chimbal em colcheias com swing.
    const kick = [0, 3, 6, 8, 11, 14].includes(s);
    if (kick) this.kick(t);
    if (s === 4 || s === 12) this.clap(t);
    if (s % 2 === 0) this.hat(t + (s % 4 === 2 ? 0.012 : 0), s % 4 === 2 ? 0.05 : 0.03);
    // 808: segue a fundamental do compasso, com pausa curta.
    const root = this.roots[bar]!;
    if ([0, 3, 8, 10, 14].includes(s)) this.bass(root, t, s === 0 ? 0.42 : 0.2);
    // Arpejo: tríade menor/maior, 16 avos.
    const minor = bar !== 2 && bar !== 3;
    const chord = minor ? [0, 3, 7, 12] : [0, 4, 7, 12];
    if (s % 2 === 1 || s % 4 === 0) this.lead(root + 24 + chord[(s >> 1) % 4]!, t, 0.13);
  }

  private env(node: AudioParam, t: number, peak: number, dur: number, attack = 0.004): void {
    node.setValueAtTime(0.0001, t);
    node.linearRampToValueAtTime(peak, t + attack);
    node.exponentialRampToValueAtTime(0.0001, t + dur);
  }

  private kick(t: number): void {
    const o = this.ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    const g = this.ctx.createGain();
    this.env(g.gain, t, 0.95, 0.26);
    o.connect(g).connect(this.out);
    o.start(t);
    o.stop(t + 0.3);
  }

  private clap(t: number): void {
    const n = this.ctx.createBufferSource();
    n.buffer = this.noise;
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 1700;
    f.Q.value = 0.9;
    const g = this.ctx.createGain();
    this.env(g.gain, t, 0.5, 0.17);
    n.connect(f).connect(g).connect(this.out);
    n.start(t, Math.random() * 0.5);
    n.stop(t + 0.2);
  }

  private hat(t: number, dur: number): void {
    const n = this.ctx.createBufferSource();
    n.buffer = this.noise;
    const f = this.ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = 7500;
    const g = this.ctx.createGain();
    this.env(g.gain, t, 0.17, dur, 0.002);
    n.connect(f).connect(g).connect(this.out);
    n.start(t, Math.random() * 0.5);
    n.stop(t + dur + 0.02);
  }

  private bass(midi: number, t: number, dur: number): void {
    const hz = 440 * 2 ** ((midi - 69) / 12);
    const o = this.ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(hz * 1.5, t);
    o.frequency.exponentialRampToValueAtTime(hz, t + 0.04);
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 520;
    const g = this.ctx.createGain();
    this.env(g.gain, t, 0.55, dur, 0.006);
    o.connect(f).connect(g).connect(this.out);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private lead(midi: number, t: number, dur: number): void {
    const hz = 440 * 2 ** ((midi - 69) / 12);
    const o = this.ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = hz;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(3200, t);
    f.frequency.exponentialRampToValueAtTime(700, t + dur);
    f.Q.value = 5;
    const g = this.ctx.createGain();
    this.env(g.gain, t, 0.12, dur, 0.004);
    o.connect(f).connect(g).connect(this.out);
    o.start(t);
    o.stop(t + dur + 0.03);
  }
}

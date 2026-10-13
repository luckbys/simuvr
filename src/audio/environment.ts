import { noiseBuffer } from './engineSynth';
import { tireSquealParams, windGain } from './soundParams';

/** Guincho de pneus (dois eixos), vento, rolagem e ambiente da cidade à noite. */
export class EnvironmentSound {
  readonly out: GainNode;
  private readonly ctx: BaseAudioContext;
  private readonly squealF: { g: GainNode; f: BiquadFilterNode };
  private readonly squealR: { g: GainNode; f: BiquadFilterNode };
  private readonly wind: GainNode;
  private readonly roll: GainNode;
  private readonly city: GainNode;
  private readonly rain: GainNode;
  private readonly sources: AudioBufferSourceNode[] = [];
  private started = false;

  constructor(ctx: BaseAudioContext) {
    this.ctx = ctx;
    const buf = noiseBuffer(ctx, 3);
    this.out = ctx.createGain();

    const loop = (): AudioBufferSourceNode => {
      const s = ctx.createBufferSource();
      s.buffer = buf;
      s.loop = true;
      this.sources.push(s);
      return s;
    };
    const band = (type: BiquadFilterType, freq: number, q: number): BiquadFilterNode => {
      const f = ctx.createBiquadFilter();
      f.type = type;
      f.frequency.value = freq;
      f.Q.value = q;
      return f;
    };
    const squeal = () => {
      const g = ctx.createGain();
      g.gain.value = 0;
      const f = band('bandpass', 1400, 5);
      loop().connect(f).connect(g).connect(this.out);
      return { g, f };
    };
    this.squealF = squeal();
    this.squealR = squeal();

    this.wind = ctx.createGain();
    this.wind.gain.value = 0;
    loop().connect(band('lowpass', 900, 0.5)).connect(this.wind).connect(this.out);

    this.roll = ctx.createGain();
    this.roll.gain.value = 0;
    loop().connect(band('lowpass', 260, 0.7)).connect(this.roll).connect(this.out);

    // Cidade: rumor grave constante + "chiado" distante.
    this.city = ctx.createGain();
    this.city.gain.value = 0.06;
    const c1 = loop();
    c1.connect(band('lowpass', 120, 0.6)).connect(this.city).connect(this.out);
    const c2 = loop();
    const cg = ctx.createGain();
    cg.gain.value = 0.012;
    c2.connect(band('bandpass', 2400, 0.4)).connect(cg).connect(this.out);

    this.rain = ctx.createGain();
    this.rain.gain.value = 0;
    loop().connect(band('highpass', 3000, 0.3)).connect(this.rain).connect(this.out);
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    let off = 0;
    for (const s of this.sources) s.start(0, (off += 0.37) % 2);
  }

  update(i: {
    speedKmh: number; slipFront: number; slipRear: number; onGround: boolean; wet: boolean; insideCar: boolean; rain: boolean; surfaceRough: number;
  }): void {
    const t = this.ctx.currentTime;
    const sf = tireSquealParams({ slip: i.slipFront, speedKmh: i.speedKmh, onGround: i.onGround, wet: i.wet });
    const sr = tireSquealParams({ slip: i.slipRear, speedKmh: i.speedKmh, onGround: i.onGround, wet: i.wet });
    this.squealF.g.gain.setTargetAtTime(sf.gain, t, 0.04);
    this.squealF.f.frequency.setTargetAtTime(sf.freq * 1.12, t, 0.05);
    this.squealF.f.Q.setTargetAtTime(sf.q, t, 0.05);
    this.squealR.g.gain.setTargetAtTime(sr.gain, t, 0.04);
    this.squealR.f.frequency.setTargetAtTime(sr.freq, t, 0.05);
    this.squealR.f.Q.setTargetAtTime(sr.q, t, 0.05);
    this.wind.gain.setTargetAtTime(windGain({ speedKmh: i.speedKmh, insideCar: i.insideCar }), t, 0.1);
    const v = Math.min(1, i.speedKmh / 120);
    this.roll.gain.setTargetAtTime((i.onGround ? 0.05 + 0.2 * v : 0) * (i.wet ? 1.25 : 1) * (1 + i.surfaceRough * 0.4), t, 0.1);
    this.rain.gain.setTargetAtTime(i.rain ? (i.insideCar ? 0.03 : 0.06) : 0, t, 0.5);
  }

  stop(): void {
    if (!this.started) return;
    for (const s of this.sources) s.stop();
    this.started = false;
  }
}

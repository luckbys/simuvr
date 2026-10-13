import { clamp, lerp, smoothstep } from './math';

export interface GearboxSpec {
  /** Relações de 1ª em diante. */
  ratios: ReadonlyArray<number>;
  reverse: number;
  finalDrive: number;
  /** Rendimento da transmissão (0..1). */
  efficiency: number;
  /** Duração do corte de torque na troca (s). */
  shiftTimeAuto: number;
  shiftTimeManual: number;
}

export interface GearboxContext {
  rpm: number;
  throttle: number;
  brake: number;
  /** Velocidade longitudinal com sinal (m/s, + = para frente). */
  speed: number;
  limiterRpm: number;
  idleRpm: number;
}

/**
 * Câmbio com modo automático (com override manual) e embreagem comandada.
 * `gear`: -1 ré, 0 neutro, 1..n marchas à frente.
 */
export class Gearbox {
  gear = 1;
  auto = true;
  /** Tempo restante de troca (s). Durante a troca o motor fica desacoplado. */
  shiftTimer = 0;
  private shiftDuration = 0.2;
  private sinceShift = 10;
  private reverseHold = 0;
  /** Pulso: marcha mudou neste passo (para áudio/visual). */
  shifted = false;

  constructor(public spec: GearboxSpec) {}

  get topGear(): number {
    return this.spec.ratios.length;
  }

  /** Relação total (marcha × final), com sinal: ré é negativa. */
  get totalRatio(): number {
    if (this.gear === 0) return 0;
    const g = this.gear < 0 ? -this.spec.reverse : this.spec.ratios[this.gear - 1]!;
    return g * this.spec.finalDrive;
  }

  ratioFor(gear: number): number {
    if (gear === 0) return 0;
    const g = gear < 0 ? -this.spec.reverse : this.spec.ratios[gear - 1]!;
    return g * this.spec.finalDrive;
  }

  /** Marcha manual: +1 sobe, -1 desce. Sai do neutro/ré de forma intuitiva. */
  shift(dir: 1 | -1, manual: boolean): void {
    let g = this.gear + dir;
    if (this.gear === -1 && dir === 1) g = 0;
    else if (this.gear === 0) g = dir === 1 ? 1 : -1;
    g = clamp(g, -1, this.topGear);
    if (g === this.gear) return;
    this.setGear(g, manual ? this.spec.shiftTimeManual : this.spec.shiftTimeAuto);
  }

  private setGear(g: number, duration: number): void {
    this.gear = g;
    this.shiftDuration = duration;
    this.shiftTimer = duration;
    this.sinceShift = 0;
    this.shifted = true;
  }

  /** Engajamento da embreagem (0 = aberta, 1 = fechada) vindo do câmbio. */
  get shiftEngage(): number {
    if (this.shiftTimer <= 0) return 1;
    // Aberta na primeira metade da troca, fecha suavemente na segunda.
    const p = 1 - this.shiftTimer / this.shiftDuration;
    return smoothstep(0.45, 1, p);
  }

  update(dt: number, c: GearboxContext): void {
    this.shifted = false;
    this.sinceShift += dt;
    if (this.shiftTimer > 0) this.shiftTimer = Math.max(0, this.shiftTimer - dt);
    if (!this.auto) return;

    const { rpm, throttle, brake, speed } = c;

    // Ré/frente automáticos quando o carro está praticamente parado.
    if (Math.abs(speed) < 0.7 && this.shiftTimer <= 0) {
      if (this.gear >= 0 && brake > 0.1 && throttle < 0.05) {
        this.reverseHold += dt;
        if (this.reverseHold > 0.3) this.setGear(-1, 0.15);
      } else if (this.gear < 0 && throttle > 0.1 && brake < 0.05) {
        this.reverseHold += dt;
        if (this.reverseHold > 0.2) this.setGear(1, 0.15);
      } else {
        this.reverseHold = 0;
      }
    } else {
      this.reverseHold = 0;
    }
    if (this.gear <= 0) {
      if (this.gear === 0 && throttle > 0.1) this.setGear(1, 0.12);
      return;
    }
    if (this.shiftTimer > 0 || this.sinceShift < 0.55) return;

    const n = this.topGear;
    const up = lerp(c.limiterRpm * 0.52, c.limiterRpm * 0.93, smoothstep(0.1, 1, throttle));
    const down = lerp(c.idleRpm + 700, c.limiterRpm * 0.5, smoothstep(0.1, 1, throttle));

    if (this.gear < n && rpm > up) {
      this.shift(1, false);
      return;
    }
    if (this.gear > 1 && rpm < down) {
      // Só reduz se a rotação resultante ainda couber abaixo do limitador.
      const after = (rpm * this.ratioFor(this.gear - 1)) / this.ratioFor(this.gear);
      if (after < c.limiterRpm * 0.9) this.shift(-1, false);
    }
  }
}

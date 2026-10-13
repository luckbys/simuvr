import { Curve, clamp, expFactor, smoothstep } from './math';

export interface TurboSpec {
  /** Pressão máxima (bar). 0 = aspirado. */
  maxBoost: number;
  /** Tempo de resposta com a rotação plena (s). */
  lag: number;
  /** RPM em que o turbo começa a encher e em que atinge pressão plena. */
  spoolStartRpm: number;
  spoolFullRpm: number;
  /** Ganho de torque por bar (≈ 0.9: o ar admitido cresce com (1 + boost)). */
  torqueGain: number;
}

export interface EngineSpec {
  idleRpm: number;
  redlineRpm: number;
  limiterRpm: number;
  /** Inércia do volante e eixo de manivelas (kg·m²). */
  inertia: number;
  /** Curva de torque líquido a plena carga, aspirada (rpm → N·m). */
  torqueCurve: ReadonlyArray<readonly [number, number]>;
  /** Perdas por atrito/bombeamento: base + coef · rpm/1000 (N·m). */
  frictionBase: number;
  frictionPerKrpm: number;
  /** Multiplicador global de potência (ECU, escape, admissão). */
  powerScale: number;
  turbo: TurboSpec;
}

export const RPM_TO_RADS = (2 * Math.PI) / 60;
export const RADS_TO_RPM = 60 / (2 * Math.PI);

export class Engine {
  private curve: Curve;
  /** Corte de combustível ativo (limitador de giro). */
  fuelCut = false;

  constructor(public spec: EngineSpec) {
    this.curve = new Curve(spec.torqueCurve);
  }

  setSpec(spec: EngineSpec): void {
    this.spec = spec;
    this.curve = new Curve(spec.torqueCurve);
  }

  /** Torque líquido aspirado a plena carga. */
  wotTorque(rpm: number): number {
    return this.curve.eval(rpm) * this.spec.powerScale;
  }

  frictionTorque(rpm: number): number {
    return this.spec.frictionBase + this.spec.frictionPerKrpm * (rpm / 1000);
  }

  /**
   * Torque de saída do motor (N·m). `boost` em bar. Aceleração fechada dá freio-motor.
   * O limitador corta combustível com histerese.
   */
  torque(rpm: number, throttle: number, boost: number): number {
    const s = this.spec;
    if (rpm >= s.limiterRpm) this.fuelCut = true;
    else if (rpm < s.limiterRpm - 350) this.fuelCut = false;

    // Controle de marcha lenta: impede o motor de morrer.
    let t = clamp(throttle, 0, 1);
    if (rpm < s.idleRpm + 250) t = Math.max(t, clamp(0.07 + (s.idleRpm - rpm) / 500, 0, 0.6));
    if (this.fuelCut) t = 0;

    const loss = this.frictionTorque(rpm);
    const wot = this.wotTorque(rpm) * (1 + s.turbo.torqueGain * boost);
    return t * (wot + loss) - loss;
  }
}

/** Turbo com lag: pressão sobe com a rotação e a carga, cai ao aliviar; gera evento de blow-off. */
export class Turbo {
  boost = 0;
  /** Pulso de um passo quando o acelerador é fechado com pressão alta. */
  blowOff = false;
  private prevThrottle = 0;

  constructor(public spec: TurboSpec) {}

  update(dt: number, rpm: number, throttle: number): void {
    const s = this.spec;
    this.blowOff = false;
    if (s.maxBoost <= 0) {
      this.boost = 0;
      return;
    }
    const spool = smoothstep(s.spoolStartRpm, s.spoolFullRpm, rpm);
    const target = s.maxBoost * spool * Math.pow(clamp(throttle, 0, 1), 0.9);
    const rising = target > this.boost;
    // Com rotação alta o turbo responde mais rápido.
    const tau = rising ? s.lag * (1.25 - 0.8 * smoothstep(s.spoolStartRpm, s.spoolFullRpm, rpm)) : 0.28;
    this.boost += (target - this.boost) * expFactor(dt, tau);

    if (this.prevThrottle > 0.5 && throttle < 0.2 && this.boost > 0.25 * s.maxBoost) this.blowOff = true;
    this.prevThrottle = throttle;
  }

  /** Fração da pressão máxima (0..1), útil para HUD e áudio. */
  get ratio(): number {
    return this.spec.maxBoost > 0 ? this.boost / this.spec.maxBoost : 0;
  }
}

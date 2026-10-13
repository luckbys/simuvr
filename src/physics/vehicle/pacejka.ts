import { clamp, smoothstep } from './math';

/**
 * Magic Formula de Pacejka normalizada: devolve ~[-1, 1] com pico 1 em x = x*.
 * f(x) = sin(C · atan(Bx − E(Bx − atan(Bx))))
 */
export function magicFormula(x: number, B: number, C: number, E: number): number {
  const bx = B * x;
  return Math.sin(C * Math.atan(bx - E * (bx - Math.atan(bx))));
}

/**
 * Acha o B que coloca o pico da curva normalizada em `peakX`.
 * No pico, C·atan(Bx − E(Bx − atan Bx)) = π/2.
 */
export function solveB(peakX: number, C: number, E: number): number {
  const target = Math.tan(Math.PI / (2 * C));
  let lo = 1e-3;
  let hi = 1e3;
  for (let i = 0; i < 80; i++) {
    const B = Math.sqrt(lo * hi);
    const bx = B * peakX;
    const arg = bx - E * (bx - Math.atan(bx));
    if (arg < target) lo = B;
    else hi = B;
  }
  return Math.sqrt(lo * hi);
}

export interface TireParams {
  /** Coeficiente de atrito de pico na carga nominal. */
  mu: number;
  /** Queda do atrito por unidade de carga relativa acima da nominal (sensibilidade à carga). */
  muLoadSens: number;
  /** Carga nominal (N). */
  nominalLoad: number;
  /** Escorregamento longitudinal do pico. */
  peakSlipRatio: number;
  /** Ângulo de deriva do pico (rad). */
  peakSlipAngle: number;
  /** Forma da curva (C ≈ 1.3–1.5 dá queda suave após o pico, bom para drift). */
  C: number;
  E: number;
  /** Relação entre atrito lateral e longitudinal. */
  lateralRatio: number;
  /** Comprimento de relaxamento lateral (m). */
  relaxLength: number;
  /** Trilha pneumática no ângulo zero (m), base do torque auto-alinhante. */
  pneumaticTrail: number;
  /** Coeficiente de resistência ao rolamento. */
  rollingResistance: number;
}

export interface TireOut {
  /** Força longitudinal no sentido do pneu (+ = empurra o carro para frente). */
  fx: number;
  /** Força lateral (+ = para a direita). */
  fy: number;
  /** Torque auto-alinhante em torno do eixo vertical (N·m). */
  mz: number;
  /** Escorregamento longitudinal e ângulo de deriva efetivos. */
  kappa: number;
  alpha: number;
  /** Escorregamento combinado normalizado (1 = pico de aderência). */
  rho: number;
}

export function makeTireOut(): TireOut {
  return { fx: 0, fy: 0, mz: 0, kappa: 0, alpha: 0, rho: 0 };
}

/** Velocidades de referência para regularizar o escorregamento perto de zero. */
const V_REF_LONG = 3.0;
const V_REF_LAT = 1.5;
/** Faixa de velocidade do contato em que o modelo viscoso de baixa velocidade assume. */
const LOW_V0 = 0.6;
const LOW_V1 = 2.4;
/** Velocidade de escorregamento em que o atrito viscoso satura (m/s). */
const LOW_V_SAT = 0.25;

/**
 * Modelo de pneu: Magic Formula com escorregamento combinado normalizado
 * (círculo/elipse de atrito), sensibilidade à carga, relaxamento lateral e um
 * modelo viscoso para velocidades baixas (evita tremor e deslize com o carro parado).
 */
export class TireModel {
  readonly B: number;

  constructor(public p: TireParams) {
    this.B = solveB(1, p.C, p.E);
  }

  /** Atrito de pico disponível à carga `fz` (antes das escalas de superfície/camber). */
  muAt(fz: number): number {
    const rel = fz / this.p.nominalLoad - 1;
    const f = clamp(1 - this.p.muLoadSens * rel, 0.55, 1.35);
    return this.p.mu * f;
  }

  /** Ângulo de deriva instantâneo (sem filtro), com regularização em baixa velocidade. */
  slipAngle(vlong: number, vlat: number): number {
    return Math.atan2(vlat, Math.abs(vlong) + V_REF_LAT);
  }

  /** Atualiza o ângulo de deriva filtrado (relaxamento) e o devolve. */
  relax(alphaF: number, vlong: number, vlat: number, dt: number): number {
    const target = this.slipAngle(vlong, vlat);
    const rate = (Math.abs(vlong) + 1.0) / Math.max(this.p.relaxLength, 0.05);
    return alphaF + (target - alphaF) * (1 - Math.exp(-dt * rate));
  }

  /**
   * Calcula as forças no plano de contato.
   * @param vlong velocidade do ponto de contato ao longo do pneu (m/s)
   * @param vlat  velocidade lateral do ponto de contato (m/s, + = direita)
   * @param omegaR velocidade periférica da roda ω·R (m/s)
   * @param alphaF ângulo de deriva já filtrado
   * @param muScale escala total de atrito (superfície × composto × temperatura)
   * @param latScale escala adicional do atrito lateral (camber)
   * @param longScale escala adicional do atrito longitudinal (camber)
   */
  force(
    out: TireOut,
    vlong: number,
    vlat: number,
    omegaR: number,
    fz: number,
    alphaF: number,
    muScale: number,
    latScale: number,
    longScale: number,
  ): void {
    if (fz <= 0) {
      out.fx = out.fy = out.mz = out.kappa = out.alpha = out.rho = 0;
      return;
    }
    const p = this.p;
    const muPeak = this.muAt(fz) * muScale * fz;
    const muX = muPeak * longScale;
    const muY = muPeak * p.lateralRatio * latScale;

    // Escorregamento longitudinal (positivo = roda mais rápida que o chão → tração).
    const kappa = (omegaR - vlong) / Math.max(Math.abs(vlong), V_REF_LONG);
    const kn = kappa / p.peakSlipRatio;
    const an = alphaF / p.peakSlipAngle;
    const rho = Math.hypot(kn, an);

    let fx = 0;
    let fy = 0;
    if (rho > 1e-9) {
      const f = magicFormula(rho, this.B, p.C, p.E);
      fx = muX * f * (kn / rho);
      fy = -muY * f * (an / rho);
    }

    // Modelo viscoso para baixa velocidade: força proporcional ao deslizamento do contato.
    const speed = Math.hypot(vlong, vlat);
    const wLow = 1 - smoothstep(LOW_V0, LOW_V1, speed);
    if (wLow > 0) {
      const kFx = muX / LOW_V_SAT;
      const kFy = muY / LOW_V_SAT;
      const lx = clamp(kFx * (omegaR - vlong), -muX, muX);
      const ly = clamp(-kFy * vlat, -muY, muY);
      fx = fx * (1 - wLow) + lx * wLow;
      fy = fy * (1 - wLow) + ly * wLow;
    }

    // Limite do elipse de atrito no resultado final.
    const nx = muX > 0 ? fx / muX : 0;
    const ny = muY > 0 ? fy / muY : 0;
    const m = Math.hypot(nx, ny);
    if (m > 1) {
      fx /= m;
      fy /= m;
    }

    out.fx = fx;
    out.fy = fy;
    out.kappa = kappa;
    out.alpha = alphaF;
    out.rho = rho;
    // A trilha pneumática some conforme o pneu satura (direção fica leve no drift).
    const trail = p.pneumaticTrail * clamp(1 - 0.75 * Math.abs(an), 0, 1);
    out.mz = -fy * trail;
  }
}

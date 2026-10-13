/**
 * Modelo puro do volante agarrável em VR (sem three nem WebXR, testável em Node).
 *
 * As mãos chegam já no referencial do volante: x = direita do motorista (3 horas), y = cima
 * (12 horas), z = normal do aro apontando para o motorista. O ângulo é medido no sentido
 * horário visto pelo motorista; positivo = esterçar para a direita.
 */

export interface HandSample {
  /** Identificador estável da mão ('left' | 'right'). */
  id: string;
  x: number;
  y: number;
  z: number;
  /** Botão de grip pressionado. */
  gripping: boolean;
}

export interface WheelGrabOptions {
  /** Raio do aro (m). */
  radius: number;
  /** Distância máxima mão→aro para agarrar (m). */
  grabTolerance: number;
  /** Distância da mão ao aro em que ela solta sozinha (m). */
  releaseDistance: number;
  /** Rotação total de batente a batente (rad). */
  lockToLock: number;
}

export const DEFAULT_WHEEL: WheelGrabOptions = {
  radius: 0.18,
  grabTolerance: 0.11,
  releaseDistance: 0.32,
  lockToLock: (540 * Math.PI) / 180,
};

const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));

interface Held {
  prevAngle: number;
}

export class WheelGrabModel {
  /** Ângulo do volante (rad, + = horário). */
  angle = 0;
  private readonly held = new Map<string, Held>();
  private readonly wasGripping = new Map<string, boolean>();
  /** Pulso: uma mão agarrou/soltou neste passo (para haptics). */
  grabbedNow: string | null = null;
  releasedNow: string | null = null;

  constructor(public opts: WheelGrabOptions = { ...DEFAULT_WHEEL }) {}

  get maxAngle(): number {
    return this.opts.lockToLock / 2;
  }

  /** Esterço normalizado -1..1. */
  get steer(): number {
    return Math.max(-1, Math.min(1, this.angle / this.maxAngle));
  }

  get isHeld(): boolean {
    return this.held.size > 0;
  }

  heldBy(id: string): boolean {
    return this.held.has(id);
  }

  reset(): void {
    this.angle = 0;
    this.held.clear();
    this.wasGripping.clear();
  }

  /** Distância da mão ao aro (m). */
  ringDistance(h: HandSample): number {
    const planar = Math.hypot(h.x, h.y);
    return Math.hypot(planar - this.opts.radius, h.z);
  }

  /** Ângulo horário da mão em torno do centro (0 = 12 horas). */
  handAngle(h: HandSample): number {
    return Math.atan2(h.x, h.y);
  }

  /**
   * Avança um passo. `returnRate` (1/s) leva o volante ao centro quando solto; é maior em
   * velocidade (auto-alinhamento) e ~0 parado.
   */
  update(dt: number, hands: ReadonlyArray<HandSample>, returnRate: number): void {
    this.grabbedNow = this.releasedNow = null;
    for (const h of hands) {
      const was = this.wasGripping.get(h.id) ?? false;
      this.wasGripping.set(h.id, h.gripping);
      const holding = this.held.has(h.id);
      if (h.gripping && !was && !holding && this.ringDistance(h) <= this.opts.grabTolerance) {
        this.held.set(h.id, { prevAngle: this.handAngle(h) });
        this.grabbedNow = h.id;
      } else if (holding && (!h.gripping || this.ringDistance(h) > this.opts.releaseDistance)) {
        this.held.delete(h.id);
        this.releasedNow = h.id;
      }
    }
    // Mãos que sumiram (controle desconectado) soltam o volante.
    for (const id of [...this.held.keys()]) {
      if (!hands.some((h) => h.id === id)) {
        this.held.delete(id);
        this.releasedNow = id;
      }
    }

    if (this.held.size > 0) {
      let sum = 0;
      for (const h of hands) {
        const st = this.held.get(h.id);
        if (!st) continue;
        const a = this.handAngle(h);
        sum += wrap(a - st.prevAngle);
        st.prevAngle = a;
      }
      // Duas mãos: média do giro de cada uma (sem duplicar a rotação).
      this.angle += sum / this.held.size;
    } else if (returnRate > 0) {
      this.angle *= Math.exp(-returnRate * dt);
      if (Math.abs(this.angle) < 1e-4) this.angle = 0;
    }
    // Batente: o aro não passa do fim de curso; as mãos continuam livres para voltar.
    const m = this.maxAngle;
    if (this.angle > m) this.angle = m;
    else if (this.angle < -m) this.angle = -m;
  }
}

/** Taxa de retorno do volante ao centro: ~0 parado, forte em velocidade (auto-alinhamento). */
export function wheelReturnRate(speedMs: number, feedbackNorm = 0): number {
  const v = Math.min(Math.abs(speedMs), 30);
  return 0.15 + (v / 30) * 4.2 + Math.min(1.5, Math.abs(feedbackNorm) * 2);
}

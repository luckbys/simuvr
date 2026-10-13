import { clamp } from './math';

export type DiffType = 'open' | 'lsd1' | 'lsd2' | 'locked';

export interface DiffSpec {
  /** Pré-carga do pacote de embreagens (N·m). */
  preload: number;
  /** Fração do torque de entrada que vira travamento em aceleração / em desaceleração. */
  powerLock: number;
  coastLock: number;
  /** Torque de travamento máximo (N·m). */
  maxLock: number;
  /** Largura (rad/s) da transição do travamento com a diferença de rotação. */
  width: number;
}

export interface DiffPreset {
  type: DiffType;
  label: string;
  powerLock: number;
  coastLock: number;
  preload: number;
  maxLock: number;
}

export const DIFF_PRESETS: Record<DiffType, DiffPreset> = {
  open: { type: 'open', label: 'Aberto', powerLock: 0, coastLock: 0, preload: 0, maxLock: 0 },
  lsd1: { type: 'lsd1', label: 'LSD 1 via', powerLock: 0.45, coastLock: 0.02, preload: 40, maxLock: 1200 },
  lsd2: { type: 'lsd2', label: 'LSD 2 vias', powerLock: 0.55, coastLock: 0.45, preload: 60, maxLock: 1500 },
  locked: { type: 'locked', label: 'Travado (drift)', powerLock: 1, coastLock: 1, preload: 400, maxLock: 4000 },
};

/** Torque de travamento (N·m, ≥ 0) que o pacote de embreagens pode aplicar. */
export function lockMagnitude(d: DiffSpec, pinionTorque: number): number {
  const ramp = pinionTorque >= 0 ? d.powerLock : d.coastLock;
  return clamp(d.preload + ramp * Math.abs(pinionTorque), 0, d.maxLock);
}

/**
 * Torque que passa da roda mais rápida para a mais lenta, e sua derivada em relação à
 * diferença de rotação `dw = ωL − ωR` (usada na integração implícita).
 */
export function lockTorque(
  d: DiffSpec,
  pinionTorque: number,
  dw: number,
  out: { lk: number; slope: number } = { lk: 0, slope: 0 },
): { lk: number; slope: number } {
  const mag = lockMagnitude(d, pinionTorque);
  if (mag <= 0) {
    out.lk = 0;
    out.slope = 0;
    return out;
  }
  const th = Math.tanh(dw / d.width);
  out.lk = mag * th;
  out.slope = (mag / d.width) * (1 - th * th);
  return out;
}

import { clamp } from './math';

export interface SuspensionSpec {
  /** Rigidez da mola (N/m). */
  k: number;
  /** Amortecimento em compressão / extensão (N·s/m). */
  cBump: number;
  cRebound: number;
  /** Rigidez da barra estabilizadora (N/m de diferença de compressão entre as rodas do eixo). */
  arb: number;
  /** Comprimento máximo (extensão total) do ponto de fixação ao centro da roda (m). */
  lengthMax: number;
  /** Curso total (m). */
  travel: number;
  /** Rigidez do batente de compressão (N/m) e distância do fim do curso em que começa (m). */
  bumpStopK: number;
  bumpStopRange: number;
}

/**
 * Força da suspensão (N, ≥ 0) para compressão `x` (m, 0 = totalmente estendida) e
 * velocidade de compressão `v` (m/s, + = comprimindo). Inclui batente progressivo.
 */
export function suspensionForce(s: SuspensionSpec, x: number, v: number): number {
  const xc = clamp(x, 0, s.travel);
  let f = s.k * xc + (v > 0 ? s.cBump : s.cRebound) * v;
  const into = xc - (s.travel - s.bumpStopRange);
  if (into > 0) f += s.bumpStopK * into * into / s.bumpStopRange;
  return Math.max(0, f);
}

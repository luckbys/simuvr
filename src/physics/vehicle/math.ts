export const clamp = (x: number, a: number, b: number): number => (x < a ? a : x > b ? b : x);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const sign = (x: number): number => (x < 0 ? -1 : 1);

export function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

/** Fator de suavização exponencial independente do passo: x += (alvo - x) * expFactor(dt, tau). */
export const expFactor = (dt: number, tau: number): number => 1 - Math.exp(-dt / Math.max(tau, 1e-6));

/** Curva suave por Hermite cúbico com tangentes de Catmull-Rom (pontos ordenados em x). */
export class Curve {
  private readonly xs: number[];
  private readonly ys: number[];
  private readonly ms: number[];

  constructor(points: ReadonlyArray<readonly [number, number]>) {
    this.xs = points.map((p) => p[0]);
    this.ys = points.map((p) => p[1]);
    const n = this.xs.length;
    this.ms = new Array<number>(n).fill(0);
    for (let i = 0; i < n; i++) {
      const i0 = Math.max(0, i - 1);
      const i1 = Math.min(n - 1, i + 1);
      const dx = this.xs[i1]! - this.xs[i0]!;
      this.ms[i] = dx > 0 ? (this.ys[i1]! - this.ys[i0]!) / dx : 0;
    }
  }

  eval(x: number): number {
    const { xs, ys, ms } = this;
    const n = xs.length;
    if (x <= xs[0]!) return ys[0]!;
    if (x >= xs[n - 1]!) return ys[n - 1]!;
    let i = 0;
    while (i < n - 2 && x > xs[i + 1]!) i++;
    const x0 = xs[i]!;
    const h = xs[i + 1]! - x0;
    const t = (x - x0) / h;
    const t2 = t * t;
    const t3 = t2 * t;
    return (
      (2 * t3 - 3 * t2 + 1) * ys[i]! +
      (t3 - 2 * t2 + t) * h * ms[i]! +
      (-2 * t3 + 3 * t2) * ys[i + 1]! +
      (t3 - t2) * h * ms[i + 1]!
    );
  }
}

/**
 * Resolve o sistema 3x3 `A x = b` (A em ordem de linha, 9 elementos) por eliminação de Gauss
 * com pivotamento parcial. Escreve em `out`. Devolve false se for singular.
 */
export function solve3(A: ArrayLike<number>, b: ArrayLike<number>, out: number[]): boolean {
  let a00 = A[0]!, a01 = A[1]!, a02 = A[2]!, b0 = b[0]!;
  let a10 = A[3]!, a11 = A[4]!, a12 = A[5]!, b1 = b[1]!;
  let a20 = A[6]!, a21 = A[7]!, a22 = A[8]!, b2 = b[2]!;

  // pivô da coluna 0
  if (Math.abs(a10) > Math.abs(a00) && Math.abs(a10) >= Math.abs(a20)) {
    [a00, a10] = [a10, a00]; [a01, a11] = [a11, a01]; [a02, a12] = [a12, a02]; [b0, b1] = [b1, b0];
  } else if (Math.abs(a20) > Math.abs(a00)) {
    [a00, a20] = [a20, a00]; [a01, a21] = [a21, a01]; [a02, a22] = [a22, a02]; [b0, b2] = [b2, b0];
  }
  if (Math.abs(a00) < 1e-12) return false;
  let f = a10 / a00;
  a11 -= f * a01; a12 -= f * a02; b1 -= f * b0;
  f = a20 / a00;
  a21 -= f * a01; a22 -= f * a02; b2 -= f * b0;

  // pivô da coluna 1
  if (Math.abs(a21) > Math.abs(a11)) {
    [a11, a21] = [a21, a11]; [a12, a22] = [a22, a12]; [b1, b2] = [b2, b1];
  }
  if (Math.abs(a11) < 1e-12) return false;
  f = a21 / a11;
  a22 -= f * a12; b2 -= f * b1;
  if (Math.abs(a22) < 1e-12) return false;

  const x2 = b2 / a22;
  const x1 = (b1 - a12 * x2) / a11;
  const x0 = (b0 - a01 * x1 - a02 * x2) / a00;
  out[0] = x0; out[1] = x1; out[2] = x2;
  return true;
}

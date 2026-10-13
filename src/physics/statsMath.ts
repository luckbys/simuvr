/** Interpolação linear simples da curva de torque (suficiente para estatísticas). */
export class Curve {
  constructor(private readonly pts: ReadonlyArray<readonly [number, number]>) {}
  eval(x: number): number {
    const p = this.pts;
    if (x <= p[0]![0]) return p[0]![1];
    for (let i = 1; i < p.length; i++) {
      if (x <= p[i]![0]) {
        const [x0, y0] = p[i - 1]!;
        const [x1, y1] = p[i]!;
        return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
      }
    }
    return p[p.length - 1]![1];
  }
}
/** rad/s → rpm. */
export const RADS_TO_RPM_FACTOR = 60 / (2 * Math.PI);

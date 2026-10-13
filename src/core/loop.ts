/**
 * Passo fixo com acumulador. A renderização recebe `alpha` (0..1) para interpolar
 * entre o estado anterior e o atual da física, evitando tremor quando o passo da
 * física e a taxa de quadros do headset não são múltiplos.
 */
export class FixedStepper {
  private acc = 0;
  private readonly maxSteps = 8;

  constructor(
    public hz: number,
    private readonly step: (dt: number) => void,
  ) {}

  get dt(): number {
    return 1 / this.hz;
  }

  /** Avança com o tempo real `frameDt` (s); devolve alpha para interpolação. */
  advance(frameDt: number): number {
    const dt = this.dt;
    this.acc += Math.min(frameDt, 0.1);
    let n = 0;
    while (this.acc >= dt && n < this.maxSteps) {
      this.step(dt);
      this.acc -= dt;
      n++;
    }
    if (n === this.maxSteps) this.acc = 0; // espiral da morte: descarta o atraso
    return this.acc / dt;
  }
}

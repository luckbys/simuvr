/**
 * Governador de desempenho para VR. Mede o tempo de quadro (média móvel) contra a meta do headset e
 * sobe/desce um nível de degradação: 0 = tudo ligado … 3 = só o essencial. Histerese e tempo mínimo
 * entre trocas evitam oscilação; picos isolados (um quadro lento) não disparam nada.
 */
export type PerfLevel = 0 | 1 | 2 | 3;

export interface PerfOptions {
  /** Tempo de quadro-alvo (ms), ex.: 1000/72. */
  targetMs: number;
  /** Acima de targetMs × degradeRatio (média) por `degradeAfter` s sobe o nível. */
  degradeRatio: number;
  degradeAfter: number;
  /** Abaixo de targetMs × recoverRatio (média) por `recoverAfter` s desce o nível. */
  recoverRatio: number;
  recoverAfter: number;
  /** Segundos mínimos entre trocas de nível. */
  cooldown: number;
  /** Peso da média móvel (0..1) por quadro. */
  alpha: number;
}

export const DEFAULT_PERF: PerfOptions = {
  targetMs: 1000 / 72,
  degradeRatio: 1.18,
  degradeAfter: 1.5,
  recoverRatio: 0.78,
  recoverAfter: 8,
  cooldown: 3,
  alpha: 0.06,
};

/** O que cada nível desliga (cumulativo). Usado pelo jogo e documentado nos testes. */
export const PERF_LEVELS: ReadonlyArray<{ level: PerfLevel; disables: string[] }> = [
  { level: 1, disables: ['retrovisor', 'chuva'] },
  { level: 2, disables: ['faróis reais (SpotLight)', 'metade da fumaça'] },
  { level: 3, disables: ['fumaça', 'faíscas', 'marcas de pneu'] },
];

export class PerfGovernor {
  level: PerfLevel = 0;
  /** Média móvel do tempo de quadro (ms). */
  avgMs: number;
  private badFor = 0;
  private goodFor = 0;
  private sinceChange = 99;

  constructor(public opts: PerfOptions = { ...DEFAULT_PERF }) {
    this.avgMs = opts.targetMs;
  }

  setTarget(ms: number): void {
    this.opts = { ...this.opts, targetMs: ms };
  }

  /** Registra um quadro; devolve o novo nível se mudou, ou null. */
  push(frameMs: number, dtSec: number): PerfLevel | null {
    const o = this.opts;
    this.avgMs += (frameMs - this.avgMs) * o.alpha;
    this.sinceChange += dtSec;

    if (this.avgMs > o.targetMs * o.degradeRatio) {
      this.badFor += dtSec;
      this.goodFor = 0;
    } else if (this.avgMs < o.targetMs * o.recoverRatio) {
      this.goodFor += dtSec;
      this.badFor = 0;
    } else {
      this.badFor = this.goodFor = 0;
    }

    if (this.sinceChange < o.cooldown) return null;
    if (this.badFor >= o.degradeAfter && this.level < 3) {
      return this.change((this.level + 1) as PerfLevel);
    }
    if (this.goodFor >= o.recoverAfter && this.level > 0) {
      return this.change((this.level - 1) as PerfLevel);
    }
    return null;
  }

  private change(l: PerfLevel): PerfLevel {
    this.level = l;
    this.badFor = this.goodFor = 0;
    this.sinceChange = 0;
    return l;
  }
}

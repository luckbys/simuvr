import { describe, expect, it } from 'vitest';
import { PerfGovernor, DEFAULT_PERF, PERF_LEVELS } from '../../src/core/perfGovernor';

/** Alimenta `seconds` de quadros com tempo `ms`; devolve as trocas de nível e o instante de cada uma. */
function feed(g: PerfGovernor, seconds: number, ms: number): Array<{ level: number; t: number }> {
  const out: Array<{ level: number; t: number }> = [];
  const dt = ms / 1000;
  let t = 0;
  while (t < seconds) {
    const r = g.push(ms, dt);
    t += dt;
    if (r !== null) out.push({ level: r, t });
  }
  return out;
}

describe('PerfGovernor', () => {
  it('quadros dentro da meta não mudam nada', () => {
    const g = new PerfGovernor();
    expect(feed(g, 30, 12)).toEqual([]);
    expect(g.level).toBe(0);
  });

  it('quadros lentos sustentados degradam por etapas, com tempo mínimo entre elas', () => {
    const g = new PerfGovernor();
    const ch = feed(g, 20, 22); // ~45 fps constantes
    expect(ch.map((c) => c.level)).toEqual([1, 2, 3]);
    for (let i = 1; i < ch.length; i++) expect(ch[i]!.t - ch[i - 1]!.t).toBeGreaterThanOrEqual(DEFAULT_PERF.cooldown - 0.05);
    expect(g.level).toBe(3);
    // não passa do nível máximo
    expect(feed(g, 20, 40)).toEqual([]);
    expect(g.level).toBe(3);
  });

  it('um pico isolado (um quadro lento) não dispara degradação', () => {
    const g = new PerfGovernor();
    feed(g, 5, 12);
    g.push(90, 0.09);
    expect(feed(g, 5, 12)).toEqual([]);
    expect(g.level).toBe(0);
  });

  it('com folga sustentada recupera, mais devagar do que degradou', () => {
    const g = new PerfGovernor();
    feed(g, 12, 22);
    expect(g.level).toBe(3);
    const up = feed(g, 40, 6); // folga grande
    expect(up.map((c) => c.level)).toEqual([2, 1, 0]);
    expect(up[0]!.t).toBeGreaterThanOrEqual(DEFAULT_PERF.recoverAfter - 1);
  });

  it('a zona entre os limiares não oscila (histerese)', () => {
    const g = new PerfGovernor();
    feed(g, 12, 22);
    expect(g.level).toBe(3);
    // ~13,9 ms é exatamente a meta: nem lento demais nem folgado
    expect(feed(g, 60, 13.5)).toEqual([]);
    expect(g.level).toBe(3);
  });

  it('a meta se ajusta ao headset (90 Hz exige mais que 72 Hz)', () => {
    const slow72 = new PerfGovernor();
    expect(feed(slow72, 10, 14.5)).toEqual([]); // 69 fps: ok para 72 Hz? 14,5 < 13,9 × 1,18
    const at90 = new PerfGovernor();
    at90.setTarget(1000 / 90);
    expect(feed(at90, 10, 14.5).length).toBeGreaterThan(0); // 69 fps é lento para 90 Hz
  });

  it('documenta o que cada nível desliga', () => {
    expect(PERF_LEVELS.map((l) => l.level)).toEqual([1, 2, 3]);
    expect(PERF_LEVELS[0]!.disables).toContain('retrovisor');
  });
});

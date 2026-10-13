import { describe, expect, it } from 'vitest';
import { HANABI_200S } from '../../src/physics/carSpec';
import { defaultTuning, resolveVehicleParams, type TuningState } from '../../src/physics/tuning';
import { estimateStats } from '../../src/physics/stats';
import { Garage } from '../../src/garage/garage';
import { TABS, allControls } from '../../src/garage/schema';
import { PRESETS, defaultGarage, sanitizeGarage } from '../../src/garage/state';

const stats = (patch: Partial<TuningState> = {}) =>
  estimateStats(resolveVehicleParams(HANABI_200S, { ...defaultTuning(), ...patch }));

describe('estimateStats', () => {
  it('valores de fábrica são plausíveis para um cupê turbo de ~1,2 t', () => {
    const s = stats();
    expect(s.peakPowerHp).toBeGreaterThan(220);
    expect(s.peakPowerHp).toBeLessThan(330);
    expect(s.peakTorque).toBeGreaterThan(270);
    expect(s.peakTorque).toBeLessThan(380);
    expect(s.mass).toBe(1250);
    expect(s.topSpeedKmh).toBeGreaterThan(230);
    expect(s.topSpeedKmh).toBeLessThan(285);
    expect(s.groundClearanceCm).toBeGreaterThan(10);
    expect(s.groundClearanceCm).toBeLessThan(16);
  });

  it('turbo, ECU e escape aumentam a potência de forma monotônica', () => {
    const na = stats({ turbo: 'none' }).peakPowerHp;
    const stock = stats({ turbo: 'stock' }).peakPowerHp;
    const sport = stats({ turbo: 'sport' }).peakPowerHp;
    const race = stats({ turbo: 'race' }).peakPowerHp;
    expect(na).toBeLessThan(stock);
    expect(stock).toBeLessThan(sport);
    expect(sport).toBeLessThan(race);
    expect(stats({ ecu: 'stage2' }).peakPowerHp).toBeGreaterThan(stats({ ecu: 'stage1' }).peakPowerHp);
    expect(stats({ intakeExhaust: true }).peakPowerHp).toBeGreaterThan(stats().peakPowerHp);
  });

  it('peso, vão livre e pressão aerodinâmica respondem ao tuning', () => {
    expect(stats({ weightReduction: 80 }).mass).toBeLessThan(stats().mass);
    expect(stats({ weightReduction: 80 }).powerToWeight).toBeGreaterThan(stats().powerToWeight);
    const low = stats({ rideHeightDrop: 0.07 }).groundClearanceCm;
    expect(stats().groundClearanceCm - low).toBeCloseTo(7, 0);
    expect(stats({ spoiler: 'wing' }).downforceKgf).toBeGreaterThan(stats({ spoiler: 'lip' }).downforceKgf);
    expect(stats({ spoiler: 'none' }).downforceKgf).toBe(0);
  });

  it('a asa alta custa velocidade final (arrasto) e a relação curta também', () => {
    expect(stats({ spoiler: 'wing' }).topSpeedKmh).toBeLessThanOrEqual(stats({ spoiler: 'none' }).topSpeedKmh);
    expect(stats({ gearset: 'close' }).topSpeedKmh).toBeLessThan(stats().topSpeedKmh + 1);
  });

  it('pneus mais aderentes elevam o atrito reportado', () => {
    expect(stats({ tireFront: 'slick', tireRear: 'slick' }).gripFront).toBeGreaterThan(stats().gripFront);
    expect(stats({ tireRear: 'drift' }).gripRear).toBeLessThan(stats().gripRear);
  });
});

describe('sanitizeGarage', () => {
  it('lixo vira o padrão', () => {
    for (const bad of [null, undefined, 42, 'x', [], { tuning: 5 }]) {
      expect(JSON.stringify(sanitizeGarage(bad))).toBe(JSON.stringify(defaultGarage()));
    }
  });

  it('limita números, ignora ids e cores inválidos, mantém os válidos', () => {
    const g = sanitizeGarage({
      tuning: { rideHeightDrop: 9, camberFront: -99, brakeBias: 0, turbo: 'inexistente', ecu: 'stage2', diff: 'locked', weightReduction: 'muito' },
      look: { paint: 'vermelho', rimColor: '#112233', underglow: null, finish: 'chrome', windowTint: 5 },
    });
    expect(g.tuning.rideHeightDrop).toBe(0.08);
    expect(g.tuning.camberFront).toBe(-8);
    expect(g.tuning.brakeBias).toBe(0.4);
    expect(g.tuning.turbo).toBe(defaultTuning().turbo);
    expect(g.tuning.ecu).toBe('stage2');
    expect(g.tuning.diff).toBe('locked');
    expect(g.tuning.weightReduction).toBe(0);
    expect(g.look.paint).toBe(defaultGarage().look.paint);
    expect(g.look.rimColor).toBe('#112233');
    expect(g.look.underglow).toBeNull();
    expect(g.look.finish).toBe('chrome');
    expect(g.look.windowTint).toBe(1);
  });

  it('o aerofólio visual sempre acompanha o do tuning', () => {
    const g = sanitizeGarage({ tuning: { spoiler: 'wing' }, look: { spoiler: 'none' } });
    expect(g.look.spoiler).toBe('wing');
  });

  it('o resultado sempre resolve para parâmetros físicos finitos', () => {
    const g = sanitizeGarage({ tuning: { springFront: 1e9, damperRear: -5, arbFront: NaN } });
    const p = resolveVehicleParams(HANABI_200S, g.tuning);
    for (const w of p.wheels) {
      expect(Number.isFinite(w.susp.k) && Number.isFinite(w.susp.cBump) && Number.isFinite(w.susp.arb)).toBe(true);
    }
  });
});

describe('esquema dos controles', () => {
  it('tem as abas esperadas e todos os controles são alcançáveis', () => {
    expect(TABS.map((t) => t.id)).toEqual(['visual', 'altura', 'barras', 'pneus', 'motor', 'cambio', 'freios', 'aero']);
    expect(allControls().length).toBeGreaterThanOrEqual(20);
  });

  it('cada opção de escolha, cor e extremo de slider é aplicado e lido de volta', () => {
    const garage = new Garage();
    for (const c of allControls()) {
      if (c.kind === 'choice') {
        for (const o of c.options) {
          garage.setControl(c, o.id);
          expect(c.get(garage.state)).toBe(o.id);
        }
      } else if (c.kind === 'color') {
        for (const col of c.colors) {
          garage.setControl(c, col);
          expect(c.get(garage.state).toLowerCase()).toBe(col.toLowerCase());
        }
      } else {
        garage.setControl(c, c.min);
        expect(c.get(garage.state)).toBeCloseTo(c.min, 6);
        garage.setControl(c, c.max);
        expect(c.get(garage.state)).toBeCloseTo(c.max, 6);
        garage.setControl(c, c.max * 100); // fora de faixa: limitado
        expect(c.get(garage.state)).toBeLessThanOrEqual(c.max + 1e-9);
      }
    }
  });

  it('"Vidros" mostra a opção mais próxima mesmo quando o valor salvo não é exato', () => {
    const garage = new Garage();
    const tint = allControls().find((c) => c.kind === 'choice' && c.label === 'Vidros');
    expect(tint?.kind).toBe('choice');
    if (tint?.kind !== 'choice') return;
    for (const [v, id] of [[0.85, '2'], [0.55, '1'], [0.4, '0'], [0.7, '1'], [0.92, '2'], [0.35, '0']] as const) {
      garage.mutate((s) => { s.look.windowTint = v; });
      expect(tint.get(garage.state)).toBe(id);
    }
  });

  it('as predefinições são válidas, diferentes e resolvem sem erro', () => {
    const seen = new Set<string>();
    for (const p of PRESETS) {
      const g = p.make();
      const s = sanitizeGarage(g);
      expect(JSON.stringify(s)).toBe(JSON.stringify(g)); // já nascem normalizadas
      seen.add(JSON.stringify(g));
      expect(Number.isFinite(estimateStats(resolveVehicleParams(HANABI_200S, g.tuning)).peakPowerHp)).toBe(true);
    }
    expect(seen.size).toBe(PRESETS.length);
  });

  it('o Garage notifica quem escuta e o painel de VR monta linhas para todas as abas', () => {
    const garage = new Garage();
    let calls = 0;
    const off = garage.onChange(() => calls++);
    garage.applyPreset('drift');
    expect(calls).toBe(1);
    expect(garage.state.tuning.diff).toBe('locked');
    off();
    garage.applyPreset('stock');
    expect(calls).toBe(1);
    for (let i = 0; i < TABS.length; i++) {
      garage.tab = i;
      const rows = garage.vrRows(() => {});
      expect(rows.length).toBeGreaterThan(5);
      expect(rows[0]!.type).toBe('title');
      expect(rows.at(-1)!.type).toBe('button');
    }
  });
});

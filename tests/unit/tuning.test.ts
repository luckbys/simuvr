import { describe, expect, it } from 'vitest';
import { HANABI_200S } from '../../src/physics/carSpec';
import {
  clampTuning, defaultTuning, driftTuning, gripTuning, resolveVehicleParams, type TuningState,
} from '../../src/physics/tuning';

const base = () => resolveVehicleParams(HANABI_200S, defaultTuning());
const with_ = (patch: Partial<TuningState>) => resolveVehicleParams(HANABI_200S, { ...defaultTuning(), ...patch });

describe('resolveVehicleParams', () => {
  it('é pura: mesma entrada, mesma saída, sem mutar o spec', () => {
    const snapshot = JSON.stringify(HANABI_200S);
    const a = resolveVehicleParams(HANABI_200S, driftTuning());
    const b = resolveVehicleParams(HANABI_200S, driftTuning());
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(JSON.stringify(HANABI_200S)).toBe(snapshot);
  });

  it('distribuição de peso e geometria dos eixos', () => {
    const p = base();
    const front = p.wheels[0].hardpoint[2];
    const rear = p.wheels[2].hardpoint[2];
    expect(rear - front).toBeCloseTo(HANABI_200S.wheelbase, 6);
    // 54% na frente → CG mais perto do eixo dianteiro
    expect(Math.abs(front)).toBeLessThan(rear);
    expect(Math.abs(front) / HANABI_200S.wheelbase).toBeCloseTo(1 - 0.54, 6);
  });

  it('altura do CG parado é plausível e cai com o rebaixamento', () => {
    const stock = base();
    expect(stock.comHeightStatic).toBeGreaterThan(0.4);
    expect(stock.comHeightStatic).toBeLessThan(0.6);
    const low = with_({ rideHeightDrop: 0.06 });
    expect(stock.comHeightStatic - low.comHeightStatic).toBeCloseTo(0.06, 3);
    // O assoalho é fixo no chassi; o vão livre até o chão é que diminui com o rebaixamento.
    const clearance = (p: typeof stock) => p.comHeightStatic + p.body.bottomLocalY;
    expect(clearance(stock) - clearance(low)).toBeCloseTo(0.06, 3);
    expect(clearance(low)).toBeGreaterThan(0.05); // ainda não raspa
  });

  it('molas e barras acompanham os multiplicadores', () => {
    const a = base();
    const b = with_({ springFront: 1.5, arbRear: 2 });
    expect(b.wheels[0].susp.k / a.wheels[0].susp.k).toBeCloseTo(1.5, 6);
    expect(b.wheels[2].susp.arb / a.wheels[2].susp.arb).toBeCloseTo(2, 6);
    expect(b.wheels[0].susp.cBump).toBeGreaterThan(a.wheels[0].susp.cBump); // mola mais dura → amortece mais
  });

  it('turbo, ECU e escape alteram o motor de forma monotônica', () => {
    const none = with_({ turbo: 'none' }).engine.turbo.maxBoost;
    const stock = with_({ turbo: 'stock' }).engine.turbo.maxBoost;
    const sport = with_({ turbo: 'sport' }).engine.turbo.maxBoost;
    const race = with_({ turbo: 'race' }).engine.turbo.maxBoost;
    expect(none).toBe(0);
    expect(stock).toBeLessThan(sport);
    expect(sport).toBeLessThan(race);
    expect(with_({ turbo: 'race' }).engine.turbo.lag).toBeGreaterThan(with_({ turbo: 'stock' }).engine.turbo.lag);

    const s0 = with_({ ecu: 'stock' }).engine.powerScale;
    const s1 = with_({ ecu: 'stage1' }).engine.powerScale;
    const s2 = with_({ ecu: 'stage2' }).engine.powerScale;
    expect(s0).toBeLessThan(s1);
    expect(s1).toBeLessThan(s2);
    expect(with_({ intakeExhaust: true }).engine.powerScale).toBeGreaterThan(s0);
    // sem turbo, ECU não adiciona pressão
    expect(with_({ turbo: 'none', ecu: 'stage2' }).engine.turbo.maxBoost).toBe(0);
  });

  it('a embreagem aguenta o torque de pico do kit', () => {
    for (const turbo of ['none', 'stock', 'sport', 'race'] as const) {
      const p = with_({ turbo, ecu: 'stage2' });
      let peak = 0;
      for (const [, t] of p.engine.torqueCurve) peak = Math.max(peak, t);
      expect(p.clutchCapacity).toBeGreaterThan(peak * p.engine.powerScale * (1 + p.engine.turbo.torqueGain * p.engine.turbo.maxBoost));
    }
  });

  it('redução de peso, asa e freios', () => {
    expect(with_({ weightReduction: 60 }).mass).toBeLessThan(base().mass);
    expect(with_({ spoiler: 'wing' }).aero.downforceRear).toBeGreaterThan(with_({ spoiler: 'lip' }).aero.downforceRear);
    expect(with_({ spoiler: 'wing' }).aero.dragCoef).toBeGreaterThan(base().aero.dragCoef);
    const front = with_({ brakeBias: 0.7 }).brakes;
    expect(front.maxFront).toBeGreaterThan(front.maxRear);
    expect(with_({ brakes: 'race' }).brakes.maxFront).toBeGreaterThan(base().brakes.maxFront);
    // O viés só redistribui: o total é o mesmo
    const a = with_({ brakeBias: 0.5 }).brakes;
    const b = with_({ brakeBias: 0.7 }).brakes;
    expect(a.maxFront + a.maxRear).toBeCloseTo(b.maxFront + b.maxRear, 6);
  });

  it('kit de ângulo aumenta o esterço; relação final curta muda a relação total', () => {
    expect(with_({ steerKit: 'extreme' }).steering.maxAngleRad).toBeGreaterThan(base().steering.maxAngleRad);
    expect(with_({ gearset: 'close' }).gearbox.finalDrive).toBeGreaterThan(base().gearbox.finalDrive);
  });

  it('pré-carga do diferencial escala o travamento', () => {
    const lo = with_({ diff: 'lsd2', diffPreload: 0 }).diff.preload;
    const hi = with_({ diff: 'lsd2', diffPreload: 1 }).diff.preload;
    expect(hi).toBeGreaterThan(lo);
  });

  it('valores fora de faixa são limitados', () => {
    const c = clampTuning({ ...defaultTuning(), rideHeightDrop: 5, camberFront: -40, brakeBias: 0.1, weightReduction: 999 });
    expect(c.rideHeightDrop).toBe(0.08);
    expect(c.camberFront).toBe(-8);
    expect(c.brakeBias).toBe(0.4);
    expect(c.weightReduction).toBe(100);
  });

  it('presets de drift e grip resolvem sem erro e são diferentes entre si', () => {
    const d = resolveVehicleParams(HANABI_200S, driftTuning());
    const g = resolveVehicleParams(HANABI_200S, gripTuning());
    // drift: composto duro atrás; grip: semi-slick
    expect(d.wheels[2].tire.mu).toBeLessThan(g.wheels[2].tire.mu);
    expect(d.diffType).toBe('locked');
    expect(g.diffType).toBe('lsd2');
  });
});

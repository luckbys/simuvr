import { describe, expect, it } from 'vitest';
import { TireModel, magicFormula, makeTireOut, solveB } from '../../src/physics/vehicle/pacejka';
import { COMPOUNDS } from '../../src/physics/tuning';

describe('Magic Formula', () => {
  it('é ímpar e passa por zero', () => {
    const B = solveB(1, 1.4, -0.5);
    expect(magicFormula(0, B, 1.4, -0.5)).toBe(0);
    expect(magicFormula(0.7, B, 1.4, -0.5)).toBeCloseTo(-magicFormula(-0.7, B, 1.4, -0.5), 12);
  });

  it('solveB coloca o pico exatamente onde pedido', () => {
    for (const [C, E, peak] of [[1.4, -0.5, 1], [1.28, -0.6, 1], [1.52, -0.2, 1], [1.4, -0.5, 0.15]] as const) {
      const B = solveB(peak, C, E);
      let best = 0, bestX = 0;
      for (let x = 0.001; x < peak * 3; x += peak / 2000) {
        const f = magicFormula(x, B, C, E);
        if (f > best) { best = f; bestX = x; }
      }
      expect(best).toBeCloseTo(1, 3);
      expect(bestX).toBeCloseTo(peak, 1);
    }
  });

  it('cai após o pico até a fração de deslizamento sin(Cπ/2)', () => {
    const C = 1.4, E = -0.5;
    const B = solveB(1, C, E);
    const asymptote = Math.sin((C * Math.PI) / 2);
    expect(magicFormula(1000, B, C, E)).toBeCloseTo(asymptote, 2);
    expect(asymptote).toBeGreaterThan(0.7); // deslizar ainda segura bem
    expect(asymptote).toBeLessThan(1);
  });
});

describe('TireModel', () => {
  const model = new TireModel(COMPOUNDS.street);
  const out = makeTireOut();
  const FZ = 3300;

  it('atrito de pico na carga nominal = mu · Fz', () => {
    // Escorregamento longitudinal puro no pico.
    const v = 20;
    const kappa = COMPOUNDS.street.peakSlipRatio;
    model.force(out, v, 0, v * (1 + kappa), FZ, 0, 1, 1, 1);
    expect(out.fx).toBeCloseTo(COMPOUNDS.street.mu * FZ, -1);
    expect(Math.abs(out.fy)).toBeLessThan(1);
  });

  it('força lateral se opõe ao deslizamento lateral', () => {
    const v = 20;
    const alpha = 0.1;
    const vlat = Math.tan(alpha) * (v + 1.5);
    model.force(out, v, vlat, v, FZ, model.slipAngle(v, vlat), 1, 1, 1);
    expect(out.fy).toBeLessThan(0);
    model.force(out, v, -vlat, v, FZ, model.slipAngle(v, -vlat), 1, 1, 1);
    expect(out.fy).toBeGreaterThan(0);
  });

  it('nunca excede o círculo de atrito em escorregamento combinado', () => {
    const v = 15;
    for (let k = -0.6; k <= 0.6; k += 0.05) {
      for (let a = -0.5; a <= 0.5; a += 0.05) {
        const vlat = Math.tan(a) * (v + 1.5);
        model.force(out, v, vlat, v * (1 + k), FZ, model.slipAngle(v, vlat), 1, 1, 1);
        const mu = model.muAt(FZ) * FZ;
        expect(Math.hypot(out.fx, out.fy)).toBeLessThanOrEqual(mu * 1.0001);
      }
    }
  });

  it('o atrito cai com a carga (sensibilidade à carga): μ efetivo menor com carga alta', () => {
    expect(model.muAt(6000)).toBeLessThan(model.muAt(3300));
    expect(model.muAt(1500)).toBeGreaterThan(model.muAt(3300));
    // mas a força total ainda cresce com a carga
    expect(model.muAt(6000) * 6000).toBeGreaterThan(model.muAt(3300) * 3300);
  });

  it('é suave perto de velocidade zero: sem forças enormes nem NaN', () => {
    for (const v of [0, 0.01, 0.1, 0.5, 1, 2]) {
      model.force(out, v, 0.3, 0, FZ, model.slipAngle(v, 0.3), 1, 1, 1);
      expect(Number.isFinite(out.fx) && Number.isFinite(out.fy)).toBe(true);
      expect(Math.hypot(out.fx, out.fy)).toBeLessThanOrEqual(model.muAt(FZ) * FZ * 1.0001);
    }
  });

  it('parado e sem deslizamento não gera força', () => {
    model.force(out, 0, 0, 0, FZ, 0, 1, 1, 1);
    expect(out.fx).toBeCloseTo(0, 6);
    expect(out.fy).toBeCloseTo(0, 6);
  });

  it('sem carga não há força', () => {
    model.force(out, 20, 5, 25, 0, 0.2, 1, 1, 1);
    expect(out.fx).toBe(0);
    expect(out.fy).toBe(0);
  });

  it('o composto drift segura melhor ângulos grandes do que o semi-slick', () => {
    const drift = new TireModel(COMPOUNDS.drift);
    const slick = new TireModel(COMPOUNDS.slick);
    const v = 20;
    const alpha = 0.45; // bem além do pico
    const vlat = Math.tan(alpha) * (v + 1.5);
    const a = slick.slipAngle(v, vlat);
    slick.force(out, v, vlat, v, FZ, a, 1, 1, 1);
    const slickRatio = Math.abs(out.fy) / (slick.muAt(FZ) * FZ);
    drift.force(out, v, vlat, v, FZ, a, 1, 1, 1);
    const driftRatio = Math.abs(out.fy) / (drift.muAt(FZ) * FZ);
    expect(driftRatio).toBeGreaterThan(slickRatio);
  });

  it('torque auto-alinhante some quando o pneu satura', () => {
    const v = 20;
    const small = 0.05 * (v + 1.5);
    model.force(out, v, small, v, FZ, model.slipAngle(v, small), 1, 1, 1);
    const mzSmall = Math.abs(out.mz) / Math.abs(out.fy);
    const big = Math.tan(0.4) * (v + 1.5);
    model.force(out, v, big, v, FZ, model.slipAngle(v, big), 1, 1, 1);
    const mzBig = Math.abs(out.mz) / Math.abs(out.fy);
    expect(mzBig).toBeLessThan(mzSmall);
  });
});

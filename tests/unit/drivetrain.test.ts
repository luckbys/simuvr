import { describe, expect, it } from 'vitest';
import { Curve, solve3, smoothstep } from '../../src/physics/vehicle/math';
import { Engine, Turbo, RPM_TO_RADS, RADS_TO_RPM } from '../../src/physics/vehicle/engine';
import { Gearbox } from '../../src/physics/vehicle/gearbox';
import { DIFF_PRESETS, lockMagnitude, lockTorque, type DiffSpec } from '../../src/physics/vehicle/differential';
import { suspensionForce } from '../../src/physics/vehicle/suspension';
import { HANABI_200S } from '../../src/physics/carSpec';
import { defaultTuning, resolveVehicleParams } from '../../src/physics/tuning';

describe('math', () => {
  it('Curve passa pelos pontos e é monotônica entre eles quando os dados são', () => {
    const c = new Curve([[0, 0], [1, 10], [2, 14], [3, 15]]);
    expect(c.eval(0)).toBeCloseTo(0);
    expect(c.eval(1)).toBeCloseTo(10);
    expect(c.eval(3)).toBeCloseTo(15);
    expect(c.eval(-5)).toBe(0);
    expect(c.eval(99)).toBe(15);
    let prev = -Infinity;
    for (let x = 0; x <= 3; x += 0.05) {
      const y = c.eval(x);
      expect(y).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = y;
    }
  });

  it('solve3 resolve sistemas e detecta singulares', () => {
    const out = [0, 0, 0];
    expect(solve3([2, 1, -1, -3, -1, 2, -2, 1, 2], [8, -11, -3], out)).toBe(true);
    expect(out[0]).toBeCloseTo(2);
    expect(out[1]).toBeCloseTo(3);
    expect(out[2]).toBeCloseTo(-1);
    expect(solve3([1, 2, 3, 2, 4, 6, 1, 1, 1], [1, 2, 3], out)).toBe(false);
  });

  it('smoothstep', () => {
    expect(smoothstep(0, 1, -1)).toBe(0);
    expect(smoothstep(0, 1, 2)).toBe(1);
    expect(smoothstep(0, 1, 0.5)).toBeCloseTo(0.5);
  });
});

describe('motor e turbo', () => {
  const params = resolveVehicleParams(HANABI_200S, defaultTuning());
  const engine = new Engine(params.engine);

  it('torque a plena carga bate com a curva e o turbo multiplica', () => {
    const wot = engine.torque(5500, 1, 0);
    expect(wot).toBeCloseTo(178, 0);
    const boosted = engine.torque(5500, 1, 0.85);
    expect(boosted / wot).toBeCloseTo(1 + 0.9 * 0.85, 2);
  });

  it('acelerador fechado gera freio-motor (torque negativo) que cresce com a rotação', () => {
    const low = engine.torque(2000, 0, 0);
    const high = engine.torque(6000, 0, 0);
    expect(low).toBeLessThan(0);
    expect(high).toBeLessThan(low);
  });

  it('limitador de giro corta combustível e volta com histerese', () => {
    const e = new Engine(params.engine);
    e.torque(7500, 1, 0);
    expect(e.fuelCut).toBe(true);
    expect(e.torque(7300, 1, 0)).toBeLessThan(0); // ainda cortado
    e.torque(6900, 1, 0);
    expect(e.fuelCut).toBe(false);
  });

  it('marcha lenta impede o motor de parar', () => {
    const t = engine.torque(500, 0, 0);
    expect(t).toBeGreaterThan(-5); // controle de marcha lenta compensa o atrito
  });

  it('turbo tem lag, sobe com a rotação e solta ao aliviar com blow-off', () => {
    const t = new Turbo(params.engine.turbo);
    const dt = 1 / 120;
    // 0,25 s a 5000 rpm com carga total: ainda longe da pressão máxima.
    for (let i = 0; i < 30; i++) t.update(dt, 5000, 1);
    const early = t.boost;
    expect(early).toBeGreaterThan(0);
    expect(early).toBeLessThan(0.85);
    for (let i = 0; i < 240; i++) t.update(dt, 5000, 1);
    expect(t.boost).toBeCloseTo(0.85, 1);
    let blown = false;
    for (let i = 0; i < 20; i++) {
      t.update(dt, 5000, 0);
      blown ||= t.blowOff;
    }
    expect(blown).toBe(true);
    for (let i = 0; i < 240; i++) t.update(dt, 5000, 0);
    expect(t.boost).toBeLessThan(0.02);
  });

  it('abaixo da rotação de início não há pressão', () => {
    const t = new Turbo(params.engine.turbo);
    for (let i = 0; i < 600; i++) t.update(1 / 120, 1500, 1);
    expect(t.boost).toBeLessThan(0.01);
  });
});

describe('câmbio', () => {
  const params = resolveVehicleParams(HANABI_200S, defaultTuning());
  const ctx = (o: Partial<Parameters<Gearbox['update']>[1]>) => ({
    rpm: 3000, throttle: 0, brake: 0, speed: 0, limiterRpm: 7400, idleRpm: 900, ...o,
  });

  it('velocidade na rotação máxima por marcha é coerente', () => {
    const gb = new Gearbox(params.gearbox);
    const R = HANABI_200S.wheelRadius;
    const speeds = [1, 2, 3, 4, 5, 6].map((g) => {
      const wheelOmega = (7200 * RPM_TO_RADS) / gb.ratioFor(g);
      return wheelOmega * R * 3.6;
    });
    for (let i = 1; i < speeds.length; i++) expect(speeds[i]!).toBeGreaterThan(speeds[i - 1]!);
    expect(speeds[0]!).toBeGreaterThan(50);
    expect(speeds[0]!).toBeLessThan(70);
    expect(speeds[5]!).toBeGreaterThan(230);
  });

  it('automático sobe de marcha perto do corte e desce em baixa rotação', () => {
    const gb = new Gearbox(params.gearbox);
    gb.gear = 2;
    for (let i = 0; i < 200; i++) gb.update(1 / 120, ctx({ rpm: 7100, throttle: 1, speed: 30 }));
    expect(gb.gear).toBeGreaterThan(2);
    const g = gb.gear;
    for (let i = 0; i < 200; i++) gb.update(1 / 120, ctx({ rpm: 1500, throttle: 0.3, speed: 15 }));
    expect(gb.gear).toBeLessThan(g);
  });

  it('não reduz para uma marcha que passaria do limitador', () => {
    const gb = new Gearbox(params.gearbox);
    gb.gear = 6;
    for (let i = 0; i < 200; i++) gb.update(1 / 120, ctx({ rpm: 3400, throttle: 0.1, speed: 40 }));
    // 3400 rpm em 6ª → 5ª daria ~4430 rpm: permitido; checa só que nunca passa de limiter*0.9
    const after = (3400 * gb.ratioFor(gb.gear)) / gb.ratioFor(6);
    expect(after).toBeLessThan(7400 * 0.9);
  });

  it('engata ré automaticamente com o carro parado e freio pressionado', () => {
    const gb = new Gearbox(params.gearbox);
    for (let i = 0; i < 120; i++) gb.update(1 / 120, ctx({ brake: 1, speed: 0 }));
    expect(gb.gear).toBe(-1);
    expect(gb.totalRatio).toBeLessThan(0);
    for (let i = 0; i < 120; i++) gb.update(1 / 120, ctx({ throttle: 1, speed: 0 }));
    expect(gb.gear).toBeGreaterThanOrEqual(1);
  });

  it('troca manual abre a embreagem e fecha depois', () => {
    const gb = new Gearbox(params.gearbox);
    gb.auto = false;
    gb.shift(1, true);
    expect(gb.gear).toBe(2);
    expect(gb.shiftEngage).toBe(0);
    for (let i = 0; i < 40; i++) gb.update(1 / 120, ctx({}));
    expect(gb.shiftTimer).toBe(0);
    expect(gb.shiftEngage).toBe(1);
  });

  it('limites: não passa da última marcha nem abaixo de ré', () => {
    const gb = new Gearbox(params.gearbox);
    gb.auto = false;
    for (let i = 0; i < 10; i++) gb.shift(1, true);
    expect(gb.gear).toBe(6);
    for (let i = 0; i < 10; i++) gb.shift(-1, true);
    expect(gb.gear).toBe(-1);
  });
});

describe('diferencial', () => {
  const lsd: DiffSpec = { ...DIFF_PRESETS.lsd2, width: 3 };

  it('aberto não trava', () => {
    const open: DiffSpec = { ...DIFF_PRESETS.open, width: 3 };
    expect(lockTorque(open, 500, 10).lk).toBe(0);
  });

  it('transfere torque da roda rápida para a lenta e é ímpar em dw', () => {
    const a = lockTorque(lsd, 400, 5).lk;
    const b = lockTorque(lsd, 400, -5).lk;
    expect(a).toBeGreaterThan(0);
    expect(b).toBeCloseTo(-a, 9);
  });

  it('travamento cresce com o torque e respeita o máximo', () => {
    expect(lockMagnitude(lsd, 800)).toBeGreaterThan(lockMagnitude(lsd, 100));
    expect(lockMagnitude(lsd, 1e6)).toBe(lsd.maxLock);
  });

  it('LSD de 1 via quase não trava em desaceleração; 2 vias trava', () => {
    const one: DiffSpec = { ...DIFF_PRESETS.lsd1, width: 3 };
    const two: DiffSpec = { ...DIFF_PRESETS.lsd2, width: 3 };
    expect(lockMagnitude(one, -400)).toBeLessThan(lockMagnitude(two, -400));
  });
});

describe('suspensão', () => {
  const params = resolveVehicleParams(HANABI_200S, defaultTuning());
  const s = params.wheels[0].susp;

  it('mola linear, amortecedor assimétrico, nunca puxa o chão', () => {
    expect(suspensionForce(s, 0.05, 0)).toBeCloseTo(s.k * 0.05, 3);
    expect(suspensionForce(s, 0.05, 1)).toBeGreaterThan(suspensionForce(s, 0.05, 0));
    expect(suspensionForce(s, 0.0, -3)).toBe(0);
    // rebound > bump
    expect(Math.abs(suspensionForce(s, 0.05, -0.5) - s.k * 0.05)).toBeGreaterThan(
      Math.abs(suspensionForce(s, 0.05, 0.5) - s.k * 0.05) - 1e-6,
    );
  });

  it('batente progressivo no fim do curso', () => {
    const near = suspensionForce(s, s.travel - s.bumpStopRange, 0);
    const end = suspensionForce(s, s.travel, 0);
    expect(end - near).toBeGreaterThan(s.k * s.bumpStopRange * 3);
  });

  it('rpm ↔ rad/s', () => {
    expect(7200 * RPM_TO_RADS * RADS_TO_RPM).toBeCloseTo(7200);
  });
});

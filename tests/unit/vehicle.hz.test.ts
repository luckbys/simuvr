import { describe, expect, it } from 'vitest';
import { driftTuning, defaultTuning } from '../../src/physics/tuning';
import { finiteState, KMH, makeSim } from './simHelpers';

/**
 * O tier baixo (Quest) roda a física a 90 Hz; um headset sob carga pode cair para 60 Hz.
 * O carro foi calibrado a 120 Hz: aqui garantimos que continua estável e com o mesmo comportamento.
 */
describe.each([120, 90, 60])('física a %i Hz', (hz) => {
  it('assenta parado sem deslizar nem gerar NaN', async () => {
    const sim = await makeSim(defaultTuning(), { hz });
    sim.run(4, () => ({}));
    expect(finiteState(sim)).toBe(true);
    expect(Math.abs(sim.car.speed)).toBeLessThan(0.03);
    expect(sim.pos().y).toBeCloseTo(sim.car.params.comHeightStatic, 1);
  });

  it('0–100 km/h e 100–0 km/h dentro das mesmas faixas', async () => {
    const sim = await makeSim(defaultTuning(), { hz });
    let t100 = NaN;
    sim.run(14, () => ({ throttle: 1 }), (t) => {
      if (sim.car.speed >= 100 * KMH) { t100 = t; return false; }
    });
    expect(t100).toBeGreaterThan(4);
    expect(t100).toBeLessThan(8.5);

    const b = await makeSim(defaultTuning(), { hz });
    b.car.setForwardSpeed(100 * KMH, 4);
    const z0 = b.pos().z;
    b.run(8, () => ({ brake: 1 }), () => (b.car.speed < 0.3 ? false : undefined));
    const dist = Math.abs(b.pos().z - z0);
    expect(finiteState(b)).toBe(true);
    expect(dist).toBeGreaterThan(30);
    expect(dist).toBeLessThan(52);
  });

  it('aderência lateral de pico ~1 g e drift com freio de mão', async () => {
    const sim = await makeSim(defaultTuning(), { hz });
    const v = 70 * KMH;
    sim.car.setForwardSpeed(v, 4);
    sim.run(1, () => ({ throttle: 0.25 }));
    let maxG = 0;
    sim.run(10, (t) => ({ steer: Math.min(1, (t - 1) / 8) * 0.7, steerIsAbsolute: true, throttle: sim.car.speed < v ? 0.6 : 0 }), () => { maxG = Math.max(maxG, Math.abs(sim.car.gLat)); });
    expect(maxG).toBeGreaterThan(0.8);
    expect(maxG).toBeLessThan(1.25);

    const d = await makeSim(driftTuning(), { hz });
    d.car.setForwardSpeed(70 * KMH, 3);
    let drift = 0;
    d.run(5, (t) => {
      if (t < 0.6) return { throttle: 0.7, steer: 0.5, steerIsAbsolute: true };
      if (t < 1.4) return { throttle: 0.7, steer: 0.5, steerIsAbsolute: true, handbrake: 1 };
      return { throttle: 0.9, steer: -0.35, steerIsAbsolute: true };
    }, () => { drift = Math.max(drift, Math.abs(d.car.driftAngle)); });
    expect(finiteState(d)).toBe(true);
    expect(drift).toBeGreaterThan(0.35);
  });

  it('entradas caóticas por 20 s mantêm tudo finito e limitado', async () => {
    const sim = await makeSim(driftTuning(), { hz });
    let seed = 99 + hz;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    let th = 0, br = 0, st = 0, hb = 0, bad = '';
    sim.run(20, (t) => {
      if (Math.floor(t * 4) !== Math.floor((t - sim.dt) * 4)) {
        th = rnd() < 0.5 ? 1 : 0; br = rnd() < 0.2 ? 1 : 0; st = (rnd() * 2 - 1) * (rnd() < 0.3 ? 1 : 0.4); hb = rnd() < 0.15 ? 1 : 0;
      }
      return { throttle: th, brake: br, steer: st, handbrake: hb, steerIsAbsolute: true, shiftUp: rnd() < 0.01, shiftDown: rnd() < 0.01 };
    }, () => {
      if (!finiteState(sim)) { bad = `não finito em t=${sim.t}`; return false; }
      if (sim.car.rpm < 300 || sim.car.rpm > 9600) { bad = `rpm ${sim.car.rpm}`; return false; }
      if (sim.car.speedKmh > 400) { bad = `velocidade ${sim.car.speedKmh}`; return false; }
      if (sim.pos().y > 3 || sim.pos().y < 0.1) { bad = `altura ${sim.pos().y}`; return false; }
    });
    expect(bad).toBe('');
  });
});

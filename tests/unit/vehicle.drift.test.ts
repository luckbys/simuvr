import { describe, expect, it } from 'vitest';
import { driftTuning, defaultTuning, type TuningState } from '../../src/physics/tuning';
import { KMH, makeSim, finiteState } from './simHelpers';

/**
 * "Dá para segurar uma derrapagem?" é o que define a cultura drift. Um motorista simples (PD no ângulo de
 * deriva) tenta manter ~20° numa curva à direita; contamos quantas combinações de ganho/acelerador/velocidade
 * conseguem segurar mais de 4 s sem rodar. Um carro bom de drift segura com muitas combinações; um carro de
 * aderência (semi-slick atrás) quase nunca.
 *
 * Convenção: ângulo de deriva negativo = derrapagem à direita (nariz à direita da velocidade).
 */
async function trial(tuning: TuningState, kp: number, kd: number, thr: number, vTarget: number) {
  const sim = await makeSim(tuning);
  sim.car.setForwardSpeed(85 * KMH, 3);
  let prev = 0, holdT = 0, spun = false;
  sim.run(10, (t) => {
    const beta = sim.car.driftAngle;
    const dBeta = (beta - prev) / sim.dt;
    prev = beta;
    if (t < 0.5) return { throttle: 0.8, steer: 0, steerIsAbsolute: true };
    if (t < 0.85) return { throttle: 1, steer: -0.9, steerIsAbsolute: true }; // finta para a esquerda
    if (t < 1.55) return { throttle: 1, steer: 0.9, steerIsAbsolute: true, handbrake: t < 1.1 ? 1 : 0 }; // inicia à direita
    const steer = Math.max(-1, Math.min(1, kp * (beta + 0.35) + kd * dBeta));
    const throttle = Math.max(0.3, Math.min(1, thr + 0.05 * (vTarget - sim.car.speedKmh)));
    return { throttle, steer, steerIsAbsolute: true };
  }, (t) => {
    if (t > 2.0) {
      const b = sim.car.driftAngle;
      if (Math.abs(b) > 1.4) spun = true;
      if (b < -0.2 && b > -0.7 && sim.car.speedKmh > 25) holdT += sim.dt;
    }
  });
  return { ok: finiteState(sim), held: holdT > 4 && !spun };
}

async function driftability(tuning: TuningState): Promise<number> {
  let held = 0, n = 0;
  for (const kp of [2, 4, 6, 9]) {
    for (const kd of [0, 0.3, 0.8]) {
      for (const thr of [0.6, 0.85]) {
        for (const v of [55, 70]) {
          const r = await trial(tuning, kp, kd, thr, v);
          expect(r.ok).toBe(true);
          n++;
          if (r.held) held++;
        }
      }
    }
  }
  return held / n;
}

describe('derrapagem sustentável', () => {
  it('o tuning de drift segura a derrapagem com muito mais facilidade que o carro original e que o grip', async () => {
    const preset = await driftability(driftTuning());
    const stock = await driftability(defaultTuning());
    const gripRear = await driftability({ ...driftTuning(), tireRear: 'slick' });
    // medido: ~54% / ~15% / ~6%
    expect(preset).toBeGreaterThan(0.4);
    expect(preset).toBeGreaterThan(stock * 2);
    expect(stock).toBeGreaterThan(gripRear);
    expect(gripRear).toBeLessThan(preset / 2);
  }, 90_000);
});

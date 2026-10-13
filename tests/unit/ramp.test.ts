import { describe, expect, it } from 'vitest';
import { PhysicsWorld } from '../../src/physics/world';
import { Vehicle } from '../../src/physics/vehicle/vehicle';
import { HANABI_200S } from '../../src/physics/carSpec';
import { defaultTuning, resolveVehicleParams } from '../../src/physics/tuning';
import { emptyInput } from '../../src/core/input';
import { KMH } from './simHelpers';

/** Mesma geometria da rampa do pátio (meetSpot.ts): sobe para +X, ponta baixa rente ao piso. */
function addRamp(pw: PhysicsWorld, rx: number, rz: number): { top: number } {
  const pitch = 0.14, len = 10, wid = 6.4, thick = 0.3;
  const cy = (len / 2) * Math.sin(pitch) - (thick / 2) * Math.cos(pitch) + 0.012;
  pw.addBox([rx, cy, rz], [wid / 2, thick / 2, len / 2], { yaw: -Math.PI / 2, pitch, surface: 'concrete' });
  return { top: cy + (len / 2) * Math.sin(pitch) + (thick / 2) * Math.cos(pitch) };
}

describe('rampa do pátio', () => {
  it('um carro a 80 km/h sobe a rampa (para +X), decola e volta ao chão sem NaN', async () => {
    const pw = await PhysicsWorld.create();
    pw.addGround(500, 'concrete');
    const ramp = addRamp(pw, 60, 0);
    // Carro virado para +X (yaw = -90°), 40 m antes da rampa.
    const car = new Vehicle(pw, resolveVehicleParams(HANABI_200S, defaultTuning()), { x: 10, z: 0, yaw: -Math.PI / 2 }, { abs: true, steerAssist: 0, autoGear: true });
    car.setForwardSpeed(80 * KMH, 4);
    const dt = 1 / 120;
    let maxY = 0, airborneT = 0, landedAfter = false, x = 0;
    for (let i = 0; i < 120 * 6; i++) {
      car.update(dt, { ...emptyInput(), throttle: 0.5, steerIsAbsolute: true });
      pw.step(dt);
      car.postStep();
      const t = car.body.translation();
      x = t.x;
      maxY = Math.max(maxY, t.y);
      if (car.airborne) airborneT += dt;
      else if (airborneT > 0.2) landedAfter = true;
      expect(Number.isFinite(t.x + t.y + t.z)).toBe(true);
    }
    expect(x).toBeGreaterThan(60); // passou pela rampa para +X
    expect(maxY).toBeGreaterThan(1.1); // subiu (a rampa chega a ~1,4 m)
    expect(maxY).toBeLessThan(ramp.top + 2.5);
    expect(airborneT).toBeGreaterThan(0.2); // decolou
    expect(landedAfter).toBe(true); // e pousou
    expect(Number.isFinite(car.rpm) && car.wheels.every((w) => Number.isFinite(w.omega))).toBe(true);
  });

  it('a rampa não é um degrau: a 20 km/h o carro entra na ponta baixa sem parar nem capotar', async () => {
    const pw = await PhysicsWorld.create();
    pw.addGround(500, 'concrete');
    addRamp(pw, 40, 0);
    const car = new Vehicle(pw, resolveVehicleParams(HANABI_200S, defaultTuning()), { x: 20, z: 0, yaw: -Math.PI / 2 }, { abs: true, steerAssist: 0, autoGear: true });
    car.setForwardSpeed(20 * KMH, 2);
    const dt = 1 / 120;
    for (let i = 0; i < 120 * 3; i++) {
      car.update(dt, { ...emptyInput(), throttle: 0.6, steerIsAbsolute: true });
      pw.step(dt);
      car.postStep();
    }
    // 3 s a ~20 km/h ou mais: já passou do início da rampa (x = 35) e continua andando
    expect(car.body.translation().x).toBeGreaterThan(36);
    expect(car.speedKmh).toBeGreaterThan(8);
  });
});

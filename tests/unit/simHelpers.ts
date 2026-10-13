import * as THREE from 'three';
import { PhysicsWorld } from '../../src/physics/world';
import { Vehicle, type VehicleOptions } from '../../src/physics/vehicle/vehicle';
import { HANABI_200S } from '../../src/physics/carSpec';
import { defaultTuning, resolveVehicleParams, type TuningState } from '../../src/physics/tuning';
import { emptyInput, type DriveInput } from '../../src/core/input';
import type { SurfaceId } from '../../src/physics/surfaces';

export const HZ = 120;
export const DT = 1 / HZ;
export const KMH = 1 / 3.6;

export interface Sim {
  /** Passo de simulação (s) desta instância. */
  dt: number;
  pw: PhysicsWorld;
  car: Vehicle;
  t: number;
  /** Executa um passo com a entrada dada. */
  step(input: Partial<DriveInput>): void;
  /** Roda `seconds` com uma função de entrada (recebe o tempo). */
  run(seconds: number, fn: (t: number) => Partial<DriveInput>, each?: (t: number) => boolean | void): void;
  yaw(): number;
  rollAngle(): number;
  pos(): THREE.Vector3;
  totalLoad(): number;
}

export async function makeSim(
  tuning: TuningState = defaultTuning(),
  opts: { surface?: SurfaceId; options?: Partial<VehicleOptions>; hz?: number } = {},
): Promise<Sim> {
  const hz = opts.hz ?? HZ;
  const dt = 1 / hz;
  const pw = await PhysicsWorld.create();
  pw.addGround(3000, opts.surface ?? 'asphalt');
  const params = resolveVehicleParams(HANABI_200S, tuning);
  const car = new Vehicle(pw, params, { x: 0, z: 0 }, { abs: true, steerAssist: 0, autoGear: true, ...opts.options });
  const sim: Sim = {
    dt, pw, car, t: 0,
    step(input) {
      const i: DriveInput = { ...emptyInput(), ...input };
      car.update(dt, i);
      pw.step(dt);
      car.postStep();
      sim.t += dt;
    },
    run(seconds, fn, each) {
      const n = Math.round(seconds * hz);
      for (let k = 0; k < n; k++) {
        sim.step(fn(sim.t));
        if (each && each(sim.t) === false) return;
      }
    },
    yaw() {
      const r = car.body.rotation();
      const q = new THREE.Quaternion(r.x, r.y, r.z, r.w);
      const f = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
      return Math.atan2(-f.x, -f.z);
    },
    rollAngle() {
      const r = car.body.rotation();
      const q = new THREE.Quaternion(r.x, r.y, r.z, r.w);
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
      return Math.asin(THREE.MathUtils.clamp(right.y, -1, 1));
    },
    pos() {
      const t = car.body.translation();
      return new THREE.Vector3(t.x, t.y, t.z);
    },
    totalLoad() {
      return car.wheels.reduce((s, w) => s + w.load, 0);
    },
  };
  return sim;
}

export function finiteState(sim: Sim): boolean {
  const c = sim.car;
  const t = c.body.translation();
  const v = c.body.linvel();
  const vals = [t.x, t.y, t.z, v.x, v.y, v.z, c.rpm, c.engineOmega, ...c.wheels.flatMap((w) => [w.omega, w.fx, w.fy, w.load])];
  return vals.every((x) => Number.isFinite(x));
}

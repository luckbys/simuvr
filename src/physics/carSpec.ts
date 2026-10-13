import type { EngineSpec } from './vehicle/engine';
import type { GearboxSpec } from './vehicle/gearbox';

/** Dados base (de fábrica) do carro. O tuning modifica uma cópia resolvida disso. */
export interface CarSpec {
  id: string;
  name: string;
  /** Massa vazia (kg). */
  mass: number;
  /** Momentos de inércia principais (kg·m²): pitch (X), yaw (Y), roll (Z). */
  inertia: readonly [number, number, number];
  wheelbase: number;
  trackFront: number;
  trackRear: number;
  /** Fração do peso sobre o eixo dianteiro. */
  frontWeight: number;
  /** Altura do centro de massa com o carro parado e na altura original (m). */
  comHeight: number;
  /** Raio, largura e inércia de rotação de cada roda. */
  wheelRadius: number;
  wheelWidth: number;
  wheelInertia: number;
  body: {
    length: number;
    width: number;
    height: number;
    /** Vão livre do assoalho com a altura original (m). */
    clearance: number;
  };
  suspension: {
    springFront: number;
    springRear: number;
    /** Razão de amortecimento (ζ) em compressão e extensão. */
    zetaBump: number;
    zetaRebound: number;
    arbFront: number;
    arbRear: number;
    travel: number;
    /** Extensão total da mola na altura original (m). */
    lengthMax: number;
    /** Altura do ponto de fixação em relação ao centro de massa (m). */
    hardpointY: number;
  };
  engine: EngineSpec;
  gearbox: GearboxSpec;
  brakes: { maxFront: number; maxRear: number; handbrake: number };
  steering: { maxAngleDeg: number; ackermann: number; ratePerSec: number };
  aero: { cd: number; frontalArea: number };
  tireNominalLoad: number;
}

export const AIR_DENSITY = 1.2;
export const GRAVITY = 9.81;

/** Cupê esportivo traseiro turbo, fictício, com cara de clássico japonês dos anos 2000. */
export const HANABI_200S: CarSpec = {
  id: 'hanabi-200s',
  name: 'Hanabi 200S',
  mass: 1250,
  inertia: [2500, 2650, 720],
  wheelbase: 2.525,
  trackFront: 1.49,
  trackRear: 1.48,
  frontWeight: 0.54,
  comHeight: 0.49,
  wheelRadius: 0.31,
  wheelWidth: 0.225,
  wheelInertia: 1.2,
  body: { length: 4.45, width: 1.73, height: 1.31, clearance: 0.14 },
  suspension: {
    springFront: 38000,
    springRear: 34000,
    zetaBump: 0.3,
    zetaRebound: 0.5,
    arbFront: 15000,
    arbRear: 9000,
    travel: 0.17,
    lengthMax: 0.34,
    hardpointY: 0.08,
  },
  engine: {
    idleRpm: 900,
    redlineRpm: 7200,
    limiterRpm: 7400,
    inertia: 0.28,
    // Torque líquido aspirado; o turbo multiplica por (1 + ganho · boost).
    torqueCurve: [
      [0, 60],
      [1000, 95],
      [2000, 132],
      [3000, 152],
      [4000, 166],
      [5000, 176],
      [5500, 178],
      [6000, 175],
      [6500, 166],
      [7000, 150],
      [7500, 126],
    ],
    frictionBase: 16,
    frictionPerKrpm: 7,
    powerScale: 1,
    turbo: { maxBoost: 0.85, lag: 0.55, spoolStartRpm: 2500, spoolFullRpm: 4200, torqueGain: 0.9 },
  },
  gearbox: {
    ratios: [3.626, 2.2, 1.541, 1.213, 1.0, 0.767],
    reverse: 3.437,
    finalDrive: 3.937,
    efficiency: 0.92,
    shiftTimeAuto: 0.2,
    shiftTimeManual: 0.1,
  },
  brakes: { maxFront: 2200, maxRear: 1100, handbrake: 3800 },
  steering: { maxAngleDeg: 32, ackermann: 0.8, ratePerSec: 3.2 },
  aero: { cd: 0.35, frontalArea: 2.1 },
  tireNominalLoad: 3300,
};

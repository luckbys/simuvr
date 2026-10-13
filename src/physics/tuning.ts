import { AIR_DENSITY, GRAVITY, type CarSpec } from './carSpec';
import { DIFF_PRESETS, type DiffSpec, type DiffType } from './vehicle/differential';
import type { EngineSpec } from './vehicle/engine';
import type { GearboxSpec } from './vehicle/gearbox';
import type { SuspensionSpec } from './vehicle/suspension';
import type { TireParams } from './vehicle/pacejka';
import { clamp } from './vehicle/math';

// ---------------------------------------------------------------------------
// Opções de tuning (também alimentam a interface da garagem)
// ---------------------------------------------------------------------------

export type CompoundId = 'street' | 'sport' | 'drift' | 'slick';
export type TurboKitId = 'none' | 'stock' | 'sport' | 'race';
export type EcuId = 'stock' | 'stage1' | 'stage2';
export type BrakeKitId = 'stock' | 'sport' | 'race';
export type SpoilerId = 'none' | 'lip' | 'gt' | 'wing';
export type GearsetId = 'stock' | 'close';
export type SteerKitId = 'stock' | 'angle' | 'extreme';

export interface Option<T extends string> {
  id: T;
  label: string;
  hint: string;
}

export const COMPOUNDS: Record<CompoundId, TireParams & Option<CompoundId>> = {
  street: {
    id: 'street', label: 'Rua', hint: 'Aderência média, desgaste baixo',
    mu: 1.05, muLoadSens: 0.12, nominalLoad: 3300, peakSlipRatio: 0.12, peakSlipAngle: 0.15,
    C: 1.4, E: -0.5, lateralRatio: 1.0, relaxLength: 0.4, pneumaticTrail: 0.035, rollingResistance: 0.012,
  },
  sport: {
    id: 'sport', label: 'Esportivo', hint: 'Mais aderência, resposta rápida',
    mu: 1.2, muLoadSens: 0.13, nominalLoad: 3300, peakSlipRatio: 0.11, peakSlipAngle: 0.135,
    C: 1.42, E: -0.4, lateralRatio: 1.02, relaxLength: 0.34, pneumaticTrail: 0.035, rollingResistance: 0.014,
  },
  drift: {
    id: 'drift', label: 'Drift', hint: 'Composto duro: derrapa cedo e é fácil de segurar',
    mu: 0.96, muLoadSens: 0.1, nominalLoad: 3300, peakSlipRatio: 0.13, peakSlipAngle: 0.18,
    C: 1.28, E: -0.6, lateralRatio: 0.98, relaxLength: 0.45, pneumaticTrail: 0.04, rollingResistance: 0.011,
  },
  slick: {
    id: 'slick', label: 'Semi-slick', hint: 'Aderência máxima, queda brusca no limite',
    mu: 1.38, muLoadSens: 0.16, nominalLoad: 3300, peakSlipRatio: 0.1, peakSlipAngle: 0.115,
    C: 1.52, E: -0.2, lateralRatio: 1.03, relaxLength: 0.3, pneumaticTrail: 0.032, rollingResistance: 0.016,
  },
};

export const TURBO_KITS: Record<TurboKitId, Option<TurboKitId> & {
  maxBoost: number; lag: number; spoolStartRpm: number; spoolFullRpm: number; mass: number;
}> = {
  none: { id: 'none', label: 'Aspirado', hint: 'Sem turbo', maxBoost: 0, lag: 0.5, spoolStartRpm: 2500, spoolFullRpm: 4200, mass: -22 },
  stock: { id: 'stock', label: 'Original', hint: 'Resposta rápida, 0,85 bar', maxBoost: 0.85, lag: 0.55, spoolStartRpm: 2500, spoolFullRpm: 4200, mass: 0 },
  sport: { id: 'sport', label: 'Esportivo', hint: '1,15 bar, mais atraso', maxBoost: 1.15, lag: 0.7, spoolStartRpm: 3000, spoolFullRpm: 4800, mass: 4 },
  race: { id: 'race', label: 'Competição', hint: '1,55 bar, só acima de 4.000 rpm', maxBoost: 1.55, lag: 0.95, spoolStartRpm: 3800, spoolFullRpm: 5600, mass: 9 },
};

export const ECU_STAGES: Record<EcuId, Option<EcuId> & { power: number; boostAdd: number }> = {
  stock: { id: 'stock', label: 'Original', hint: 'Mapa de fábrica', power: 1, boostAdd: 0 },
  stage1: { id: 'stage1', label: 'Stage 1', hint: '+8% de potência', power: 1.08, boostAdd: 0.08 },
  stage2: { id: 'stage2', label: 'Stage 2', hint: '+16% de potência', power: 1.16, boostAdd: 0.18 },
};

export const BRAKE_KITS: Record<BrakeKitId, Option<BrakeKitId> & { front: number; rear: number }> = {
  stock: { id: 'stock', label: 'Original', hint: '', front: 2200, rear: 1100 },
  sport: { id: 'sport', label: 'Esportivo', hint: 'Discos maiores', front: 2900, rear: 1500 },
  race: { id: 'race', label: 'Competição', hint: 'Pinças de 6 pistões', front: 3600, rear: 1900 },
};

export const SPOILERS: Record<SpoilerId, Option<SpoilerId> & { downforce: number; drag: number; mass: number; rearBias: number }> = {
  none: { id: 'none', label: 'Nenhum', hint: '', downforce: 0, drag: 0, mass: 0, rearBias: 0.5 },
  lip: { id: 'lip', label: 'Lip', hint: 'Discreto', downforce: 0.04, drag: 0.004, mass: 1, rearBias: 0.6 },
  gt: { id: 'gt', label: 'Asa GT', hint: 'Equilíbrio', downforce: 0.2, drag: 0.02, mass: 5, rearBias: 0.75 },
  wing: { id: 'wing', label: 'Asa alta', hint: 'Muita pressão, muito arrasto', downforce: 0.4, drag: 0.05, mass: 8, rearBias: 0.85 },
};

export const GEARSETS: Record<GearsetId, Option<GearsetId> & { mult: number }> = {
  stock: { id: 'stock', label: 'Original', hint: '', mult: 1 },
  close: { id: 'close', label: 'Relação curta', hint: 'Mais aceleração, menos velocidade final', mult: 1.12 },
};

export const STEER_KITS: Record<SteerKitId, Option<SteerKitId> & { maxAngleDeg: number }> = {
  stock: { id: 'stock', label: 'Original', hint: '32°', maxAngleDeg: 32 },
  angle: { id: 'angle', label: 'Kit de ângulo', hint: '48°, ideal para drift', maxAngleDeg: 48 },
  extreme: { id: 'extreme', label: 'Ângulo extremo', hint: '62°', maxAngleDeg: 62 },
};

export interface TuningState {
  // Suspensão
  /** Rebaixamento em metros (0..0,08). */
  rideHeightDrop: number;
  springFront: number;
  springRear: number;
  damperFront: number;
  damperRear: number;
  arbFront: number;
  arbRear: number;
  /** Cambagem estática em graus (negativo = topo da roda para dentro). */
  camberFront: number;
  camberRear: number;
  // Pneus
  tireFront: CompoundId;
  tireRear: CompoundId;
  // Motor
  turbo: TurboKitId;
  ecu: EcuId;
  intakeExhaust: boolean;
  weightReduction: number;
  // Transmissão
  gearset: GearsetId;
  finalDriveMult: number;
  diff: DiffType;
  /** Pré-carga do diferencial, 0..1 (0,5 = padrão da predefinição). */
  diffPreload: number;
  // Freios, direção e aerodinâmica
  brakes: BrakeKitId;
  /** Fração da frenagem no eixo dianteiro. */
  brakeBias: number;
  steerKit: SteerKitId;
  spoiler: SpoilerId;
}

export function defaultTuning(): TuningState {
  return {
    rideHeightDrop: 0,
    springFront: 1,
    springRear: 1,
    damperFront: 1,
    damperRear: 1,
    arbFront: 1,
    arbRear: 1,
    camberFront: -1,
    camberRear: -1,
    tireFront: 'street',
    tireRear: 'street',
    turbo: 'stock',
    ecu: 'stock',
    intakeExhaust: false,
    weightReduction: 0,
    gearset: 'stock',
    finalDriveMult: 1,
    diff: 'open',
    diffPreload: 0.5,
    brakes: 'stock',
    brakeBias: 0.667,
    steerKit: 'stock',
    spoiler: 'none',
  };
}

/** Predefinição de drift: o que a cena tuning monta primeiro. */
export function driftTuning(): TuningState {
  return {
    ...defaultTuning(),
    rideHeightDrop: 0.04,
    springFront: 1.25,
    springRear: 1.1,
    damperFront: 1.3,
    damperRear: 1.2,
    arbFront: 1.3,
    arbRear: 0.6,
    camberFront: -5,
    camberRear: -1.5,
    tireFront: 'sport',
    tireRear: 'drift',
    turbo: 'sport',
    ecu: 'stage1',
    intakeExhaust: true,
    weightReduction: 40,
    diff: 'locked',
    brakeBias: 0.6,
    brakes: 'sport',
    steerKit: 'angle',
    spoiler: 'gt',
  };
}

/** Predefinição de grip (rua rápida). */
export function gripTuning(): TuningState {
  return {
    ...defaultTuning(),
    rideHeightDrop: 0.03,
    springFront: 1.3,
    springRear: 1.3,
    damperFront: 1.3,
    damperRear: 1.3,
    arbFront: 1.2,
    arbRear: 1.2,
    camberFront: -3,
    camberRear: -2,
    tireFront: 'slick',
    tireRear: 'slick',
    turbo: 'sport',
    ecu: 'stage1',
    diff: 'lsd2',
    brakes: 'race',
    spoiler: 'gt',
  };
}

export function clampTuning(t: TuningState): TuningState {
  return {
    ...t,
    rideHeightDrop: clamp(t.rideHeightDrop, 0, 0.08),
    springFront: clamp(t.springFront, 0.8, 2),
    springRear: clamp(t.springRear, 0.8, 2),
    damperFront: clamp(t.damperFront, 0.7, 1.8),
    damperRear: clamp(t.damperRear, 0.7, 1.8),
    arbFront: clamp(t.arbFront, 0, 2.5),
    arbRear: clamp(t.arbRear, 0, 2.5),
    camberFront: clamp(t.camberFront, -8, 0),
    camberRear: clamp(t.camberRear, -8, 0),
    weightReduction: clamp(t.weightReduction, 0, 100),
    finalDriveMult: clamp(t.finalDriveMult, 0.85, 1.2),
    diffPreload: clamp(t.diffPreload, 0, 1),
    brakeBias: clamp(t.brakeBias, 0.4, 0.8),
  };
}

// ---------------------------------------------------------------------------
// Parâmetros resolvidos, consumidos pelo veículo
// ---------------------------------------------------------------------------

export type WheelId = 'FL' | 'FR' | 'RL' | 'RR';

export interface WheelParams {
  id: WheelId;
  front: boolean;
  right: boolean;
  /** Ponto de fixação da suspensão no referencial do chassi (origem no centro de massa). */
  hardpoint: readonly [number, number, number];
  radius: number;
  width: number;
  inertia: number;
  susp: SuspensionSpec;
  /** Cambagem estática em radianos; negativo = topo para dentro (simétrica nos dois lados). */
  camber: number;
  tire: TireParams;
}

export interface VehicleParams {
  name: string;
  mass: number;
  inertia: readonly [number, number, number];
  wheelbase: number;
  trackFront: number;
  trackRear: number;
  /** Altura do centro de massa com o carro na altura de repouso resolvida (m). */
  comHeightStatic: number;
  wheels: readonly [WheelParams, WheelParams, WheelParams, WheelParams];
  engine: EngineSpec;
  gearbox: GearboxSpec;
  diff: DiffSpec;
  diffType: DiffType;
  driveAxle: 'rear' | 'front';
  /** Capacidade e rigidez da embreagem (N·m, N·m·s/rad). */
  clutchCapacity: number;
  clutchStiffness: number;
  brakes: { maxFront: number; maxRear: number; handbrake: number };
  steering: { maxAngleRad: number; ackermann: number; ratePerSec: number };
  aero: { dragCoef: number; downforceFront: number; downforceRear: number };
  body: CarSpec['body'] & { bottomLocalY: number };
  /** Abafador do escapamento, 0..1, para áudio. */
  exhaustOpenness: number;
}

const WHEEL_IDS: ReadonlyArray<[WheelId, boolean, boolean]> = [
  ['FL', true, false],
  ['FR', true, true],
  ['RL', false, false],
  ['RR', false, true],
];

export function resolveVehicleParams(spec: CarSpec, input: TuningState): VehicleParams {
  const t = clampTuning(input);
  const turbo = TURBO_KITS[t.turbo];
  const ecu = ECU_STAGES[t.ecu];
  const spoiler = SPOILERS[t.spoiler];
  const brakeKit = BRAKE_KITS[t.brakes];
  const gearset = GEARSETS[t.gearset];
  const steerKit = STEER_KITS[t.steerKit];

  const mass = spec.mass - t.weightReduction + turbo.mass + spoiler.mass;

  // Distribuição de peso: o centro de massa fica entre os eixos de acordo com frontWeight.
  const b = spec.frontWeight * spec.wheelbase; // distância CG → eixo traseiro
  const a = spec.wheelbase - b; // distância CG → eixo dianteiro

  const staticLoadFront = (mass * GRAVITY * spec.frontWeight) / 2;
  const staticLoadRear = (mass * GRAVITY * (1 - spec.frontWeight)) / 2;

  const lengthMax = spec.suspension.lengthMax - t.rideHeightDrop;
  const mkSusp = (front: boolean): SuspensionSpec => {
    const k = (front ? spec.suspension.springFront * t.springFront : spec.suspension.springRear * t.springRear);
    const damp = front ? t.damperFront : t.damperRear;
    const sprung = (front ? staticLoadFront : staticLoadRear) / GRAVITY;
    const cCrit = 2 * Math.sqrt(k * sprung);
    const arbBase = front ? spec.suspension.arbFront * t.arbFront : spec.suspension.arbRear * t.arbRear;
    return {
      k,
      cBump: cCrit * spec.suspension.zetaBump * damp,
      cRebound: cCrit * spec.suspension.zetaRebound * damp,
      arb: arbBase,
      lengthMax,
      // Rebaixar encurta o curso útil de compressão.
      travel: spec.suspension.travel - t.rideHeightDrop * 0.5,
      bumpStopK: 450000,
      bumpStopRange: 0.035,
    };
  };

  const suspFront = mkSusp(true);
  const suspRear = mkSusp(false);

  // Compressão estática e comprimento de repouso -> altura do CG no solo.
  const xs = staticLoadFront / suspFront.k;
  const lStatic = lengthMax - xs;
  const comHeightStatic = spec.wheelRadius + lStatic - spec.suspension.hardpointY;

  const tireOf = (id: CompoundId): TireParams => ({ ...COMPOUNDS[id], nominalLoad: spec.tireNominalLoad });

  const wheels = WHEEL_IDS.map(([id, front, right]) => {
    const x = (front ? spec.trackFront : spec.trackRear) / 2 * (right ? 1 : -1);
    const z = front ? -a : b;
    const camberDeg = front ? t.camberFront : t.camberRear;
    return {
      id,
      front,
      right,
      hardpoint: [x, spec.suspension.hardpointY, z] as const,
      radius: spec.wheelRadius,
      width: spec.wheelWidth,
      inertia: spec.wheelInertia,
      susp: front ? suspFront : suspRear,
      // Cambagem em rad, igual nos dois lados: negativo = topo da roda para dentro.
      camber: (camberDeg * Math.PI) / 180,
      tire: tireOf(front ? t.tireFront : t.tireRear),
    } satisfies WheelParams;
  }) as unknown as VehicleParams['wheels'];

  // Motor: kit de turbo + ECU + escape/admissão.
  const maxBoost = turbo.maxBoost > 0 ? turbo.maxBoost + ecu.boostAdd : 0;
  const engine: EngineSpec = {
    ...spec.engine,
    powerScale: spec.engine.powerScale * ecu.power * (t.intakeExhaust ? 1.04 : 1),
    turbo: {
      ...spec.engine.turbo,
      maxBoost,
      lag: turbo.lag,
      spoolStartRpm: turbo.spoolStartRpm,
      spoolFullRpm: turbo.spoolFullRpm,
    },
  };

  const gearbox: GearboxSpec = {
    ...spec.gearbox,
    finalDrive: spec.gearbox.finalDrive * gearset.mult * t.finalDriveMult,
  };

  const preset = DIFF_PRESETS[t.diff];
  const preloadScale = 0.25 + 1.5 * t.diffPreload; // 0 → 0,25×; 0,5 → 1×; 1 → 1,75×
  const diff: DiffSpec = {
    preload: preset.preload * preloadScale,
    powerLock: preset.powerLock,
    coastLock: preset.coastLock,
    maxLock: preset.maxLock,
    width: 3,
  };

  // Torque de pico estimado para dimensionar a embreagem.
  let peak = 0;
  for (const [, tq] of engine.torqueCurve) peak = Math.max(peak, tq);
  const peakTorque = peak * engine.powerScale * (1 + engine.turbo.torqueGain * maxBoost);

  const totalBrake = brakeKit.front + brakeKit.rear;
  const brakes = {
    maxFront: totalBrake * t.brakeBias,
    maxRear: totalBrake * (1 - t.brakeBias),
    handbrake: spec.brakes.handbrake,
  };

  const aeroBase = 0.5 * AIR_DENSITY * spec.aero.cd * spec.aero.frontalArea;
  const downforce = 0.5 * AIR_DENSITY * spoiler.downforce;

  return {
    name: spec.name,
    mass,
    inertia: spec.inertia,
    wheelbase: spec.wheelbase,
    trackFront: spec.trackFront,
    trackRear: spec.trackRear,
    comHeightStatic,
    wheels,
    engine,
    gearbox,
    diff,
    diffType: t.diff,
    driveAxle: 'rear',
    clutchCapacity: peakTorque * 1.8,
    clutchStiffness: 120,
    brakes,
    steering: {
      maxAngleRad: (steerKit.maxAngleDeg * Math.PI) / 180,
      ackermann: spec.steering.ackermann,
      ratePerSec: spec.steering.ratePerSec,
    },
    aero: {
      dragCoef: aeroBase + 0.5 * AIR_DENSITY * spoiler.drag,
      downforceFront: downforce * (1 - spoiler.rearBias),
      downforceRear: downforce * spoiler.rearBias,
    },
    body: { ...spec.body, bottomLocalY: -(comHeightStatic - (spec.body.clearance - t.rideHeightDrop)) },
    exhaustOpenness: (t.intakeExhaust ? 0.7 : 0.3) + (turbo.maxBoost > 1 ? 0.15 : 0),
  };
}

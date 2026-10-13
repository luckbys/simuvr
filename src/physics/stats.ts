import type { VehicleParams } from './tuning';
import { Curve, RADS_TO_RPM_FACTOR } from './statsMath';

export interface CarStats {
  /** Pico de potência (cv) e a rotação em que ocorre. */
  peakPowerHp: number;
  peakPowerRpm: number;
  /** Pico de torque (N·m) e a rotação. */
  peakTorque: number;
  peakTorqueRpm: number;
  mass: number;
  /** Potência por tonelada (cv/t). */
  powerToWeight: number;
  /** Velocidade final estimada (km/h): limitada por arrasto ou pela última marcha. */
  topSpeedKmh: number;
  /** Vão livre do assoalho ao chão (cm). */
  groundClearanceCm: number;
  /** Pressão de turbo (bar). */
  boostBar: number;
  /** Atrito de pico médio dos pneus dianteiros e traseiros. */
  gripFront: number;
  gripRear: number;
  /** Pressão aerodinâmica a 150 km/h (kgf). */
  downforceKgf: number;
}

const HP_PER_KW = 1.34102;

/** Estatísticas aproximadas do carro, derivadas dos parâmetros resolvidos (função pura). */
export function estimateStats(p: VehicleParams): CarStats {
  const e = p.engine;
  const curve = new Curve(e.torqueCurve);
  const boostGain = 1 + e.turbo.torqueGain * e.turbo.maxBoost;
  const torqueAt = (rpm: number) => curve.eval(rpm) * e.powerScale * boostGain;

  let peakT = 0, peakTRpm = 0, peakP = 0, peakPRpm = 0;
  for (let rpm = 1000; rpm <= e.redlineRpm; rpm += 50) {
    const t = torqueAt(rpm);
    const w = (rpm * Math.PI * 2) / 60;
    if (t > peakT) { peakT = t; peakTRpm = rpm; }
    if (t * w > peakP) { peakP = t * w; peakPRpm = rpm; }
  }
  const peakHp = (peakP / 1000) * HP_PER_KW;

  // Velocidade final: maior v em que a potência nas rodas (melhor marcha) cobre arrasto + rolamento.
  const R = p.wheels[0].radius;
  const eta = p.gearbox.efficiency;
  const crr = 0.013 * p.mass * 9.81;
  let top = 0;
  for (let v = 15; v <= 130; v += 0.25) {
    let best = 0;
    for (const g of p.gearbox.ratios) {
      const rpm = (v / R) * g * p.gearbox.finalDrive * RADS_TO_RPM_FACTOR;
      if (rpm > e.limiterRpm || rpm < 1500) continue;
      const w = (rpm * Math.PI * 2) / 60;
      best = Math.max(best, torqueAt(rpm) * w * eta);
    }
    const need = p.aero.dragCoef * v * v * v + crr * v;
    if (best >= need) top = v;
    else if (best === 0 && v > top + 5) break; // acima do limite da última marcha
  }

  const gripF = (p.wheels[0].tire.mu + p.wheels[1].tire.mu) / 2;
  const gripR = (p.wheels[2].tire.mu + p.wheels[3].tire.mu) / 2;
  const v150 = 150 / 3.6;
  const df = (p.aero.downforceFront + p.aero.downforceRear) * v150 * v150;

  return {
    peakPowerHp: peakHp,
    peakPowerRpm: peakPRpm,
    peakTorque: peakT,
    peakTorqueRpm: peakTRpm,
    mass: p.mass,
    powerToWeight: peakHp / (p.mass / 1000),
    topSpeedKmh: top * 3.6,
    groundClearanceCm: (p.comHeightStatic + p.body.bottomLocalY) * 100,
    boostBar: e.turbo.maxBoost,
    gripFront: gripF,
    gripRear: gripR,
    downforceKgf: df / 9.81,
  };
}

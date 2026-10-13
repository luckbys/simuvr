import { clamp, lerp, smoothstep } from '../physics/vehicle/math';

/** Mapeamento puro: estado do carro → parâmetros de síntese. Testável sem Web Audio. */

export interface EngineSoundInput {
  rpm: number;
  /** 0..1 */
  throttle: number;
  /** Pressão do turbo como fração da máxima (0..1). */
  boostRatio: number;
  idleRpm: number;
  limiterRpm: number;
  fuelCut: boolean;
  /** 0 = abafado, 1 = escape livre. */
  exhaustOpen: number;
}

export interface EngineSound {
  /** Frequência de disparo fundamental (Hz): 4 cilindros, 4 tempos → 2 explosões por volta. */
  f0: number;
  gainSaw: number;
  gainSquare: number;
  gainSub: number;
  gainNoise: number;
  /** Ganho antes do waveshaper (distorção). */
  drive: number;
  cutoff: number;
  q: number;
  master: number;
  whistleFreq: number;
  whistleGain: number;
}

export const CYLINDERS = 4;

export function engineSoundParams(i: EngineSoundInput): EngineSound {
  const rpmN = clamp((i.rpm - i.idleRpm) / Math.max(1, i.limiterRpm - i.idleRpm), 0, 1.1);
  const load = clamp(i.throttle, 0, 1);
  const open = clamp(i.exhaustOpen, 0, 1);
  const cut = i.fuelCut ? 0.12 : 1;
  const whistleOn = lerp(0.25, 1, smoothstep(0.2, 0.6, load));
  return {
    f0: (i.rpm / 60) * (CYLINDERS / 2),
    gainSaw: 0.5,
    gainSquare: 0.16 + 0.26 * load,
    gainSub: 0.34 * (1 - rpmN * 0.7),
    gainNoise: 0.03 + 0.13 * load * (0.4 + 0.6 * rpmN),
    drive: 1.4 + 4.2 * load * (0.4 + 0.6 * open),
    cutoff: 260 + i.rpm * 0.3 * (0.55 + 0.95 * load) + open * 650,
    q: 0.8 + 2.2 * load * open,
    master: (0.1 + 0.3 * load + 0.12 * rpmN) * cut,
    whistleFreq: 2200 + 6500 * clamp(i.boostRatio, 0, 1),
    whistleGain: (0.015 + 0.13 * clamp(i.boostRatio, 0, 1)) * whistleOn * cut,
  };
}

export interface TireSquealInput {
  /** Escorregamento combinado normalizado do eixo (> 1 = além do pico). */
  slip: number;
  speedKmh: number;
  onGround: boolean;
  wet: boolean;
}

export interface TireSquealSound {
  gain: number;
  /** Frequência central do filtro (Hz): sobe um pouco com a velocidade. */
  freq: number;
  q: number;
}

export function tireSquealParams(i: TireSquealInput): TireSquealSound {
  if (!i.onGround) return { gain: 0, freq: 1400, q: 4 };
  const over = smoothstep(0.85, 1.9, i.slip);
  const speed = smoothstep(4, 40, i.speedKmh);
  return {
    gain: over * speed * (i.wet ? 0.55 : 0.8) * 0.28,
    freq: 1050 + 900 * smoothstep(10, 120, i.speedKmh) + 450 * clamp(i.slip - 1, 0, 1.5),
    q: 3.5 + 3 * (1 - over),
  };
}

export interface WindInput {
  speedKmh: number;
  insideCar: boolean;
}

export function windGain(i: WindInput): number {
  const v = clamp(i.speedKmh / 220, 0, 1.4);
  return (0.01 + 0.5 * v * v) * (i.insideCar ? 0.55 : 1) * 0.35;
}

/** Fecha as janelas: atenuação (passa-baixa) dos sons externos quando o jogador está dentro do carro. */
export function cabinCutoff(insideCar: boolean, windowTint = 0.7): number {
  return insideCar ? 2600 - 600 * windowTint : 18000;
}

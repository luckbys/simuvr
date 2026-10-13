import { defaultLook, type CarLook, type PaintFinish } from '../car/carView';
import {
  BRAKE_KITS, COMPOUNDS, ECU_STAGES, GEARSETS, SPOILERS, STEER_KITS, TURBO_KITS,
  clampTuning, defaultTuning, driftTuning, gripTuning, type TuningState,
} from '../physics/tuning';
import { DIFF_PRESETS } from '../physics/vehicle/differential';

export interface GarageState {
  tuning: TuningState;
  look: CarLook;
}

export const PAINT_COLORS = ['#e0158a', '#27e8ff', '#ffb02f', '#7a5cff', '#3dff9a', '#f5f5fa', '#ff3b30', '#1d4bff', '#c8ff2f', '#ff7a1a', '#111118', '#8a8fa3'];
export const RIM_COLORS = ['#c9ced6', '#ffd24a', '#111111', '#ff2fb3', '#27e8ff', '#e8e8f0', '#ff3b30', '#7a5cff'];
export const GLOW_COLORS = ['off', '#27e8ff', '#ff2fb3', '#7a5cff', '#3dff9a', '#ffb02f', '#ff3b30', '#ffffff'];
export const FINISHES: PaintFinish[] = ['gloss', 'metallic', 'matte', 'pearl', 'chrome'];
export const TINTS = [0.35, 0.7, 0.92];

export function defaultGarage(): GarageState {
  return { tuning: defaultTuning(), look: defaultLook() };
}

export interface Preset {
  id: string;
  label: string;
  make(): GarageState;
}

export const PRESETS: Preset[] = [
  { id: 'stock', label: 'Original', make: defaultGarage },
  {
    id: 'drift',
    label: 'Drift',
    make: () => ({
      tuning: driftTuning(),
      look: { paint: '#7a5cff', finish: 'pearl', rimColor: '#27e8ff', underglow: '#ff2fb3', spoiler: 'gt', windowTint: 0.92 },
    }),
  },
  {
    id: 'grip',
    label: 'Grip',
    make: () => ({
      tuning: gripTuning(),
      look: { paint: '#f5f5fa', finish: 'gloss', rimColor: '#ffd24a', underglow: null, spoiler: 'gt', windowTint: 0.7 },
    }),
  },
  {
    id: 'show',
    label: 'Show',
    make: () => ({
      tuning: { ...defaultTuning(), rideHeightDrop: 0.07, camberFront: -6, camberRear: -6, springFront: 1.3, springRear: 1.3, spoiler: 'wing', tireFront: 'sport', tireRear: 'sport' },
      look: { paint: '#e0158a', finish: 'chrome', rimColor: '#ffd24a', underglow: '#27e8ff', spoiler: 'wing', windowTint: 0.92 },
    }),
  },
];

const KEY = 'simuvr.garage.v1';
const HEX = /^#[0-9a-fA-F]{6}$/;

const isIn = <T extends object>(table: T, v: unknown): v is keyof T => typeof v === 'string' && v in table;

/** Valida e normaliza um estado vindo de fora (localStorage, importação): nunca devolve lixo. */
export function sanitizeGarage(raw: unknown): GarageState {
  const base = defaultGarage();
  if (!raw || typeof raw !== 'object') return base;
  const r = raw as { tuning?: Record<string, unknown>; look?: Record<string, unknown> };
  const t = { ...base.tuning };
  const src = r.tuning ?? {};
  const num = (k: keyof TuningState) => {
    const v = src[k as string];
    if (typeof v === 'number' && Number.isFinite(v)) (t as Record<string, unknown>)[k as string] = v;
  };
  for (const k of ['rideHeightDrop', 'springFront', 'springRear', 'damperFront', 'damperRear', 'arbFront', 'arbRear', 'camberFront', 'camberRear', 'weightReduction', 'finalDriveMult', 'diffPreload', 'brakeBias'] as const) num(k);
  if (isIn(COMPOUNDS, src.tireFront)) t.tireFront = src.tireFront;
  if (isIn(COMPOUNDS, src.tireRear)) t.tireRear = src.tireRear;
  if (isIn(TURBO_KITS, src.turbo)) t.turbo = src.turbo;
  if (isIn(ECU_STAGES, src.ecu)) t.ecu = src.ecu;
  if (typeof src.intakeExhaust === 'boolean') t.intakeExhaust = src.intakeExhaust;
  if (isIn(GEARSETS, src.gearset)) t.gearset = src.gearset;
  if (isIn(DIFF_PRESETS, src.diff)) t.diff = src.diff;
  if (isIn(BRAKE_KITS, src.brakes)) t.brakes = src.brakes;
  if (isIn(STEER_KITS, src.steerKit)) t.steerKit = src.steerKit;
  if (isIn(SPOILERS, src.spoiler)) t.spoiler = src.spoiler;

  const look = { ...base.look };
  const l = r.look ?? {};
  if (typeof l.paint === 'string' && HEX.test(l.paint)) look.paint = l.paint;
  if (typeof l.rimColor === 'string' && HEX.test(l.rimColor)) look.rimColor = l.rimColor;
  if (l.underglow === null || (typeof l.underglow === 'string' && HEX.test(l.underglow))) look.underglow = l.underglow as string | null;
  if (typeof l.finish === 'string' && (FINISHES as string[]).includes(l.finish)) look.finish = l.finish as PaintFinish;
  if (typeof l.windowTint === 'number' && Number.isFinite(l.windowTint)) look.windowTint = Math.min(1, Math.max(0, l.windowTint));
  const tuning = clampTuning(t);
  look.spoiler = tuning.spoiler; // o visual do aerofólio sempre acompanha o tuning
  return { tuning, look };
}

export function loadGarage(): GarageState {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return sanitizeGarage(JSON.parse(raw));
  } catch {
    /* storage indisponível ou JSON corrompido */
  }
  return defaultGarage();
}

export function saveGarage(s: GarageState): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* ignorar */
  }
}

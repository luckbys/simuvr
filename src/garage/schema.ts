import {
  BRAKE_KITS, COMPOUNDS, ECU_STAGES, GEARSETS, SPOILERS, STEER_KITS, TURBO_KITS,
  type TuningState,
} from '../physics/tuning';
import { DIFF_PRESETS } from '../physics/vehicle/differential';
import type { PaintFinish } from '../car/carView';
import { FINISHES, GLOW_COLORS, PAINT_COLORS, RIM_COLORS, TINTS, type GarageState } from './state';

export interface Choice {
  id: string;
  label: string;
  hint?: string;
}

export type Control =
  | { kind: 'slider'; label: string; min: number; max: number; step: number; get(s: GarageState): number; set(s: GarageState, v: number): void; fmt(v: number): string }
  | { kind: 'choice'; label: string; options: Choice[]; get(s: GarageState): string; set(s: GarageState, id: string): void }
  | { kind: 'color'; label: string; colors: string[]; get(s: GarageState): string; set(s: GarageState, c: string): void };

export interface Tab {
  id: string;
  label: string;
  controls: Control[];
}

const opts = <T extends { label: string; hint?: string }>(table: Record<string, T>): Choice[] =>
  Object.entries(table).map(([id, v]) => ({ id, label: v.label, hint: v.hint }));

const FINISH_LABEL: Record<PaintFinish, string> = { gloss: 'Brilho', metallic: 'Metálico', matte: 'Fosco', pearl: 'Perolado', chrome: 'Cromado' };

const t = <K extends keyof TuningState>(k: K) => ({
  get: (s: GarageState) => s.tuning[k] as number,
  set: (s: GarageState, v: number) => { (s.tuning[k] as number) = v; },
});

const mm = (v: number) => `${Math.round(v * 1000)} mm`;
const x = (v: number) => `${v.toFixed(2)}×`;
const deg = (v: number) => `${v.toFixed(1)}°`;

export const TABS: Tab[] = [
  {
    id: 'visual',
    label: 'Visual',
    controls: [
      { kind: 'color', label: 'Cor da pintura', colors: PAINT_COLORS, get: (s) => s.look.paint, set: (s, c) => { s.look.paint = c; } },
      {
        kind: 'choice', label: 'Acabamento',
        options: FINISHES.map((f) => ({ id: f, label: FINISH_LABEL[f] })),
        get: (s) => s.look.finish, set: (s, id) => { s.look.finish = id as PaintFinish; },
      },
      { kind: 'color', label: 'Cor das rodas', colors: RIM_COLORS, get: (s) => s.look.rimColor, set: (s, c) => { s.look.rimColor = c; } },
      {
        kind: 'color', label: 'Neon inferior', colors: GLOW_COLORS,
        get: (s) => s.look.underglow ?? 'off', set: (s, c) => { s.look.underglow = c === 'off' ? null : c; },
      },
      {
        kind: 'choice', label: 'Vidros',
        options: [{ id: '0', label: 'Claro' }, { id: '1', label: 'Médio' }, { id: '2', label: 'Escuro' }],
        get: (s) => String(Math.max(0, TINTS.findIndex((v) => Math.abs(v - s.look.windowTint) < 0.01))),
        set: (s, id) => { s.look.windowTint = TINTS[Number(id)] ?? 0.7; },
      },
    ],
  },
  {
    id: 'altura',
    label: 'Altura',
    controls: [
      { kind: 'slider', label: 'Rebaixamento', min: 0, max: 0.08, step: 0.005, fmt: mm, ...t('rideHeightDrop') },
      { kind: 'slider', label: 'Molas dianteiras', min: 0.8, max: 2, step: 0.05, fmt: x, ...t('springFront') },
      { kind: 'slider', label: 'Molas traseiras', min: 0.8, max: 2, step: 0.05, fmt: x, ...t('springRear') },
      { kind: 'slider', label: 'Amortecedor diant.', min: 0.7, max: 1.8, step: 0.05, fmt: x, ...t('damperFront') },
      { kind: 'slider', label: 'Amortecedor tras.', min: 0.7, max: 1.8, step: 0.05, fmt: x, ...t('damperRear') },
    ],
  },
  {
    id: 'barras',
    label: 'Barras',
    controls: [
      { kind: 'slider', label: 'Barra diant. (0 = sem)', min: 0, max: 2.5, step: 0.1, fmt: x, ...t('arbFront') },
      { kind: 'slider', label: 'Barra tras. (0 = sem)', min: 0, max: 2.5, step: 0.1, fmt: x, ...t('arbRear') },
      { kind: 'slider', label: 'Cambagem diant.', min: -8, max: 0, step: 0.5, fmt: deg, ...t('camberFront') },
      { kind: 'slider', label: 'Cambagem tras.', min: -8, max: 0, step: 0.5, fmt: deg, ...t('camberRear') },
    ],
  },
  {
    id: 'pneus',
    label: 'Pneus',
    controls: [
      { kind: 'choice', label: 'Pneus dianteiros', options: opts(COMPOUNDS), get: (s) => s.tuning.tireFront, set: (s, id) => { s.tuning.tireFront = id as TuningState['tireFront']; } },
      { kind: 'choice', label: 'Pneus traseiros', options: opts(COMPOUNDS), get: (s) => s.tuning.tireRear, set: (s, id) => { s.tuning.tireRear = id as TuningState['tireRear']; } },
    ],
  },
  {
    id: 'motor',
    label: 'Motor',
    controls: [
      { kind: 'choice', label: 'Turbo', options: opts(TURBO_KITS), get: (s) => s.tuning.turbo, set: (s, id) => { s.tuning.turbo = id as TuningState['turbo']; } },
      { kind: 'choice', label: 'Mapa da ECU', options: opts(ECU_STAGES), get: (s) => s.tuning.ecu, set: (s, id) => { s.tuning.ecu = id as TuningState['ecu']; } },
      {
        kind: 'choice', label: 'Escape e admissão',
        options: [{ id: 'stock', label: 'Original' }, { id: 'sport', label: 'Esportivo (+4%)' }],
        get: (s) => (s.tuning.intakeExhaust ? 'sport' : 'stock'), set: (s, id) => { s.tuning.intakeExhaust = id === 'sport'; },
      },
      { kind: 'slider', label: 'Redução de peso', min: 0, max: 100, step: 5, fmt: (v) => `${Math.round(v)} kg`, ...t('weightReduction') },
    ],
  },
  {
    id: 'cambio',
    label: 'Câmbio',
    controls: [
      { kind: 'choice', label: 'Relações', options: opts(GEARSETS), get: (s) => s.tuning.gearset, set: (s, id) => { s.tuning.gearset = id as TuningState['gearset']; } },
      { kind: 'slider', label: 'Relação final', min: 0.85, max: 1.2, step: 0.01, fmt: x, ...t('finalDriveMult') },
      { kind: 'choice', label: 'Diferencial', options: opts(DIFF_PRESETS), get: (s) => s.tuning.diff, set: (s, id) => { s.tuning.diff = id as TuningState['diff']; } },
      { kind: 'slider', label: 'Pré-carga do diferencial', min: 0, max: 1, step: 0.05, fmt: (v) => `${Math.round(v * 100)}%`, ...t('diffPreload') },
    ],
  },
  {
    id: 'freios',
    label: 'Freio',
    controls: [
      { kind: 'choice', label: 'Kit de freios', options: opts(BRAKE_KITS), get: (s) => s.tuning.brakes, set: (s, id) => { s.tuning.brakes = id as TuningState['brakes']; } },
      { kind: 'slider', label: 'Balanço (frente)', min: 0.4, max: 0.8, step: 0.01, fmt: (v) => `${Math.round(v * 100)}%`, ...t('brakeBias') },
      { kind: 'choice', label: 'Ângulo de esterço', options: opts(STEER_KITS), get: (s) => s.tuning.steerKit, set: (s, id) => { s.tuning.steerKit = id as TuningState['steerKit']; } },
    ],
  },
  {
    id: 'aero',
    label: 'Aero',
    controls: [
      { kind: 'choice', label: 'Aerofólio', options: opts(SPOILERS), get: (s) => s.tuning.spoiler, set: (s, id) => { s.tuning.spoiler = id as TuningState['spoiler']; } },
    ],
  },
];

export function allControls(): Control[] {
  return TABS.flatMap((tab) => tab.controls);
}

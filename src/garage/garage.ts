import { HANABI_200S } from '../physics/carSpec';
import { clampTuning, resolveVehicleParams } from '../physics/tuning';
import { estimateStats, type CarStats } from '../physics/stats';
import { PRESETS, loadGarage, sanitizeGarage, saveGarage, type GarageState } from './state';
import type { Control } from './schema';
import type { PanelRow } from '../xr/panel';
import { TABS } from './schema';

type Listener = (s: GarageState) => void;

/** Estado da garagem + persistência + notificação. A interface (DOM ou VR) só chama `set`/`preset`. */
export class Garage {
  state: GarageState = loadGarage();
  private readonly listeners = new Set<Listener>();
  open = false;
  private readonly openListeners = new Set<(open: boolean) => void>();

  /** Abre/fecha a garagem (PC ou VR); quem exibe a interface escuta `onOpenChange`. */
  setOpen(v: boolean): void {
    if (this.open === v) return;
    this.open = v;
    for (const l of this.openListeners) l(v);
  }

  onOpenChange(fn: (open: boolean) => void): () => void {
    this.openListeners.add(fn);
    return () => this.openListeners.delete(fn);
  }
  /** Aba ativa (índice em TABS), compartilhada entre as interfaces. */
  tab = 0;

  onChange(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Aplica uma alteração, normaliza, salva e avisa. */
  mutate(fn: (s: GarageState) => void): void {
    fn(this.state);
    this.state = sanitizeGarage(JSON.parse(JSON.stringify(this.state)));
    saveGarage(this.state);
    for (const l of this.listeners) l(this.state);
  }

  setControl(c: Control, value: number | string): void {
    this.mutate((s) => {
      if (c.kind === 'slider') c.set(s, Number(value));
      else c.set(s, String(value));
    });
  }

  applyPreset(id: string): void {
    const p = PRESETS.find((q) => q.id === id);
    if (!p) return;
    this.state = p.make();
    this.mutate(() => {});
  }

  stats(): CarStats {
    return estimateStats(resolveVehicleParams(HANABI_200S, clampTuning(this.state.tuning)));
  }

  /** Painel de VR da aba atual: abas, controles, predefinições e estatísticas. */
  vrRows(onClose: () => void): PanelRow[] {
    const rows: PanelRow[] = [{ type: 'title', text: 'GARAGEM' }];
    const half = Math.ceil(TABS.length / 2);
    for (const slice of [TABS.slice(0, half), TABS.slice(half)]) {
      rows.push({
        type: 'segments',
        items: slice.map((tb) => ({
          text: tb.label,
          active: () => TABS[this.tab]!.id === tb.id,
          onClick: () => { this.tab = TABS.indexOf(tb); this.rebuildVr?.(); },
        })),
      });
    }
    rows.push({ type: 'spacer', h: 6 });
    for (const c of TABS[this.tab]!.controls) rows.push(...this.controlRows(c));
    rows.push({ type: 'spacer', h: 6 });
    rows.push({
      type: 'segments',
      items: PRESETS.map((p) => ({ text: p.label, active: () => false, onClick: () => this.applyPreset(p.id) })),
    });
    rows.push({ type: 'label', text: () => this.statsLine1(), color: '#27e8ff' });
    rows.push({ type: 'label', text: () => this.statsLine2(), color: '#aeb0d8' });
    rows.push({ type: 'button', text: 'Fechar', accent: '#ff2fb3', onClick: onClose });
    return rows;
  }

  /** O painel de VR registra aqui como reconstruir as linhas quando a aba muda. */
  rebuildVr: (() => void) | null = null;

  private controlRows(c: Control): PanelRow[] {
    if (c.kind === 'slider') {
      return [{
        type: 'slider', text: c.label, min: c.min, max: c.max, step: c.step,
        get: () => c.get(this.state), set: (v) => this.setControl(c, v), format: c.fmt,
      }];
    }
    if (c.kind === 'color') {
      return [
        { type: 'label', text: c.label },
        { type: 'swatches', colors: c.colors.map((x) => (x === 'off' ? '#2a2a33' : x)), get: () => { const v = c.get(this.state); return v === 'off' ? '#2a2a33' : v; }, set: (col) => this.setControl(c, col === '#2a2a33' ? 'off' : col) },
      ];
    }
    // choice: até 4 por linha
    const out: PanelRow[] = [{ type: 'label', text: c.label }];
    for (let i = 0; i < c.options.length; i += 4) {
      out.push({
        type: 'segments',
        items: c.options.slice(i, i + 4).map((o) => ({ text: o.label, active: () => c.get(this.state) === o.id, onClick: () => this.setControl(c, o.id) })),
      });
    }
    return out;
  }

  private statsLine1(): string {
    const s = this.stats();
    return `${s.peakPowerHp.toFixed(0)} cv · ${s.peakTorque.toFixed(0)} N·m · ${s.mass.toFixed(0)} kg`;
  }

  private statsLine2(): string {
    const s = this.stats();
    return `máx ~${s.topSpeedKmh.toFixed(0)} km/h · vão ${s.groundClearanceCm.toFixed(0)} cm · ${s.powerToWeight.toFixed(0)} cv/t`;
  }
}

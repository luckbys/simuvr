import type { Game } from '../game';
import { PRESETS } from '../garage/state';
import { TABS, type Control } from '../garage/schema';

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

/** Garagem de tuning para PC: abas, controles e estatísticas ao vivo; arrastar gira o carro. */
export class GarageUi {
  private readonly root = document.getElementById('garage') as HTMLElement;
  private readonly tabsEl = this.root.querySelector('.tabs') as HTMLElement;
  private readonly controlsEl = this.root.querySelector('.controls') as HTMLElement;
  private readonly statsEl = this.root.querySelector('.stats') as HTMLElement;
  private readonly presetsEl = this.root.querySelector('.presets') as HTMLElement;
  private updaters: Array<() => void> = [];
  private drag: { x: number; y: number } | null = null;

  constructor(private readonly game: Game) {
    const g = game.garage;
    this.root.querySelector('#g-close')!.addEventListener('click', () => g.setOpen(false));

    for (const p of PRESETS) {
      const b = el('button', 'chip', p.label);
      b.addEventListener('click', () => g.applyPreset(p.id));
      this.presetsEl.appendChild(b);
    }

    TABS.forEach((t, i) => {
      const b = el('button', 'tab', t.label);
      b.dataset.tab = String(i);
      b.addEventListener('click', () => this.showTab(i));
      this.tabsEl.appendChild(b);
    });

    g.onOpenChange((open) => this.setOpen(open));
    g.onChange(() => this.refresh());
    this.showTab(g.tab);

    // Órbita com o mouse enquanto a garagem está aberta.
    const canvas = game.ctx.renderer.domElement;
    canvas.addEventListener('pointerdown', (e) => {
      if (!g.open) return;
      this.drag = { x: e.clientX, y: e.clientY };
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!g.open || !this.drag) return;
      const o = game.cameras.orbit;
      o.azimuth -= (e.clientX - this.drag.x) * 0.008;
      o.elevation = Math.max(-0.05, Math.min(1.15, o.elevation + (e.clientY - this.drag.y) * 0.006));
      this.drag = { x: e.clientX, y: e.clientY };
    });
    const end = () => { this.drag = null; };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    canvas.addEventListener('wheel', (e) => {
      if (!g.open) return;
      e.preventDefault();
      const o = game.cameras.orbit;
      o.distance = Math.max(3.4, Math.min(12, o.distance * (1 + Math.sign(e.deltaY) * 0.08)));
    }, { passive: false });
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Escape' && g.open) g.setOpen(false);
    });
  }

  private setOpen(open: boolean): void {
    this.root.classList.toggle('open', open);
    document.body.classList.toggle('garage-open', open);
    this.game.input.setEnabled(!open);
    // O teclado volta a valer ao fechar; a tecla G continua alternando (tratada fora, no jogo).
    if (open) this.refresh();
  }

  private showTab(i: number): void {
    const g = this.game.garage;
    g.tab = i;
    this.tabsEl.querySelectorAll('.tab').forEach((b, k) => b.classList.toggle('on', k === i));
    this.controlsEl.replaceChildren();
    this.updaters = [];
    for (const c of TABS[i]!.controls) this.controlsEl.appendChild(this.build(c));
    this.refresh();
  }

  private build(c: Control): HTMLElement {
    const g = this.game.garage;
    const box = el('div', 'ctl');
    if (c.kind === 'slider') {
      const row = el('div', 'row');
      row.append(el('span', undefined, c.label));
      const val = el('b');
      row.append(val);
      const input = el('input');
      input.type = 'range';
      input.min = String(c.min);
      input.max = String(c.max);
      input.step = String(c.step);
      input.addEventListener('input', () => g.setControl(c, Number(input.value)));
      box.append(row, input);
      this.updaters.push(() => {
        const v = c.get(g.state);
        if (document.activeElement !== input || input.value !== String(v)) input.value = String(v);
        val.textContent = c.fmt(v);
      });
    } else if (c.kind === 'choice') {
      box.append(el('div', 'row', c.label));
      const seg = el('div', 'seg');
      const btns = c.options.map((o) => {
        const b = el('button', undefined, o.label);
        if (o.hint) b.title = o.hint;
        b.addEventListener('click', () => g.setControl(c, o.id));
        seg.appendChild(b);
        return { o, b };
      });
      box.append(seg);
      this.updaters.push(() => {
        const cur = c.get(g.state);
        for (const { o, b } of btns) b.classList.toggle('on', o.id === cur);
      });
    } else {
      box.append(el('div', 'row', c.label));
      const sw = el('div', 'swatches');
      const btns = c.colors.map((col) => {
        const b = el('button', 'sw');
        if (col === 'off') { b.textContent = '✕'; b.classList.add('off'); b.title = 'Desligado'; }
        else b.style.background = col;
        b.addEventListener('click', () => g.setControl(c, col));
        sw.appendChild(b);
        return { col, b };
      });
      box.append(sw);
      this.updaters.push(() => {
        const cur = c.get(g.state).toLowerCase();
        for (const { col, b } of btns) b.classList.toggle('on', col.toLowerCase() === cur);
      });
    }
    return box;
  }

  private refresh(): void {
    for (const u of this.updaters) u();
    const s = this.game.garage.stats();
    const cell = (label: string, value: string) => `<div><span>${label}</span><b>${value}</b></div>`;
    this.statsEl.innerHTML =
      cell('Potência', `${s.peakPowerHp.toFixed(0)} cv`) +
      cell('Torque', `${s.peakTorque.toFixed(0)} N·m`) +
      cell('Peso', `${s.mass.toFixed(0)} kg`) +
      cell('Vel. máx.', `~${s.topSpeedKmh.toFixed(0)} km/h`) +
      cell('Vão livre', `${s.groundClearanceCm.toFixed(0)} cm`) +
      cell('Aderência', `${s.gripFront.toFixed(2)} / ${s.gripRear.toFixed(2)}`);
  }
}

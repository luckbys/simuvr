import * as THREE from 'three';

export type Text = string | (() => string);

export type PanelRow =
  | { type: 'title'; text: Text }
  | { type: 'label'; text: Text; color?: string }
  | { type: 'button'; text: Text; onClick: () => void; accent?: string }
  | { type: 'segments'; items: Array<{ text: Text; onClick: () => void; active: () => boolean }> }
  | { type: 'slider'; text: Text; min: number; max: number; step?: number; get: () => number; set: (v: number) => void; format?: (v: number) => string }
  | { type: 'swatches'; colors: string[]; get: () => string; set: (c: string) => void }
  | { type: 'spacer'; h: number };

interface Region {
  x: number;
  y: number;
  w: number;
  h: number;
  row: number;
  item: number;
}

const ROW_H = 64;
const TITLE_H = 92;
const GAP = 10;
const PAD = 28;
const resolve = (t: Text): string => (typeof t === 'function' ? t() : t);

/**
 * Painel de interface desenhado em canvas (sem dependências), com botões, segmentos, sliders e
 * amostras de cor. O raio do controle é testado contra o plano do painel e convertido em pixels.
 */
export class VrPanel {
  readonly mesh: THREE.Mesh;
  readonly widthM: number;
  heightM = 0.3;

  private readonly canvas = document.createElement('canvas');
  private readonly ctx = this.canvas.getContext('2d')!;
  private readonly tex: THREE.CanvasTexture;
  /** Linhas atuais (somente leitura; exposto para testes). */
  rows: PanelRow[] = [];
  private regions: Region[] = [];
  private hover: Region | null = null;
  private pressed: Region | null = null;
  private dirty = true;
  private pxH = 256;
  private readonly pxW = 1024;
  private readonly invPlane = new THREE.Matrix4();
  private readonly tmpO = new THREE.Vector3();
  private readonly tmpD = new THREE.Vector3();
  private lastText = '';

  constructor(widthM = 0.9) {
    this.widthM = widthM;
    this.canvas.width = this.pxW;
    this.canvas.height = this.pxH;
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.anisotropy = 4;
    // Sem teste de profundidade: o painel é interface e deve ficar sempre por cima (painel do carro, capô).
    const mat = new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, toneMapped: false, side: THREE.DoubleSide, depthTest: false, depthWrite: false });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
    this.mesh.renderOrder = 1000;
  }

  setRows(rows: PanelRow[]): void {
    this.rows = rows;
    this.layout();
    this.dirty = true;
  }

  private rowHeight(r: PanelRow): number {
    switch (r.type) {
      case 'title': return TITLE_H;
      case 'spacer': return r.h;
      case 'label': return 44;
      case 'slider': return ROW_H + 18;
      default: return ROW_H;
    }
  }

  private layout(): void {
    let h = PAD * 2;
    for (const r of this.rows) h += this.rowHeight(r) + GAP;
    this.pxH = Math.max(128, Math.ceil(h));
    this.canvas.height = this.pxH;
    this.tex.dispose();
    this.tex.needsUpdate = true;
    this.heightM = (this.pxH / this.pxW) * this.widthM;
    this.mesh.scale.set(this.widthM, this.heightM, 1);
    this.regions = [];
    let y = PAD;
    this.rows.forEach((r, ri) => {
      const rh = this.rowHeight(r);
      const x0 = PAD, w = this.pxW - PAD * 2;
      if (r.type === 'button') this.regions.push({ x: x0, y, w, h: rh, row: ri, item: 0 });
      else if (r.type === 'segments') {
        const n = r.items.length;
        const iw = (w - GAP * (n - 1)) / n;
        r.items.forEach((_, i) => this.regions.push({ x: x0 + i * (iw + GAP), y, w: iw, h: rh, row: ri, item: i }));
      } else if (r.type === 'slider') this.regions.push({ x: x0, y: y + 30, w, h: rh - 30, row: ri, item: 0 });
      else if (r.type === 'swatches') {
        const n = r.colors.length;
        const iw = Math.min(70, (w - GAP * (n - 1)) / n);
        r.colors.forEach((_, i) => this.regions.push({ x: x0 + i * (iw + GAP), y, w: iw, h: rh, row: ri, item: i }));
      }
      y += rh + GAP;
    });
  }

  /** Ponto no mundo do centro de um item (linha, índice): útil para apontar o raio e para testes. */
  worldPointOfItem(row: number, item: number, out: THREE.Vector3): boolean {
    const r = this.regions.find((q) => q.row === row && q.item === item);
    if (!r) return false;
    this.mesh.updateWorldMatrix(true, false);
    out.set((r.x + r.w / 2) / this.pxW - 0.5, 0.5 - (r.y + r.h / 2) / this.pxH, 0).applyMatrix4(this.mesh.matrixWorld);
    return true;
  }

  /** Índice da primeira linha de um tipo (e, opcionalmente, com certo rótulo em um item). */
  findRow(type: PanelRow['type'], itemText?: string): number {
    return this.rows.findIndex((r) => {
      if (r.type !== type) return false;
      if (itemText === undefined) return true;
      if (r.type === 'segments') return r.items.some((i) => resolve(i.text) === itemText);
      if (r.type === 'button') return resolve(r.text) === itemText;
      return false;
    });
  }

  /** Interseção do raio (mundo) com o painel: devolve pixel e distância, ou null. */
  hit(origin: THREE.Vector3, dir: THREE.Vector3): { px: number; py: number; dist: number } | null {
    this.mesh.updateWorldMatrix(true, false);
    this.invPlane.copy(this.mesh.matrixWorld).invert();
    const o = this.tmpO.copy(origin).applyMatrix4(this.invPlane);
    const d = this.tmpD.copy(dir).transformDirection(this.invPlane);
    if (Math.abs(d.z) < 1e-5) return null;
    const t = -o.z / d.z;
    if (t < 0) return null;
    const x = o.x + d.x * t;
    const y = o.y + d.y * t;
    if (x < -0.5 || x > 0.5 || y < -0.5 || y > 0.5) return null;
    // Plano unitário escalado: o espaço local já é normalizado (-0.5..0.5).
    return { px: (x + 0.5) * this.pxW, py: (0.5 - y) * this.pxH, dist: t * this.tmpD.copy(dir).length() };
  }

  private regionAt(px: number, py: number): Region | null {
    for (const r of this.regions) if (px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h) return r;
    return null;
  }

  setHover(px: number | null, py = 0): void {
    const r = px === null ? null : this.regionAt(px, py);
    if (r !== this.hover) {
      this.hover = r;
      this.dirty = true;
    }
  }

  /** Trigger apertado sobre o painel. Devolve true se algo foi acionado. */
  press(px: number, py: number): boolean {
    const r = this.regionAt(px, py);
    if (!r) return false;
    this.pressed = r;
    const row = this.rows[r.row]!;
    if (row.type === 'button') row.onClick();
    else if (row.type === 'segments') row.items[r.item]!.onClick();
    else if (row.type === 'swatches') row.set(row.colors[r.item]!);
    else if (row.type === 'slider') this.dragSlider(row, r, px);
    this.dirty = true;
    return true;
  }

  drag(px: number): void {
    const r = this.pressed;
    if (!r) return;
    const row = this.rows[r.row]!;
    if (row.type === 'slider') {
      this.dragSlider(row, r, px);
      this.dirty = true;
    }
  }

  release(): void {
    if (this.pressed) this.dirty = true;
    this.pressed = null;
  }

  private dragSlider(row: Extract<PanelRow, { type: 'slider' }>, r: Region, px: number): void {
    const t = Math.max(0, Math.min(1, (px - r.x) / r.w));
    let v = row.min + t * (row.max - row.min);
    if (row.step) v = Math.round(v / row.step) * row.step;
    row.set(Math.max(row.min, Math.min(row.max, v)));
  }

  /** Redesenha se algo mudou (conteúdo dinâmico ou interação). */
  update(): void {
    // Rótulos dinâmicos: só redesenha se o texto resultante mudou.
    const sig = this.rows.map((r) => this.signature(r)).join('|');
    if (sig !== this.lastText) {
      this.lastText = sig;
      this.dirty = true;
    }
    if (!this.dirty) return;
    this.dirty = false;
    this.draw();
    this.tex.needsUpdate = true;
  }

  private signature(r: PanelRow): string {
    switch (r.type) {
      case 'title': case 'label': return resolve(r.text);
      case 'button': return resolve(r.text);
      case 'segments': return r.items.map((i) => resolve(i.text) + i.active()).join(',');
      case 'slider': return resolve(r.text) + r.get();
      case 'swatches': return r.get();
      default: return '';
    }
  }

  private rr(x: number, y: number, w: number, h: number, r: number): void {
    const g = this.ctx;
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  }

  private draw(): void {
    const g = this.ctx;
    const W = this.pxW, H = this.pxH;
    g.clearRect(0, 0, W, H);
    // fundo vidro escuro com borda neon
    this.rr(6, 6, W - 12, H - 12, 34);
    g.fillStyle = 'rgba(10,8,24,0.9)';
    g.fill();
    g.lineWidth = 4;
    const bg = g.createLinearGradient(0, 0, W, H);
    bg.addColorStop(0, '#ff2fb3');
    bg.addColorStop(1, '#27e8ff');
    g.strokeStyle = bg;
    g.stroke();

    g.textBaseline = 'middle';
    let y = PAD;
    this.rows.forEach((r, ri) => {
      const rh = this.rowHeight(r);
      const x0 = PAD, w = W - PAD * 2;
      const isHover = (reg: Region | null) => reg !== null && this.hover === reg;
      const regs = this.regions.filter((q) => q.row === ri);
      switch (r.type) {
        case 'title':
          g.font = '800 54px ui-sans-serif, "Segoe UI", Arial, sans-serif';
          g.textAlign = 'center';
          g.fillStyle = '#ffffff';
          g.shadowColor = '#ff2fb3';
          g.shadowBlur = 18;
          g.fillText(resolve(r.text), W / 2, y + rh / 2);
          g.shadowBlur = 0;
          break;
        case 'label':
          g.font = '500 32px ui-sans-serif, "Segoe UI", Arial, sans-serif';
          g.textAlign = 'center';
          g.fillStyle = r.color ?? '#aeb0d8';
          g.fillText(resolve(r.text), W / 2, y + rh / 2);
          break;
        case 'button': {
          const reg = regs[0]!;
          const hov = isHover(reg);
          const accent = r.accent ?? '#27e8ff';
          this.rr(reg.x, reg.y, reg.w, reg.h, 18);
          g.fillStyle = hov ? accent : 'rgba(255,255,255,0.07)';
          g.globalAlpha = hov ? 0.35 : 1;
          g.fill();
          g.globalAlpha = 1;
          g.lineWidth = 3;
          g.strokeStyle = accent;
          g.stroke();
          g.font = '700 34px ui-sans-serif, "Segoe UI", Arial, sans-serif';
          g.textAlign = 'center';
          g.fillStyle = '#ffffff';
          g.fillText(resolve(r.text), W / 2, y + rh / 2 + 1);
          break;
        }
        case 'segments':
          r.items.forEach((it, i) => {
            const reg = regs[i]!;
            const on = it.active();
            const hov = isHover(reg);
            this.rr(reg.x, reg.y, reg.w, reg.h, 16);
            g.fillStyle = on ? 'rgba(39,232,255,0.38)' : hov ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.06)';
            g.fill();
            g.lineWidth = on ? 4 : 2;
            g.strokeStyle = on ? '#27e8ff' : 'rgba(255,255,255,0.3)';
            g.stroke();
            g.font = '700 28px ui-sans-serif, "Segoe UI", Arial, sans-serif';
            g.textAlign = 'center';
            g.fillStyle = '#ffffff';
            g.fillText(resolve(it.text), reg.x + reg.w / 2, reg.y + reg.h / 2 + 1);
          });
          break;
        case 'slider': {
          const reg = regs[0]!;
          const v = r.get();
          const t = (v - r.min) / (r.max - r.min || 1);
          g.font = '600 28px ui-sans-serif, "Segoe UI", Arial, sans-serif';
          g.textAlign = 'left';
          g.fillStyle = '#d9dcff';
          g.fillText(resolve(r.text), x0, y + 14);
          g.textAlign = 'right';
          g.fillStyle = '#27e8ff';
          g.fillText(r.format ? r.format(v) : v.toFixed(2), x0 + w, y + 14);
          const cy = reg.y + reg.h / 2 + 6;
          this.rr(x0, cy - 7, w, 14, 7);
          g.fillStyle = 'rgba(255,255,255,0.14)';
          g.fill();
          this.rr(x0, cy - 7, Math.max(14, w * t), 14, 7);
          g.fillStyle = bg;
          g.fill();
          g.beginPath();
          g.arc(x0 + w * t, cy, isHover(reg) || this.pressed === reg ? 17 : 13, 0, Math.PI * 2);
          g.fillStyle = '#ffffff';
          g.fill();
          break;
        }
        case 'swatches': {
          const cur = r.get().toLowerCase();
          r.colors.forEach((c, i) => {
            const reg = regs[i]!;
            this.rr(reg.x, reg.y + 4, reg.w, reg.h - 8, 14);
            g.fillStyle = c;
            g.fill();
            const on = c.toLowerCase() === cur;
            g.lineWidth = on ? 6 : isHover(reg) ? 4 : 2;
            g.strokeStyle = on ? '#ffffff' : 'rgba(255,255,255,0.35)';
            g.stroke();
          });
          break;
        }
        default:
          break;
      }
      y += rh + GAP;
    });
  }

  dispose(): void {
    this.tex.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.mesh.geometry.dispose();
  }
}

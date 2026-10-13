/** Entrada do carro, já normalizada, vinda de teclado, gamepad ou VR. */
export interface DriveInput {
  /** 0..1 */
  throttle: number;
  /** 0..1 */
  brake: number;
  /** -1 (esquerda) .. 1 (direita) */
  steer: number;
  /** 0..1 */
  handbrake: number;
  /** 0..1 (0 = embreagem solta). Só usada no modo manual. */
  clutch: number;
  /** Pulsos de um frame, consumidos pelo carro. */
  shiftUp: boolean;
  shiftDown: boolean;
  /** Fonte do esterçamento: o volante VR já entrega o ângulo normalizado. */
  steerIsAbsolute: boolean;
}

export function emptyInput(): DriveInput {
  return {
    throttle: 0,
    brake: 0,
    steer: 0,
    handbrake: 0,
    clutch: 0,
    shiftUp: false,
    shiftDown: false,
    steerIsAbsolute: false,
  };
}

export interface UiActions {
  toggleCamera: boolean;
  toggleGarage: boolean;
  reset: boolean;
  toggleDebug: boolean;
}

/** Teclado + gamepad do navegador (modo desktop). */
export class DesktopInput {
  readonly drive: DriveInput = emptyInput();
  readonly actions: UiActions = { toggleCamera: false, toggleGarage: false, reset: false, toggleDebug: false };

  private keys = new Set<string>();
  private steerSmooth = 0;
  private shiftUpQueued = false;
  private shiftDownQueued = false;
  private enabled = true;

  constructor() {
    window.addEventListener('keydown', (e) => this.onKey(e, true));
    window.addEventListener('keyup', (e) => this.onKey(e, false));
    window.addEventListener('blur', () => this.keys.clear());
  }

  setEnabled(v: boolean): void {
    this.enabled = v;
    if (!v) this.keys.clear();
  }

  private onKey(e: KeyboardEvent, down: boolean): void {
    if (!this.enabled) return;
    if ((e.target as HTMLElement | null)?.tagName === 'INPUT') return;
    const c = e.code;
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(c)) e.preventDefault();
    if (down) {
      if (e.repeat) return;
      if (c === 'ShiftLeft' || c === 'ShiftRight' || c === 'KeyE') this.shiftUpQueued = true;
      if (c === 'ControlLeft' || c === 'ControlRight' || c === 'KeyQ') this.shiftDownQueued = true;
      if (c === 'KeyC') this.actions.toggleCamera = true;
      if (c === 'KeyG') this.actions.toggleGarage = true;
      if (c === 'KeyR') this.actions.reset = true;
      if (c === 'F3') {
        e.preventDefault();
        this.actions.toggleDebug = true;
      }
      this.keys.add(c);
    } else {
      this.keys.delete(c);
    }
  }

  /** Atualiza `drive` para este frame. `dt` em segundos. */
  poll(dt: number): DriveInput {
    const d = this.drive;
    const k = this.keys;
    const up = k.has('KeyW') || k.has('ArrowUp');
    const down = k.has('KeyS') || k.has('ArrowDown');
    const left = k.has('KeyA') || k.has('ArrowLeft');
    const right = k.has('KeyD') || k.has('ArrowRight');

    let throttle = up ? 1 : 0;
    let brake = down ? 1 : 0;
    let steerTarget = (right ? 1 : 0) - (left ? 1 : 0);
    let handbrake = k.has('Space') ? 1 : 0;

    const pad = this.enabled ? firstGamepad() : null;
    if (pad) {
      const dz = (v: number) => (Math.abs(v) < 0.08 ? 0 : v);
      const rt = pad.buttons[7]?.value ?? 0;
      const lt = pad.buttons[6]?.value ?? 0;
      throttle = Math.max(throttle, rt);
      brake = Math.max(brake, lt);
      const sx = dz(pad.axes[0] ?? 0);
      if (sx !== 0) {
        // analógico entrega valor direto, sem suavização por tempo
        this.steerSmooth = sx;
        steerTarget = sx;
      }
      if (pad.buttons[0]?.pressed || pad.buttons[2]?.pressed) handbrake = 1;
      if (pad.buttons[5]?.pressed && !this.padShiftHeld) {
        this.shiftUpQueued = true;
        this.padShiftHeld = true;
      } else if (pad.buttons[4]?.pressed && !this.padShiftHeld) {
        this.shiftDownQueued = true;
        this.padShiftHeld = true;
      } else if (!pad.buttons[5]?.pressed && !pad.buttons[4]?.pressed) {
        this.padShiftHeld = false;
      }
    }

    // Suavização do teclado: sobe rápido, volta ao centro mais rápido ainda.
    if (!pad || Math.abs(pad.axes[0] ?? 0) < 0.08) {
      const rate = steerTarget === 0 ? 6 : steerTarget * this.steerSmooth < 0 ? 9 : 3.2;
      const diff = steerTarget - this.steerSmooth;
      const stepMax = rate * dt;
      this.steerSmooth += Math.max(-stepMax, Math.min(stepMax, diff));
    }

    d.throttle = throttle;
    d.brake = brake;
    d.steer = this.steerSmooth;
    d.handbrake = handbrake;
    d.clutch = k.has('KeyX') ? 1 : 0;
    d.shiftUp = this.shiftUpQueued;
    d.shiftDown = this.shiftDownQueued;
    d.steerIsAbsolute = false;
    this.shiftUpQueued = false;
    this.shiftDownQueued = false;
    return d;
  }

  private padShiftHeld = false;

  /** Lê e zera as ações de interface (câmera, garagem, reset, debug). */
  consumeActions(): UiActions {
    const a = this.actions;
    const out = { ...a };
    a.toggleCamera = a.toggleGarage = a.reset = a.toggleDebug = false;
    return out;
  }
}

function firstGamepad(): Gamepad | null {
  const pads = navigator.getGamepads?.();
  if (!pads) return null;
  for (const p of pads) if (p && p.connected && p.mapping === 'standard') return p;
  return null;
}

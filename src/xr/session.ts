import type * as THREE from 'three';
import type { QualitySettings } from '../core/quality';

export type XrState = 'unsupported' | 'available' | 'presenting';

/**
 * Gerencia a sessão `immersive-vr`. Não depende do VRButton do three para que o
 * texto fique em PT-BR e para podermos aplicar taxa de quadros e escala do Quest.
 */
export class XrSessionManager {
  state: XrState = 'unsupported';
  session: XRSession | null = null;
  onStart: (s: XRSession) => void = () => {};
  onEnd: () => void = () => {};
  onState: (s: XrState) => void = () => {};

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    private readonly quality: QualitySettings,
  ) {}

  async detect(): Promise<XrState> {
    const xr = navigator.xr;
    let ok = false;
    if (xr) {
      try {
        ok = await xr.isSessionSupported('immersive-vr');
      } catch {
        ok = false;
      }
    }
    this.setState(ok ? 'available' : 'unsupported');
    return this.state;
  }

  async enter(): Promise<void> {
    if (this.state !== 'available' || !navigator.xr) return;
    const session = await navigator.xr.requestSession('immersive-vr', {
      requiredFeatures: ['local-floor'],
      optionalFeatures: ['bounded-floor', 'hand-tracking', 'layers'],
    });
    session.addEventListener('end', () => {
      this.session = null;
      this.setState('available');
      this.onEnd();
    });
    await this.renderer.xr.setSession(session);
    this.session = session;
    this.setState('presenting');
    this.applyFrameRate(session);
    this.onStart(session);
  }

  exit(): void {
    this.session?.end().catch(() => {});
  }

  private applyFrameRate(session: XRSession): void {
    const rates = session.supportedFrameRates;
    if (!rates || !session.updateTargetFrameRate) return;
    const want = this.quality.xrFrameRate;
    const list = Array.from(rates);
    const pick = list.includes(want) ? want : list.sort((a, b) => Math.abs(a - want) - Math.abs(b - want))[0];
    if (pick) session.updateTargetFrameRate(pick).catch(() => {});
  }

  private setState(s: XrState): void {
    this.state = s;
    this.onState(s);
  }
}

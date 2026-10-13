import * as THREE from 'three';
import { createRenderer, type RenderContext } from './core/renderer';
import { QUALITY, loadQuality, type QualitySettings } from './core/quality';
import { FixedStepper } from './core/loop';
import { DesktopInput } from './core/input';
import { DebugHud } from './core/debugHud';
import { XrSessionManager } from './xr/session';

export class Game {
  readonly quality: QualitySettings;
  readonly ctx: RenderContext;
  readonly input = new DesktopInput();
  readonly debug: DebugHud;
  readonly xr: XrSessionManager;
  readonly stepper: FixedStepper;

  private last = performance.now();
  private running = false;
  private time = 0;

  constructor(host: HTMLElement) {
    this.quality = QUALITY[loadQuality()];
    this.ctx = createRenderer(host, this.quality);
    this.debug = new DebugHud(this.ctx.renderer);
    this.xr = new XrSessionManager(this.ctx.renderer, this.quality);
    this.stepper = new FixedStepper(this.quality.physicsHz, (dt) => this.fixedUpdate(dt));
    this.buildTestScene();
  }

  /** Cena provisória do marco 1: chão, névoa e alguns marcos coloridos. */
  private buildTestScene(): void {
    const { scene } = this.ctx;
    scene.background = new THREE.Color(0x07060f);
    scene.fog = new THREE.FogExp2(0x120a26, 0.012);

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(400, 400),
      new THREE.MeshStandardMaterial({ color: 0x15131f, roughness: 0.35, metalness: 0.2 }),
    );
    ground.rotation.x = -Math.PI / 2;
    scene.add(ground);
    scene.add(new THREE.GridHelper(400, 80, 0xff2fb3, 0x27e8ff));

    scene.add(new THREE.HemisphereLight(0x6a5cff, 0x120a26, 0.9));
    const moon = new THREE.DirectionalLight(0x9fb4ff, 0.6);
    moon.position.set(-30, 60, 20);
    scene.add(moon);

    const colors = [0xff2fb3, 0x27e8ff, 0xffb02f, 0x7a5cff];
    for (let i = 0; i < 8; i++) {
      const m = new THREE.Mesh(
        new THREE.BoxGeometry(1, 3 + (i % 3), 1),
        new THREE.MeshBasicMaterial({ color: colors[i % colors.length] }),
      );
      const a = (i / 8) * Math.PI * 2;
      m.position.set(Math.cos(a) * 14, 1.5, Math.sin(a) * 14);
      scene.add(m);
    }
    this.ctx.camera.position.set(0, 1.6, 6);
  }

  private fixedUpdate(_dt: number): void {
    // física do veículo entra no marco 3
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    this.ctx.renderer.setAnimationLoop((now) => this.frame(now));
  }

  private frame(now: number): void {
    const dt = Math.min((now - this.last) / 1000, 0.1);
    this.last = now;
    this.time += dt;

    const a = this.input.consumeActions();
    if (a.toggleDebug) this.debug.toggle();
    this.input.poll(dt);

    const alpha = this.stepper.advance(dt);
    void alpha;

    this.ctx.renderer.render(this.ctx.scene, this.ctx.camera);
    this.debug.tick(dt);
  }
}

import * as THREE from 'three';
import { createRenderer, type RenderContext } from './core/renderer';
import { QUALITY, loadQuality, type QualitySettings } from './core/quality';
import { FixedStepper } from './core/loop';
import { DesktopInput, emptyInput, type DriveInput } from './core/input';
import { DebugHud } from './core/debugHud';
import { CameraRig } from './core/cameras';
import { XrSessionManager } from './xr/session';
import { PhysicsWorld } from './physics/world';
import { Vehicle } from './physics/vehicle/vehicle';
import { HANABI_200S } from './physics/carSpec';
import { defaultTuning, resolveVehicleParams, type TuningState } from './physics/tuning';
import { CarView, defaultLook } from './car/carView';
import { makeNightEnvironment } from './city/envMap';
import { buildTestArena } from './city/testArena';
import { buildCity, type City } from './city/city';
import { Hud } from './ui/hud';

export class Game {
  readonly quality: QualitySettings;
  readonly ctx: RenderContext;
  readonly input = new DesktopInput();
  readonly debug: DebugHud;
  readonly xr: XrSessionManager;
  readonly stepper: FixedStepper;
  readonly physics: PhysicsWorld;
  readonly vehicle: Vehicle;
  readonly carView: CarView;
  /** Mundo atual: a cidade (padrão) ou a arena de teste (?arena=1). */
  readonly world: { group: THREE.Group; sync(): void; spawn: { x: number; z: number; yaw: number } };
  readonly city: City | null;
  readonly cameras: CameraRig;
  readonly hud = new Hud();

  tuning: TuningState = defaultTuning();

  private env: THREE.Texture | null = null;
  private last = performance.now();
  private running = false;
  private readonly drive: DriveInput = emptyInput();
  private shiftUpPending = false;
  private shiftDownPending = false;
  private readonly carPos = new THREE.Vector3();
  private readonly carQuat = new THREE.Quaternion();

  private constructor(host: HTMLElement, physics: PhysicsWorld) {
    this.physics = physics;
    this.quality = QUALITY[loadQuality()];
    this.ctx = createRenderer(host, this.quality);
    this.debug = new DebugHud(this.ctx.renderer);
    this.xr = new XrSessionManager(this.ctx.renderer, this.quality);
    this.stepper = new FixedStepper(this.quality.physicsHz, (dt) => this.fixedUpdate(dt));
    this.cameras = new CameraRig(this.ctx.camera);

    const { scene } = this.ctx;
    scene.background = new THREE.Color(0x07060f);
    scene.fog = new THREE.FogExp2(0x120a26, 0.006);
    const env = makeNightEnvironment(this.ctx.renderer, this.quality.envMapSize);
    this.env = env;
    scene.environment = env;
    scene.environmentIntensity = 0.55;

    scene.add(new THREE.HemisphereLight(0x6a5cff, 0x120a26, 0.7));
    const moon = new THREE.DirectionalLight(0x9fb4ff, 0.45);
    moon.position.set(-30, 60, 20);
    scene.add(moon);

    const useArena = new URLSearchParams(location.search).get('arena') === '1';
    if (useArena) {
      const arena = buildTestArena(physics, env);
      this.world = arena;
      this.city = null;
      scene.add(arena.group);
    } else {
      const city = buildCity(physics, this.quality, env);
      this.city = city;
      this.world = city;
      scene.add(city.group);
      scene.add(city.sky);
      scene.fog = new THREE.FogExp2(0x1a0d30, 0.0042);
      // Reflexos reais: captura a cidade uma vez e usa como ambiente de tudo.
      const real = city.captureEnvironment(this.ctx.renderer, scene, this.quality.envMapSize);
      scene.environment = real;
      scene.environmentIntensity = 0.7;
      env.dispose();
      this.env = real;
      scene.traverse((o) => {
        const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
        if (m && 'envMap' in m && m.envMap) m.envMap = real;
      });
    }

    const params = resolveVehicleParams(HANABI_200S, this.tuning);
    this.vehicle = new Vehicle(physics, params, this.world.spawn, { abs: true, steerAssist: 0.45, autoGear: true });
    this.carView = new CarView(HANABI_200S, defaultLook());
    this.carView.setEnvironment(this.env);
    scene.add(this.carView.root);
    this.addHeadlights();
  }

  static async create(host: HTMLElement): Promise<Game> {
    const physics = await PhysicsWorld.create();
    return new Game(host, physics);
  }

  /** Aplica um tuning novo: recalcula a física e o visual associado. */
  applyTuning(t: TuningState): void {
    this.tuning = t;
    this.vehicle.setParams(resolveVehicleParams(HANABI_200S, t));
    this.carView.setLook({ spoiler: t.spoiler });
  }

  resetCar(): void {
    const s = this.world.spawn;
    this.vehicle.reset(s.x, s.z, s.yaw);
    this.cameras.snap();
  }

  /** Faróis: dois SpotLights presos ao carro (sem sombra). */
  private addHeadlights(): void {
    for (const sx of [-0.52, 0.52]) {
      const spot = new THREE.SpotLight(0xfff0d6, 420, 70, 0.5, 0.55, 1.6);
      spot.position.set(sx, 0.25, -2.0);
      const target = new THREE.Object3D();
      target.position.set(sx * 0.6, -0.1, -22);
      this.carView.root.add(spot, target);
      spot.target = target;
    }
  }

  private fixedUpdate(dt: number): void {
    const d = this.drive;
    d.shiftUp = this.shiftUpPending;
    d.shiftDown = this.shiftDownPending;
    this.shiftUpPending = this.shiftDownPending = false;
    this.vehicle.update(dt, d);
    this.physics.step(dt);
    this.vehicle.postStep();
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

    const a = this.input.consumeActions();
    if (a.toggleDebug) this.debug.toggle();
    if (a.toggleCamera) this.cameras.cycle();
    if (a.reset) this.resetCar();

    const src = this.input.poll(dt);
    Object.assign(this.drive, src);
    this.shiftUpPending ||= src.shiftUp;
    this.shiftDownPending ||= src.shiftDown;

    const alpha = this.stepper.advance(dt);
    this.world.sync();
    this.city?.sky.position.copy(this.ctx.camera.position);
    this.carView.update(this.vehicle, alpha);

    this.carPos.copy(this.carView.root.position);
    this.carQuat.copy(this.carView.root.quaternion);
    if (!this.ctx.renderer.xr.isPresenting) {
      this.cameras.update(dt, this.vehicle, this.carPos, this.carQuat, this.carView.driverEye);
    }
    this.hud.update(dt, this.vehicle);
    this.debug.setExtra(
      `v ${this.vehicle.speedKmh.toFixed(0)} km/h  rpm ${this.vehicle.rpm.toFixed(0)}  g ${this.vehicle.gearbox.gear}\n` +
        `gLat ${this.vehicle.gLat.toFixed(2)}  slip ${this.vehicle.maxSlip.toFixed(2)}  boost ${this.vehicle.turbo.boost.toFixed(2)}`,
    );

    this.ctx.renderer.render(this.ctx.scene, this.ctx.camera);
    this.debug.tick(dt);
  }
}

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
import { buildTestArena, type Arena } from './city/testArena';
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
  readonly arena: Arena;
  readonly cameras: CameraRig;
  readonly hud = new Hud();

  tuning: TuningState = defaultTuning();

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
    scene.environment = env;
    scene.environmentIntensity = 0.55;

    scene.add(new THREE.HemisphereLight(0x6a5cff, 0x120a26, 0.7));
    const moon = new THREE.DirectionalLight(0x9fb4ff, 0.45);
    moon.position.set(-30, 60, 20);
    scene.add(moon);
    const p1 = new THREE.PointLight(0xff2fb3, 60, 40, 1.6);
    p1.position.set(-8, 5, -6);
    const p2 = new THREE.PointLight(0x27e8ff, 60, 40, 1.6);
    p2.position.set(8, 5, -14);
    scene.add(p1, p2);

    this.arena = buildTestArena(physics, env);
    scene.add(this.arena.group);

    const params = resolveVehicleParams(HANABI_200S, this.tuning);
    this.vehicle = new Vehicle(physics, params, this.arena.spawn, { abs: true, steerAssist: 0.45, autoGear: true });
    this.carView = new CarView(HANABI_200S, defaultLook());
    this.carView.setEnvironment(env);
    scene.add(this.carView.root);
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
    const s = this.arena.spawn;
    this.vehicle.reset(s.x, s.z, s.yaw);
    this.cameras.snap();
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
    this.arena.sync();
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

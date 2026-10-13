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
import { CarView } from './car/carView';
import { makeNightEnvironment } from './city/envMap';
import { buildTestArena } from './city/testArena';
import { buildCity, type City } from './city/city';
import { Hud } from './ui/hud';
import { Cockpit } from './car/cockpit';
import { VrMode } from './xr/vrMode';
import { Garage } from './garage/garage';
import { loadGarage } from './garage/state';
import { AudioSystem } from './audio/audioSystem';
import { Fx } from './fx/fx';
import { PerfGovernor, type PerfLevel } from './core/perfGovernor';

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
  readonly cockpit: Cockpit;
  vr: VrMode | null = null;
  readonly garage = new Garage();
  audio: AudioSystem | null = null;
  readonly fx: Fx;
  readonly perf = new PerfGovernor();
  private readonly headlights: THREE.SpotLight[] = [];
  private camBeforeGarage: import('./core/cameras').CamMode = 'chase';

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
    this.carView = new CarView(HANABI_200S, loadGarage().look, { physical: this.quality.physicalMaterials, lod: 'high' });
    this.carView.setEnvironment(this.env);
    scene.add(this.carView.root);
    this.addHeadlights();
    this.cockpit = new Cockpit(this.carView, this.quality.rearMirror);
    const rainParam = new URLSearchParams(location.search).get('rain');
    const rainOn = rainParam === null ? this.quality.rain : rainParam === '1';
    this.fx = new Fx(scene, this.carView, this.quality, HANABI_200S.comHeight, rainOn);

    // Garagem: aplica o visual/tuning salvos e reaplica a cada alteração; abrir a garagem segura o carro.
    this.applyGarage(this.garage.state);
    this.garage.onChange((st) => this.applyGarage(st));
    window.addEventListener('resize', () => this.applyViewOffset());
    this.garage.onOpenChange((open) => {
      this.applyViewOffset();
      if (open) {
        this.camBeforeGarage = this.cameras.mode === 'orbit' ? 'chase' : this.cameras.mode;
        if (!this.ctx.renderer.xr.isPresenting) this.cameras.mode = 'orbit';
      } else {
        this.cameras.mode = this.camBeforeGarage;
        this.cameras.snap();
      }
    });

    // Sessão VR: cria o modo VR sob demanda e devolve a câmera ao desktop ao sair.
    this.xr.onStart = () => {
      this.vr ??= new VrMode({
        renderer: this.ctx.renderer,
        scene: this.ctx.scene,
        camera: this.ctx.camera,
        carView: this.carView,
        vehicle: this.vehicle,
        quality: this.quality,
        layout: this.city?.layout ?? null,
        setAutoGear: (a) => { this.vehicle.options.autoGear = a; },
        resetCar: () => this.resetCar(),
        garage: this.garage,
        debugText: () => this.debug.summary,
        exitVr: () => this.xr.exit(),
      });
      this.vr.onSessionStart();
      // A meta de tempo de quadro segue a taxa real do headset (72/90/120 Hz).
      const rate = this.xr.session?.frameRate ?? this.quality.xrFrameRate;
      this.perf.setTarget(1000 / (rate || this.quality.xrFrameRate));
    };
    this.xr.onEnd = () => {
      this.vr?.onSessionEnd();
      this.perf.level = 0;
      this.applyPerfLevel(0);
    };
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

  /** Aplica o estado completo da garagem (tuning + visual). */
  applyGarage(st: { tuning: TuningState; look: import('./car/carView').CarLook }): void {
    this.applyTuning(st.tuning);
    this.carView.setLook(st.look);
  }

  /** Com a garagem aberta no PC, desloca o enquadramento para centralizar o carro na área livre (à direita do painel). */
  private applyViewOffset(): void {
    const cam = this.ctx.camera;
    const w = this.ctx.renderer.domElement.clientWidth || window.innerWidth;
    const h = this.ctx.renderer.domElement.clientHeight || window.innerHeight;
    if (this.garage.open && !this.ctx.renderer.xr.isPresenting && w > 700) {
      cam.setViewOffset(w, h, -190, 0, w, h);
    } else {
      cam.clearViewOffset();
    }
  }

  resetCar(): void {
    const s = this.world.spawn;
    this.vehicle.reset(s.x, s.z, s.yaw);
    this.cameras.snap();
  }

  /** Aplica o nível do governador de desempenho (só em VR): 1 sem retrovisor/chuva; 2 sem faróis reais; 3 sem partículas. */
  applyPerfLevel(level: PerfLevel): void {
    this.cockpit.mirrorEnabled = level < 1;
    this.fx.setLevel(level);
    for (const l of this.headlights) l.visible = level < 2;
    console.info(`[desempenho] nível ${level} (média ${this.perf.avgMs.toFixed(1)} ms)`);
  }

  /** Faróis: dois SpotLights presos ao carro (sem sombra). */
  private addHeadlights(): void {
    // No tier baixo os faróis são só halos + mancha de luz (CarLights); SpotLight real custa em toda superfície PBR.
    if (!this.quality.headlightSpots) return;
    for (const sx of [-0.52, 0.52]) {
      const spot = new THREE.SpotLight(0xfff0d6, 420, 70, 0.5, 0.55, 1.6);
      this.headlights.push(spot);
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

  /** Liga o áudio; precisa ser chamado de dentro de um gesto do usuário (clique em Jogar/VR). */
  async enableAudio(): Promise<void> {
    if (this.audio) return;
    const st = this.city?.layout.stage;
    const stagePos = st ? { x: (st.x0 + st.x1) / 2, y: 4, z: (st.z0 + st.z1) / 2 } : null;
    try {
      this.audio = new AudioSystem(stagePos);
      await this.audio.start();
    } catch (e) {
      console.warn('Áudio indisponível:', e);
      this.audio = null;
    }
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    this.ctx.renderer.setAnimationLoop((now) => this.frame(now));
  }

  private readonly skyPos = new THREE.Vector3();

  private flipTimer = 0;
  private readonly tmpUp = new THREE.Vector3();
  private readonly aPos = new THREE.Vector3();
  private readonly aFwd = new THREE.Vector3();
  private readonly aUp = new THREE.Vector3();

  private updateAudio(dt: number, presenting: boolean): void {
    if (!this.audio) return;
    const cam = this.ctx.camera;
    cam.updateMatrixWorld();
    cam.getWorldPosition(this.aPos);
    this.aFwd.set(0, 0, -1).transformDirection(cam.matrixWorld);
    this.aUp.set(0, 1, 0).transformDirection(cam.matrixWorld);
    const inside = presenting ? this.vr?.state === 'driving' : this.cameras.mode === 'cockpit' || this.cameras.mode === 'hood';
    this.audio.update(dt, this.vehicle, {
      listenerPos: this.aPos,
      listenerFwd: this.aFwd,
      listenerUp: this.aUp,
      insideCar: !!inside,
      rain: false,
      windowTint: this.carView.look.windowTint,
    });
  }

  private frame(now: number): void {
    const dt = Math.min((now - this.last) / 1000, 0.1);
    this.last = now;
    const { renderer } = this.ctx;
    renderer.info.reset();
    const presenting = renderer.xr.isPresenting && this.vr !== null;

    const a = this.input.consumeActions();
    if (a.toggleDebug) this.debug.toggle();
    if (a.toggleCamera && !presenting) this.cameras.cycle();
    if (a.reset) this.resetCar();
    if (a.toggleGarage && !presenting) this.garage.setOpen(!this.garage.open);
    if (a.toggleMute) this.audio?.toggleMute();

    // Entrada: VR (controles) ou desktop (teclado/gamepad).
    if (presenting) {
      this.vr!.pollInput(dt, this.drive);
      this.shiftUpPending ||= this.drive.shiftUp;
      this.shiftDownPending ||= this.drive.shiftDown;
    } else {
      const src = this.input.poll(dt);
      Object.assign(this.drive, src);
      // Com a garagem aberta o carro fica parado: nada de acelerar/esterçar por tecla.
      if (this.garage.open) Object.assign(this.drive, { throttle: 0, brake: 0, steer: 0, handbrake: 1, shiftUp: false, shiftDown: false });
      this.shiftUpPending ||= src.shiftUp;
      this.shiftDownPending ||= src.shiftDown;
    }

    if (presenting) {
      const lvl = this.perf.push(dt * 1000, dt);
      if (lvl !== null) this.applyPerfLevel(lvl);
    }

    const alpha = this.stepper.advance(dt);
    this.world.sync();
    this.carView.update(this.vehicle, alpha);

    // Capotou e parou: endireita sozinho depois de uns segundos (em VR não há tecla R).
    const upY = this.tmpUp.set(0, 1, 0).applyQuaternion(this.carView.root.quaternion).y;
    this.flipTimer = upY < 0.3 && this.vehicle.speedKmh < 8 ? this.flipTimer + dt : 0;
    if (this.flipTimer > 2.5) {
      this.vehicle.uprightInPlace();
      this.flipTimer = 0;
    }

    // Volante visual no PC: acompanha o esterço (±270°).
    if (!presenting) {
      const max = this.vehicle.params.steering.maxAngleRad || 1;
      this.carView.setWheelAngle((this.vehicle.steerAngle / max) * ((270 * Math.PI) / 180));
    }

    this.carPos.copy(this.carView.root.position);
    this.carQuat.copy(this.carView.root.quaternion);
    if (presenting) {
      this.vr!.placeRig(dt);
    } else {
      this.cameras.update(dt, this.vehicle, this.carPos, this.carQuat, this.carView.driverEye);
    }

    this.cockpit.update(dt, this.vehicle);
    if (presenting || this.cameras.mode === 'cockpit') this.cockpit.renderMirror(renderer, this.ctx.scene);

    this.updateAudio(dt, presenting);
    this.fx.update(dt, this.vehicle, this.ctx.camera.getWorldPosition(this.skyPos), this.audio?.consumeBackfires() ?? 0);

    this.ctx.camera.getWorldPosition(this.skyPos);
    this.city?.sky.position.copy(this.skyPos);
    this.hud.update(dt, this.vehicle);
    this.debug.setExtra(
      `v ${this.vehicle.speedKmh.toFixed(0)} km/h  rpm ${this.vehicle.rpm.toFixed(0)}  g ${this.vehicle.gearbox.gear}\n` +
        `gLat ${this.vehicle.gLat.toFixed(2)}  slip ${this.vehicle.maxSlip.toFixed(2)}  boost ${this.vehicle.turbo.boost.toFixed(2)}`,
    );

    renderer.render(this.ctx.scene, this.ctx.camera);
    this.debug.tick(dt);
  }
}

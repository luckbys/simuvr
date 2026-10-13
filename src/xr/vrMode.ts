import * as THREE from 'three';
import type { CarView } from '../car/carView';
import type { Vehicle } from '../physics/vehicle/vehicle';
import type { DriveInput } from '../core/input';
import type { QualitySettings } from '../core/quality';
import type { CityLayout } from '../city/layout';
import { VrPanel, type PanelRow } from './panel';
import { WheelGrabModel, wheelReturnRate, type HandSample } from './wheelGrab';
import { pulse } from './haptics';
import type { Garage } from '../garage/garage';

export interface VrHost {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  carView: CarView;
  vehicle: Vehicle;
  quality: QualitySettings;
  layout: CityLayout | null;
  setAutoGear(auto: boolean): void;
  /** Reposiciona o carro no ponto de partida. */
  resetCar(): void;
  garage: Garage;
  debugText(): string;
  exitVr(): void;
}

export type VrState = 'driving' | 'walking';
export type SteerMode = 'wheel' | 'stick';

export interface VrSettings {
  lockToLockDeg: number;
  steerMode: SteerMode;
  vignette: boolean;
  snapDeg: number;
}

const SETTINGS_KEY = 'simuvr.vr';
const DEFAULT_SETTINGS: VrSettings = { lockToLockDeg: 540, steerMode: 'wheel', vignette: true, snapDeg: 30 };

function loadSettings(): VrSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<VrSettings>) };
  } catch {
    /* storage indisponível */
  }
  return { ...DEFAULT_SETTINGS };
}

interface Hand {
  side: 'left' | 'right' | null;
  index: number;
  ctrl: THREE.Group;
  grip: THREE.Group;
  src: XRInputSource | null;
  laser: THREE.Mesh;
  trigger: number;
  squeeze: number;
  stickX: number;
  stickY: number;
  down: { trigger: boolean; grip: boolean; a: boolean; b: boolean; stick: boolean };
  edge: { trigger: boolean; grip: boolean; a: boolean; b: boolean; stick: boolean; triggerUp: boolean; bUp: boolean };
  /** Painel sobre o qual o raio está agora (para ignorar o gatilho como acelerador). */
  overPanel: boolean;
}

const BTN = { trigger: 0, squeeze: 1, stick: 3, a: 4, b: 5 } as const;
const UP = new THREE.Vector3(0, 1, 0);
const EXIT_HOLD = 1.0;

/**
 * Orquestra o VR: rig (dolly), controles, volante agarrável, pedais analógicos, locomoção a pé,
 * entrar/sair do carro, menu e conforto. O carro é o referencial quando se está dirigindo.
 */
export class VrMode {
  readonly dolly = new THREE.Group();
  state: VrState = 'driving';
  settings: VrSettings = loadSettings();
  readonly wheel: WheelGrabModel;
  readonly menu = new VrPanel(0.78);
  menuOpen = false;
  readonly hint = new VrPanel(0.5);
  readonly garagePanel = new VrPanel(1.05);
  garagePanelOpen = false;

  private readonly hands: [Hand, Hand];
  /** Transformação do dolly no referencial do carro (definida ao recentrar). */
  private readonly dPos = new THREE.Vector3();
  private readonly dQuat = new THREE.Quaternion();
  /** A pé: posição do chão sob a origem do espaço de referência e rotação em Y. */
  private readonly walkPos = new THREE.Vector3();
  private walkYaw = 0;
  private recenterIn = 0.6;
  private snapCooldown = 0;
  private yHeld = 0;
  private yConsumed = false;
  /** Verdadeiro depois do primeiro recentrar: o banco do motorista está calibrado. */
  seated = false;
  private time = 0;
  private teleporting: Hand | null = null;
  private teleportTarget: THREE.Vector3 | null = null;
  private teleportValid = false;
  private readonly arc: THREE.Line;
  private readonly marker: THREE.Mesh;
  private readonly vignette: THREE.Mesh;
  private vignetteStrength = 0;

  private readonly tA = new THREE.Vector3();
  private readonly tB = new THREE.Vector3();
  private readonly tC = new THREE.Vector3();
  private readonly tE = new THREE.Euler();
  private readonly tQ = new THREE.Quaternion();
  private readonly carPos = new THREE.Vector3();
  private readonly carQuat = new THREE.Quaternion();

  constructor(private readonly host: VrHost) {
    const { renderer, scene, camera } = host;
    this.wheel = new WheelGrabModel({ radius: host.carView.wheelFrame.radius, grabTolerance: 0.12, releaseDistance: 0.34, lockToLock: (this.settings.lockToLockDeg * Math.PI) / 180 });

    scene.add(this.dolly);
    this.dolly.add(camera);

    const mk = (i: number): Hand => {
      const ctrl = renderer.xr.getController(i);
      const grip = renderer.xr.getControllerGrip(i);
      const laser = new THREE.Mesh(
        new THREE.CylinderGeometry(0.0025, 0.0025, 1, 6),
        new THREE.MeshBasicMaterial({ color: new THREE.Color(0x27e8ff).multiplyScalar(2), toneMapped: false, transparent: true, opacity: 0.8 }),
      );
      laser.rotation.x = Math.PI / 2;
      laser.visible = false;
      ctrl.add(laser);
      grip.add(controllerMesh(i === 0 ? 0xff2fb3 : 0x27e8ff));
      this.dolly.add(ctrl, grip);
      const hand: Hand = {
        side: null, index: i, ctrl, grip, src: null, laser,
        trigger: 0, squeeze: 0, stickX: 0, stickY: 0,
        down: { trigger: false, grip: false, a: false, b: false, stick: false },
        edge: { trigger: false, grip: false, a: false, b: false, stick: false, triggerUp: false, bUp: false },
        overPanel: false,
      };
      ctrl.addEventListener('connected', (e) => {
        const data = (e as unknown as { data: XRInputSource }).data;
        hand.src = data;
        hand.side = data.handedness === 'left' ? 'left' : data.handedness === 'right' ? 'right' : null;
      });
      ctrl.addEventListener('disconnected', () => {
        hand.src = null;
        hand.side = null;
      });
      return hand;
    };
    this.hands = [mk(0), mk(1)];

    // Arco do teleporte e marcador no chão.
    const arcGeo = new THREE.BufferGeometry().setFromPoints(Array.from({ length: 32 }, () => new THREE.Vector3()));
    this.arc = new THREE.Line(arcGeo, new THREE.LineBasicMaterial({ color: 0x27e8ff, toneMapped: false }));
    this.arc.frustumCulled = false;
    this.arc.visible = false;
    scene.add(this.arc);
    this.marker = new THREE.Mesh(new THREE.RingGeometry(0.28, 0.4, 32), new THREE.MeshBasicMaterial({ color: 0x27e8ff, toneMapped: false, side: THREE.DoubleSide }));
    this.marker.rotation.x = -Math.PI / 2;
    this.marker.visible = false;
    scene.add(this.marker);

    // Vinheta de conforto presa à câmera.
    this.vignette = new THREE.Mesh(
      new THREE.PlaneGeometry(2.4, 2.4),
      new THREE.ShaderMaterial({
        transparent: true,
        depthTest: false,
        depthWrite: false,
        uniforms: { uS: { value: 0 } },
        vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
        fragmentShader: `varying vec2 vUv; uniform float uS;
          void main(){ float d = length(vUv - 0.5) * 2.0; float a = smoothstep(0.35, 0.95, d) * uS; gl_FragColor = vec4(0.0, 0.0, 0.0, a); }`,
      }),
    );
    this.vignette.position.z = -0.3;
    this.vignette.renderOrder = 999;
    this.vignette.visible = false;
    camera.add(this.vignette);

    this.buildMenu();
    this.menu.mesh.visible = false;
    this.hint.mesh.visible = false;
    this.hint.setRows([{ type: 'label', text: 'A · entrar no carro', color: '#27e8ff' }]);
    scene.add(this.menu.mesh, this.hint.mesh, this.garagePanel.mesh);
    this.garagePanel.mesh.visible = false;

    // Garagem em VR: o painel acompanha a abertura/fechamento do estado compartilhado e as trocas de aba.
    host.garage.rebuildVr = () => this.garagePanel.setRows(host.garage.vrRows(() => host.garage.setOpen(false)));
    host.garage.onOpenChange((open) => (open ? this.openGaragePanel() : this.closeGaragePanel()));
  }

  // ---------------------------------------------------------------------------
  // Sessão
  // ---------------------------------------------------------------------------

  /** Chamada ao iniciar a sessão: começa sentado no carro e recentra assim que a pose do headset chegar. */
  onSessionStart(): void {
    this.state = 'driving';
    this.recenterIn = 0.6;
    this.wheel.reset();
    this.host.vehicle.options.steerAssist = 0;
  }

  onSessionEnd(): void {
    const { scene, camera } = this.host;
    this.dolly.remove(camera);
    scene.add(camera);
    camera.position.set(0, 1.6, 0);
    camera.quaternion.identity();
    camera.scale.set(1, 1, 1);
    this.vignette.visible = false;
    this.menu.mesh.visible = false;
    this.menuOpen = false;
    this.garagePanel.mesh.visible = false;
    this.garagePanelOpen = false;
    this.host.vehicle.options.steerAssist = 0.45;
  }

  /** Reaplica a câmera ao dolly (ao entrar em VR de novo). */
  attachCamera(): void {
    if (this.host.camera.parent !== this.dolly) this.dolly.add(this.host.camera);
  }

  save(): void {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings));
    } catch {
      /* ignorar */
    }
  }

  // ---------------------------------------------------------------------------
  // Entrada (antes da física)
  // ---------------------------------------------------------------------------

  pollInput(dt: number, drive: DriveInput): void {
    this.time += dt;
    this.attachCamera();
    this.readHands(dt);

    const L = this.hand('left');
    const Rh = this.hand('right');

    // Recentrar ao iniciar (quando o headset já reporta altura) e sob demanda (clique do stick esquerdo).
    if (this.recenterIn > 0) {
      this.recenterIn -= dt;
      if (this.recenterIn <= 0) {
        if (this.host.camera.position.y > 0.3) this.recenter();
        else this.recenterIn = 0.2;
      }
    }
    if (L?.edge.stick && this.state === 'driving') this.recenter();

    // Y (botão B do controle esquerdo): toque curto abre o menu; segurar 1 s (parado) sai do carro.
    // `yConsumed` marca a pressão que já virou "sair do carro": ao soltar, não abre o menu.
    if (L?.down.b) this.yHeld += dt;
    if (L?.edge.bUp) {
      if (!this.yConsumed && this.yHeld < 0.5) this.toggleMenu();
      this.yHeld = 0;
      this.yConsumed = false;
    }
    if (this.state === 'driving' && L?.down.b && !this.yConsumed && this.host.vehicle.speedKmh < 6 && this.yHeld >= EXIT_HOLD) {
      this.exitCar();
      this.yConsumed = true;
    }

    if (this.state === 'driving') this.pollDriving(dt, drive, L, Rh);
    else this.pollWalking(dt, drive, L, Rh);

    this.pollPointer();
  }

  private hand(side: 'left' | 'right'): Hand | undefined {
    return this.hands.find((h) => h.side === side);
  }

  private readHands(dt: number): void {
    void dt;
    for (const h of this.hands) {
      const gp = h.src?.gamepad;
      const was = { ...h.down };
      const b = (i: number) => gp?.buttons[i]?.value ?? 0;
      h.trigger = b(BTN.trigger);
      h.squeeze = b(BTN.squeeze);
      h.stickX = gp?.axes[2] ?? 0;
      h.stickY = gp?.axes[3] ?? 0;
      h.down.trigger = h.trigger > 0.55;
      h.down.grip = h.squeeze > 0.55;
      h.down.a = !!gp?.buttons[BTN.a]?.pressed;
      h.down.b = !!gp?.buttons[BTN.b]?.pressed;
      h.down.stick = !!gp?.buttons[BTN.stick]?.pressed;
      h.edge.trigger = h.down.trigger && !was.trigger;
      h.edge.triggerUp = !h.down.trigger && was.trigger;
      h.edge.grip = h.down.grip && !was.grip;
      h.edge.a = h.down.a && !was.a;
      h.edge.b = h.down.b && !was.b;
      h.edge.bUp = !h.down.b && was.b;
      h.edge.stick = h.down.stick && !was.stick;
    }
  }

  // ----- Dirigindo -----

  private pollDriving(dt: number, drive: DriveInput, L: Hand | undefined, R: Hand | undefined): void {
    const veh = this.host.vehicle;
    const cv = this.host.carView;

    // Mãos no referencial do volante (x = 3 horas, y = 12 horas, z = normal para o motorista).
    const f = cv.wheelFrame;
    const samples: HandSample[] = [];
    for (const h of [L, R]) {
      if (!h?.side) continue;
      // posição da mão no referencial do carro: dQuat · p + dPos
      this.tA.copy(h.grip.position).applyQuaternion(this.dQuat).add(this.dPos).sub(f.center);
      samples.push({ id: h.side, x: this.tA.dot(f.right), y: this.tA.dot(f.up), z: this.tA.dot(f.normal), gripping: h.down.grip });
    }
    this.wheel.opts.lockToLock = (this.settings.lockToLockDeg * Math.PI) / 180;
    const fb = THREE.MathUtils.clamp(veh.steerFeedback / 250, -1, 1);
    this.wheel.update(dt, samples, wheelReturnRate(veh.speed, fb));
    if (this.wheel.grabbedNow) pulse(this.hand(this.wheel.grabbedNow as 'left' | 'right')?.src?.gamepad, 0.5, 45);
    cv.setWheelAngle(this.wheel.angle);

    // Pedais analógicos: gatilho direito acelera, esquerdo freia. O que aponta para o menu não conta.
    const rT = R && !R.overPanel ? R.trigger : 0;
    const lT = L && !L.overPanel ? L.trigger : 0;
    drive.throttle = rT;
    drive.brake = lT;
    drive.handbrake = L?.down.a ? 1 : 0; // X (esquerdo)
    drive.clutch = 0;
    drive.shiftUp = !!R?.edge.a;
    drive.shiftDown = !!R?.edge.b;
    drive.steerIsAbsolute = true;
    if (this.host.garage.open) {
      // Com a garagem aberta o carro fica parado.
      drive.throttle = 0;
      drive.brake = 0;
      drive.handbrake = 1;
    }
    // Contra-esterço assistido só no modo analógico (com o volante físico o jogador corrige sozinho).
    veh.options.steerAssist = this.settings.steerMode === 'stick' ? 0.35 : 0;
    if (this.settings.steerMode === 'wheel') {
      drive.steer = this.wheel.steer;
    } else {
      // Modo analógico: stick esquerdo esterça e o volante gira junto (visual).
      const sx = L ? THREE.MathUtils.clamp(Math.abs(L.stickX) < 0.12 ? 0 : L.stickX, -1, 1) : 0;
      drive.steer = sx;
      this.wheel.angle = sx * this.wheel.maxAngle;
      cv.setWheelAngle(this.wheel.angle);
    }

    // Háptica de condução: motor no limitador, pneus no limite e impactos.
    const slip = Math.min(3, Math.max(0, veh.maxSlip - 0.9));
    const rev = veh.engine.fuelCut ? 0.25 : 0;
    const impact = Math.abs(veh.gLat) + Math.abs(veh.gLong) > 2.4 ? 0.9 : 0;
    const base = Math.min(0.6, slip * 0.12 + rev + impact);
    if (base > 0.02) {
      for (const h of [L, R]) if (h?.side && this.wheel.heldBy(h.side)) pulse(h.src?.gamepad, base, impact ? 80 : 30);
    }
  }

  // ----- A pé -----

  private pollWalking(dt: number, drive: DriveInput, L: Hand | undefined, R: Hand | undefined): void {
    // O carro fica parado com o freio de mão.
    drive.throttle = 0;
    drive.brake = 0;
    drive.handbrake = 1;
    drive.steer = 0;
    drive.steerIsAbsolute = true;
    drive.shiftUp = drive.shiftDown = false;

    const headYaw = this.headYaw();

    // Andar suave: stick esquerdo, na direção em que a cabeça aponta.
    if (L && !this.menuOpen) {
      const sx = Math.abs(L.stickX) < 0.18 ? 0 : L.stickX;
      const sy = Math.abs(L.stickY) < 0.18 ? 0 : L.stickY;
      if (sx || sy) {
        const yaw = this.walkYaw + headYaw;
        const speed = 2.2 * dt;
        const dx = (sx * Math.cos(yaw) + sy * Math.sin(yaw)) * speed;
        const dz = (-sx * Math.sin(yaw) + sy * Math.cos(yaw)) * speed;
        this.tryMove(this.walkPos.x + dx, this.walkPos.z + dz);
      }
    }

    // Giro em passos e teleporte: stick direito.
    this.snapCooldown = Math.max(0, this.snapCooldown - dt);
    if (R && !this.menuOpen) {
      if (this.teleporting === null && Math.abs(R.stickX) > 0.7 && this.snapCooldown <= 0 && R.stickY > -0.5) {
        this.snapTurn(R.stickX > 0 ? -1 : 1);
        this.snapCooldown = 0.32;
      }
      if (R.stickY < -0.7) {
        this.teleporting = R;
        this.updateTeleportArc(R);
      } else if (this.teleporting === R) {
        if (this.teleportValid && this.teleportTarget) this.teleportTo(this.teleportTarget);
        this.teleporting = null;
        this.arc.visible = false;
        this.marker.visible = false;
      }
    }

    // Entrar no carro: perto da porta, aperta A (direito).
    const near = this.nearCar();
    this.hint.mesh.visible = near && !this.menuOpen;
    if (near) {
      this.placeHint();
      if (R?.edge.a) this.enterCar();
    }
  }

  private nearCar(): boolean {
    const door = this.tB.set(-1.0, 0, 0.1);
    const root = this.host.carView.root;
    this.tA.copy(door).applyQuaternion(root.quaternion).add(root.position);
    // posição da cabeça no mundo
    this.host.camera.getWorldPosition(this.tC);
    return Math.hypot(this.tA.x - this.tC.x, this.tA.z - this.tC.z) < 2.6 && this.host.vehicle.speedKmh < 8;
  }

  private placeHint(): void {
    const root = this.host.carView.root;
    this.tA.set(-1.0, 1.4, 0.1).applyQuaternion(root.quaternion).add(root.position);
    this.hint.mesh.position.copy(this.tA);
    this.host.camera.getWorldPosition(this.tC);
    this.hint.mesh.lookAt(this.tC);
    this.hint.update();
  }

  private headYaw(): number {
    this.tE.setFromQuaternion(this.host.camera.quaternion, 'YXZ');
    return this.tE.y;
  }

  /**
   * Alguma coisa sólida em (x, z) para uma pessoa de raio `r`? Prédios, palco, carros parados do encontro,
   * postes, o carro do jogador e o limite do mapa.
   */
  private blockedAt(x: number, z: number, r: number): boolean {
    const lay = this.host.layout;
    if (lay) {
      const e = lay.extent;
      if (Math.abs(x) > e || Math.abs(z) > e) return true;
      for (const b of lay.buildings) {
        if (x > b.x - b.w / 2 - r && x < b.x + b.w / 2 + r && z > b.z - b.d / 2 - r && z < b.z + b.d / 2 + r) return true;
      }
      const st = lay.stage;
      if (x > st.x0 - r && x < st.x1 + r && z > st.z0 - r && z < st.z1 + r) return true;
      // Carros parados: caixa de 1,76 × 4,3 m orientada pelo yaw da vaga.
      for (const c of lay.carSlots) {
        const dx = x - c.x, dz = z - c.z;
        const cs = Math.cos(c.yaw), sn = Math.sin(c.yaw);
        const lx = dx * cs - dz * sn;
        const lz = dx * sn + dz * cs;
        if (Math.abs(lx) < 0.88 + r && Math.abs(lz) < 2.15 + r) return true;
      }
      for (const l of lay.lamps) {
        if (Math.abs(x - l.x) < 0.15 + r && Math.abs(z - l.z) < 0.15 + r) return true;
      }
    }
    const root = this.host.carView.root;
    return Math.hypot(x - root.position.x, z - root.position.z) < 1.4 + r * 0.3;
  }

  private tryMove(x: number, z: number): void {
    if (this.blockedAt(x, z, 0.35)) return;
    this.walkPos.x = x;
    this.walkPos.z = z;
  }

  private snapTurn(dir: number): void {
    const a = (this.settings.snapDeg * Math.PI) / 180 * dir;
    // Gira em torno da cabeça (não da origem do espaço de referência).
    this.host.camera.getWorldPosition(this.tC);
    const before = this.tC.clone();
    this.walkYaw += a;
    this.applyWalkTransform();
    this.host.camera.getWorldPosition(this.tC);
    this.walkPos.x += before.x - this.tC.x;
    this.walkPos.z += before.z - this.tC.z;
  }

  private updateTeleportArc(h: Hand): void {
    h.ctrl.updateWorldMatrix(true, false);
    const o = this.tA.setFromMatrixPosition(h.ctrl.matrixWorld);
    const d = this.tB.set(0, 0, -1).transformDirection(h.ctrl.matrixWorld);
    const v0 = 8.5;
    const pts = this.arc.geometry.getAttribute('position') as THREE.BufferAttribute;
    let hit: THREE.Vector3 | null = null;
    let last = o.clone();
    for (let i = 0; i < pts.count; i++) {
      const t = i * 0.045;
      const p = this.tC.set(o.x + d.x * v0 * t, o.y + d.y * v0 * t - 0.5 * 9.8 * t * t, o.z + d.z * v0 * t);
      if (!hit && p.y <= 0.02) {
        // interseção com o chão entre o ponto anterior e este
        const k = last.y / (last.y - p.y || 1);
        hit = new THREE.Vector3(last.x + (p.x - last.x) * k, 0, last.z + (p.z - last.z) * k);
        pts.setXYZ(i, hit.x, 0.02, hit.z);
      } else if (hit) {
        pts.setXYZ(i, hit.x, 0.02, hit.z);
      } else {
        pts.setXYZ(i, p.x, p.y, p.z);
        last = p.clone();
      }
    }
    pts.needsUpdate = true;
    this.arc.visible = true;
    this.teleportTarget = hit;
    this.teleportValid = !!hit && this.isWalkable(hit.x, hit.z);
    (this.arc.material as THREE.LineBasicMaterial).color.set(this.teleportValid ? 0x27e8ff : 0xff3b30);
    this.marker.visible = !!hit;
    if (hit) {
      this.marker.position.set(hit.x, 0.03, hit.z);
      (this.marker.material as THREE.MeshBasicMaterial).color.set(this.teleportValid ? 0x27e8ff : 0xff3b30);
    }
  }

  private isWalkable(x: number, z: number): boolean {
    return !this.blockedAt(x, z, 0.4);
  }

  private teleportTo(target: THREE.Vector3): void {
    // A cabeça deve ficar sobre o alvo: compensa o deslocamento da cabeça em relação à origem.
    this.applyWalkTransform();
    this.host.camera.getWorldPosition(this.tC);
    this.walkPos.x += target.x - this.tC.x;
    this.walkPos.z += target.z - this.tC.z;
    pulse(this.hand('right')?.src?.gamepad, 0.3, 30);
  }

  private applyWalkTransform(): void {
    this.dolly.position.set(this.walkPos.x, 0, this.walkPos.z);
    this.dolly.quaternion.setFromAxisAngle(UP, this.walkYaw);
    this.dolly.updateMatrixWorld(true);
  }

  // ----- Entrar / sair -----

  recenter(): void {
    const cam = this.host.camera;
    this.tE.setFromQuaternion(cam.quaternion, 'YXZ');
    this.dQuat.setFromAxisAngle(UP, -this.tE.y);
    this.dPos.copy(this.host.carView.driverEye).sub(this.tA.copy(cam.position).applyQuaternion(this.dQuat));
    this.seated = true;
  }

  /** Posição do espaço "grip" da mão no espaço de referência do headset (para testes e diagnóstico). */
  gripRef(side: 'left' | 'right', out: THREE.Vector3): boolean {
    const h = this.hand(side);
    if (!h) return false;
    out.copy(h.grip.position);
    return true;
  }

  /** Converte um ponto do referencial do carro para o espaço de referência do headset (inverso do rig). */
  carLocalToRef(p: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
    return out.copy(p).sub(this.dPos).applyQuaternion(this.tQ.copy(this.dQuat).invert());
  }

  enterCar(): void {
    this.closeMenu();
    this.state = 'driving';
    this.wheel.reset();
    this.hint.mesh.visible = false;
    this.recenter();
    pulse(this.hand('right')?.src?.gamepad, 0.5, 60);
  }

  exitCar(): void {
    this.closeMenu();
    const root = this.host.carView.root;
    // Ao lado da porta esquerda, no chão, de frente para o carro.
    this.tA.set(-1.9, 0, 0.1).applyQuaternion(root.quaternion).add(root.position);
    this.walkPos.set(this.tA.x, 0, this.tA.z);
    const dx = root.position.x - this.walkPos.x;
    const dz = root.position.z - this.walkPos.z;
    this.walkYaw = Math.atan2(-dx, -dz);
    this.state = 'walking';
    this.applyWalkTransform();
    // A cabeça está no assento (não onde o dolly nasce): leva a cabeça para a calçada.
    this.host.camera.getWorldPosition(this.tC);
    this.walkPos.x += this.tA.x - this.tC.x;
    this.walkPos.z += this.tA.z - this.tC.z;
    pulse(this.hand('left')?.src?.gamepad, 0.4, 50);
  }

  // ---------------------------------------------------------------------------
  // Posicionamento do rig (depois da física, antes do render)
  // ---------------------------------------------------------------------------

  placeRig(dt: number): void {
    const root = this.host.carView.root;
    if (this.state === 'driving') {
      this.carPos.copy(root.position);
      this.carQuat.copy(root.quaternion);
      this.dolly.quaternion.copy(this.carQuat).multiply(this.dQuat);
      this.dolly.position.copy(this.dPos).applyQuaternion(this.carQuat).add(this.carPos);
    } else {
      this.applyWalkTransform();
    }
    this.dolly.updateMatrixWorld(true);
    this.updateVignette(dt);
    this.menu.update();
    this.garagePanel.update();
    this.updatePointer();
  }

  private updateVignette(dt: number): void {
    const veh = this.host.vehicle;
    let target = 0;
    if (this.settings.vignette && this.state === 'driving') {
      target = THREE.MathUtils.smoothstep(Math.abs(veh.gLat) * 0.7 + Math.abs(veh.gLong) * 0.35 + veh.speedKmh / 260 * 0.25, 0.4, 1.3) * 0.7;
    }
    this.vignetteStrength += (target - this.vignetteStrength) * Math.min(1, dt * 4);
    const u = (this.vignette.material as THREE.ShaderMaterial).uniforms.uS!;
    u.value = this.vignetteStrength;
    this.vignette.visible = this.vignetteStrength > 0.01;
  }

  // ---------------------------------------------------------------------------
  // Menu e ponteiro
  // ---------------------------------------------------------------------------

  toggleMenu(): void {
    if (this.garagePanelOpen) {
      this.host.garage.setOpen(false);
      return;
    }
    this.menuOpen = !this.menuOpen;
    this.menu.mesh.visible = this.menuOpen;
    if (this.menuOpen) this.placeMenu();
    for (const h of this.hands) h.laser.visible = this.menuOpen;
  }

  private placeMenu(): void {
    this.placePanel(this.menu, 0.95);
  }

  /** Coloca um painel à frente da cabeça. Dirigindo, fica preso ao carro; a pé, no mundo. */
  private placePanel(panel: VrPanel, dist: number): void {
    const cam = this.host.camera;
    const head = cam.getWorldPosition(new THREE.Vector3());
    const fwd = this.tB.set(0, 0, -1).transformDirection(cam.matrixWorld);
    fwd.y = 0;
    if (fwd.lengthSq() < 1e-4) fwd.set(0, 0, -1);
    fwd.normalize();
    const world = head.clone().addScaledVector(fwd, dist);
    world.y = head.y - 0.08;
    const parent: THREE.Object3D = this.state === 'driving' ? this.host.carView.root : this.host.scene;
    if (panel.mesh.parent !== parent) parent.add(panel.mesh);
    parent.updateWorldMatrix(true, false);
    panel.mesh.position.copy(world);
    parent.worldToLocal(panel.mesh.position);
    // lookAt aponta o +Z do painel (a face desenhada) para a cabeça.
    panel.mesh.lookAt(head.x, world.y, head.z);
  }

  private openGaragePanel(): void {
    this.closeMenu();
    this.garagePanelOpen = true;
    this.host.garage.rebuildVr?.();
    this.placePanel(this.garagePanel, 1.15);
    this.garagePanel.mesh.visible = true;
    for (const h of this.hands) h.laser.visible = true;
  }

  private closeGaragePanel(): void {
    this.garagePanelOpen = false;
    this.garagePanel.mesh.visible = false;
    this.garagePanel.release();
    for (const h of this.hands) h.laser.visible = this.menuOpen;
  }

  /** Painel que recebe o raio agora (garagem tem prioridade sobre o menu). */
  private activePanel(): VrPanel | null {
    if (this.garagePanelOpen) return this.garagePanel;
    if (this.menuOpen) return this.menu;
    return null;
  }

  private closeMenu(): void {
    if (this.menuOpen) {
      this.menuOpen = false;
      this.menu.mesh.visible = false;
      for (const h of this.hands) h.laser.visible = this.garagePanelOpen;
    }
  }

  private buildMenu(): void {
    const s = this.settings;
    const seg = (label: string, active: () => boolean, onClick: () => void) => ({ text: label, active, onClick });
    const rows: PanelRow[] = [
      { type: 'title', text: 'SIMUVR' },
      { type: 'label', text: () => this.host.debugText() },
      { type: 'button', text: 'Recentrar banco', onClick: () => { if (this.state === 'driving') this.recenter(); } },
      { type: 'label', text: 'Câmbio' },
      {
        type: 'segments',
        items: [
          seg('Automático', () => this.host.vehicle.options.autoGear, () => this.host.setAutoGear(true)),
          seg('Manual', () => !this.host.vehicle.options.autoGear, () => this.host.setAutoGear(false)),
        ],
      },
      { type: 'label', text: 'Direção' },
      {
        type: 'segments',
        items: [
          seg('Volante', () => s.steerMode === 'wheel', () => { s.steerMode = 'wheel'; this.save(); }),
          seg('Analógico', () => s.steerMode === 'stick', () => { s.steerMode = 'stick'; this.save(); }),
        ],
      },
      { type: 'label', text: 'Curso total do volante' },
      {
        type: 'segments',
        items: [360, 540, 720, 900].map((d) => seg(`${d}°`, () => s.lockToLockDeg === d, () => { s.lockToLockDeg = d; this.save(); })),
      },
      { type: 'label', text: 'Conforto' },
      {
        type: 'segments',
        items: [
          seg('Vinheta ligada', () => s.vignette, () => { s.vignette = true; this.save(); }),
          seg('Desligada', () => !s.vignette, () => { s.vignette = false; this.save(); }),
        ],
      },
      { type: 'spacer', h: 8 },
      { type: 'button', text: 'Reposicionar carro', accent: '#ffb02f', onClick: () => { this.host.resetCar(); this.closeMenu(); } },
      {
        type: 'button',
        text: () => (this.state === 'driving' ? 'Sair do carro (parado)' : 'Entrar no carro'),
        onClick: () => {
          if (this.state === 'driving') {
            if (this.host.vehicle.speedKmh < 6) this.exitCar();
          } else this.enterCar();
          this.toggleMenu();
        },
      },
    ];
    rows.push({ type: 'button', text: 'Garagem de tuning', accent: '#ff2fb3', onClick: () => { this.closeMenu(); this.host.garage.setOpen(true); } });
    rows.push({ type: 'button', text: 'Sair do VR', accent: '#ff3b30', onClick: () => this.host.exitVr() });
    this.menu.setRows(rows);
  }

  private pollPointer(): void {
    // O trigger precisa ser lido no mesmo quadro: aplica clique/arraste/solta no painel ativo.
    for (const h of this.hands) h.overPanel = false;
    const panel = this.activePanel();
    if (!panel) return;
    for (const h of this.hands) {
      if (!h.src) continue;
      const hit = this.rayHit(h, panel);
      if (hit) {
        h.overPanel = true;
        panel.setHover(hit.px, hit.py);
        if (h.edge.trigger) {
          if (panel.press(hit.px, hit.py)) pulse(h.src.gamepad, 0.35, 25);
        } else if (h.down.trigger) {
          panel.drag(hit.px);
        }
      }
      if (h.edge.triggerUp) panel.release();
    }
    if (!this.hands.some((h) => h.overPanel)) panel.setHover(null);
  }

  /** Atualiza o comprimento dos lasers (após o posicionamento do rig). */
  private updatePointer(): void {
    const panel = this.activePanel();
    for (const h of this.hands) {
      if (!panel || !h.src) {
        h.laser.visible = false;
        continue;
      }
      const hit = this.rayHit(h, panel);
      const len = hit ? hit.dist : 1.4;
      h.laser.visible = true;
      h.laser.scale.set(1, len, 1);
      h.laser.position.z = -len / 2;
    }
  }

  private rayHit(h: Hand, panel: VrPanel): { px: number; py: number; dist: number } | null {
    h.ctrl.updateWorldMatrix(true, false);
    const o = this.tA.setFromMatrixPosition(h.ctrl.matrixWorld);
    const d = this.tB.set(0, 0, -1).transformDirection(h.ctrl.matrixWorld);
    return panel.hit(o, d);
  }
}

/** Controle procedural: corpo arredondado + anel luminoso, sem baixar modelos da internet. */
function controllerMesh(color: number): THREE.Object3D {
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.02, 0.07, 4, 10),
    new THREE.MeshStandardMaterial({ color: 0x15141c, roughness: 0.5, metalness: 0.4 }),
  );
  body.rotation.x = Math.PI / 2;
  body.position.z = 0.03;
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.034, 0.004, 8, 24),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(2.5), toneMapped: false }),
  );
  ring.position.set(0, 0.012, -0.03);
  ring.rotation.x = Math.PI / 2.4;
  g.add(body, ring);
  return g;
}

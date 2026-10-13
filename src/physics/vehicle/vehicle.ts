import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { PhysicsWorld } from '../world';
import { SURFACES, type SurfaceId } from '../surfaces';
import type { VehicleParams } from '../tuning';
import type { DriveInput } from '../../core/input';
import { Engine, Turbo, RADS_TO_RPM, RPM_TO_RADS } from './engine';
import { Gearbox } from './gearbox';
import { lockTorque } from './differential';
import { TireModel, makeTireOut, type TireOut } from './pacejka';
import { suspensionForce } from './suspension';
import { clamp, lerp, smoothstep, solve3 } from './math';

export interface VehicleOptions {
  /** ABS: evita travar as rodas ao frear forte. */
  abs: boolean;
  /** Contra-esterço automático (0..1), para teclado/gamepad. No volante de VR use 0. */
  steerAssist: number;
  /** Câmbio automático. */
  autoGear: boolean;
}

export interface WheelState {
  contact: boolean;
  surface: SurfaceId;
  /** Compressão da mola (m) e comprimento atual do ponto de fixação ao centro da roda (m). */
  compression: number;
  length: number;
  /** Carga normal (N). */
  load: number;
  /** Velocidade angular (rad/s) e ângulo acumulado de rotação (rad). */
  omega: number;
  spin: number;
  /** Ângulo de esterço desta roda (rad). */
  steer: number;
  fx: number;
  fy: number;
  /** Torque auto-alinhante (N·m). */
  mz: number;
  slipRatio: number;
  slipAngle: number;
  /** Escorregamento combinado normalizado: > 1 = além do pico de aderência. */
  slip: number;
  /** Ponto de contato e normal no mundo. */
  point: THREE.Vector3;
  normal: THREE.Vector3;
}

/** Ponto de teste: faz o raio sondar o chão partindo do ponto de fixação da roda. */
interface Scratch {
  q: THREE.Quaternion;
  p: THREE.Vector3;
  lv: THREE.Vector3;
  av: THREE.Vector3;
  fwd: THREE.Vector3;
  up: THREE.Vector3;
  right: THREE.Vector3;
  down: THREE.Vector3;
  hp: THREE.Vector3;
  vc: THREE.Vector3;
  rel: THREE.Vector3;
  fw: THREE.Vector3;
  lat: THREE.Vector3;
  tmp: THREE.Vector3;
  force: THREE.Vector3;
}

const BRAKE_EPS = 0.15; // rad/s: suavização do sinal do torque de freio perto de ω = 0
const DV_SLOPE = 0.5; // m/s: passo para a derivada numérica da força do pneu

type Vec = { x: number; y: number; z: number };

export class Vehicle {
  readonly body: RAPIER.RigidBody;
  /** Colisores do chassi (carroceria baixa e cabine): recriados a cada mudança de tuning. */
  private colliders: RAPIER.Collider[] = [];
  readonly wheels: WheelState[];
  readonly engine: Engine;
  readonly turbo: Turbo;
  readonly gearbox: Gearbox;
  readonly options: VehicleOptions;
  params: VehicleParams;

  /** Velocidade angular do motor (rad/s). */
  engineOmega: number;
  /** Ângulo de esterço de referência (rad, + = direita, roda interna). */
  steerAngle = 0;
  /** Esterço normalizado final (-1..1) após assistência, para HUD e volante. */
  steerNorm = 0;

  // Saídas
  speed = 0; // m/s, positivo para frente
  speedKmh = 0;
  rpm = 0;
  throttle = 0;
  brake = 0;
  clutch = 1;
  engineTorque = 0;
  /** Aceleração lateral/longitudinal em g, suavizada (para HUD, câmera, áudio). */
  gLat = 0;
  gLong = 0;
  /** Maior escorregamento combinado entre as rodas em contato (0 = rolando, > 1 derrapando). */
  maxSlip = 0;
  /** Escorregamento lateral do eixo traseiro, base de drift/fumaça. */
  driftAngle = 0;
  /** Realimentação do esterço: soma dos torques auto-alinhantes das rodas dianteiras (N·m). */
  steerFeedback = 0;
  airborne = false;
  /** Eventos de um passo. */
  eventShift = false;
  eventBlowOff = false;
  eventRevLimiter = false;

  private tires: [TireModel, TireModel, TireModel, TireModel];
  private readonly alphaF = [0, 0, 0, 0];
  private readonly out0: TireOut = makeTireOut();
  private readonly out1: TireOut = makeTireOut();
  private readonly s: Scratch;
  private readonly prevVel = new THREE.Vector3();
  private readonly ray: RAPIER.Ray;
  private readonly impP: Vec = { x: 0, y: 0, z: 0 };
  private readonly impF: Vec = { x: 0, y: 0, z: 0 };
  private readonly M = new Array<number>(9).fill(0);
  private readonly rhs = new Array<number>(3).fill(0);
  private readonly sol = new Array<number>(3).fill(0);
  private readonly xPrev = [0, 0, 0, 0];
  // Vetores de trabalho do passo (evitam alocar arrays a 120 Hz e o lixo que isso gera no coletor).
  private readonly spring = [0, 0, 0, 0];
  private readonly slopes = [0, 0, 0, 0];
  private readonly wA = [0, 0, 0, 0];
  private readonly wRhs = [0, 0, 0, 0];
  private readonly wDelta = [0, 0, 0, 0];
  private readonly lock = { lk: 0, slope: 0 };
  // Para interpolação de renderização.
  private readonly prevPos = new THREE.Vector3();
  private readonly prevQuat = new THREE.Quaternion();
  private readonly curPos = new THREE.Vector3();
  private readonly curQuat = new THREE.Quaternion();
  private stepCount = 0;

  constructor(
    private readonly pw: PhysicsWorld,
    params: VehicleParams,
    spawn: { x: number; y?: number; z: number; yaw?: number },
    options: Partial<VehicleOptions> = {},
  ) {
    this.params = params;
    this.options = { abs: true, steerAssist: 0, autoGear: true, ...options };

    this.engine = new Engine(params.engine);
    this.turbo = new Turbo(params.engine.turbo);
    this.gearbox = new Gearbox(params.gearbox);
    this.gearbox.auto = this.options.autoGear;
    this.engineOmega = params.engine.idleRpm * RPM_TO_RADS;
    this.rpm = params.engine.idleRpm;

    this.tires = this.buildTires();
    this.wheels = [0, 1, 2, 3].map(() => ({
      contact: false,
      surface: 'asphalt' as SurfaceId,
      compression: 0,
      length: params.wheels[0].susp.lengthMax,
      load: 0,
      omega: 0,
      spin: 0,
      steer: 0,
      fx: 0,
      fy: 0,
      mz: 0,
      slipRatio: 0,
      slipAngle: 0,
      slip: 0,
      point: new THREE.Vector3(),
      normal: new THREE.Vector3(0, 1, 0),
    }));

    const R = pw.R;
    const yaw = spawn.yaw ?? 0;
    const y = spawn.y ?? params.comHeightStatic + 0.05;
    this.body = pw.world.createRigidBody(
      R.RigidBodyDesc.dynamic()
        .setTranslation(spawn.x, y, spawn.z)
        .setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) })
        .setCcdEnabled(true)
        .setCanSleep(false)
        .setAngularDamping(0.05)
        .setLinearDamping(0),
    );
    this.applyChassis();
    this.ray = new R.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });

    this.s = {
      q: new THREE.Quaternion(), p: new THREE.Vector3(), lv: new THREE.Vector3(), av: new THREE.Vector3(),
      fwd: new THREE.Vector3(), up: new THREE.Vector3(), right: new THREE.Vector3(), down: new THREE.Vector3(),
      hp: new THREE.Vector3(), vc: new THREE.Vector3(), rel: new THREE.Vector3(),
      fw: new THREE.Vector3(), lat: new THREE.Vector3(), tmp: new THREE.Vector3(), force: new THREE.Vector3(),
    };
    this.captureTransform();
    this.prevPos.copy(this.curPos);
    this.prevQuat.copy(this.curQuat);
  }

  // ---------------------------------------------------------------------------
  // Configuração
  // ---------------------------------------------------------------------------

  private buildTires(): [TireModel, TireModel, TireModel, TireModel] {
    const w = this.params.wheels;
    return [new TireModel(w[0].tire), new TireModel(w[1].tire), new TireModel(w[2].tire), new TireModel(w[3].tire)];
  }

  /** (Re)cria colisor e propriedades de massa do chassi a partir dos parâmetros. */
  private applyChassis(): void {
    const R = this.pw.R;
    const p = this.params;
    // Remove os dois colisores antigos (senão cada ajuste do tuning empilharia mais um no chassi).
    for (const c of this.colliders) this.pw.world.removeCollider(c, false);
    this.colliders = [];

    const b = p.body;
    const lowerH = 0.22;
    const bottom = b.bottomLocalY;
    // Carroceria baixa e cabine: dois colisores com densidade zero (a massa vem do corpo).
    const lower = R.ColliderDesc.cuboid(b.width / 2 - 0.05, lowerH, b.length / 2 - 0.1)
      .setTranslation(0, bottom + lowerH, 0)
      .setDensity(0)
      .setFriction(0.35)
      .setRestitution(0.12);
    this.colliders.push(this.pw.world.createCollider(lower, this.body));
    const cabin = R.ColliderDesc.cuboid(b.width / 2 - 0.15, 0.2, b.length * 0.24)
      .setTranslation(0, bottom + 2 * lowerH + 0.2, b.length * 0.04)
      .setDensity(0)
      .setFriction(0.35)
      .setRestitution(0.12);
    this.colliders.push(this.pw.world.createCollider(cabin, this.body));

    this.body.setAdditionalMassProperties(
      p.mass,
      { x: 0, y: 0, z: 0 },
      { x: p.inertia[0], y: p.inertia[1], z: p.inertia[2] },
      { x: 0, y: 0, z: 0, w: 1 },
      true,
    );
  }

  /** Aplica novos parâmetros (tuning) sem recriar o corpo rígido. Mantém o estado do motor. */
  setParams(params: VehicleParams): void {
    this.params = params;
    this.tires = this.buildTires();
    this.engine.setSpec(params.engine);
    this.turbo.spec = params.engine.turbo;
    this.gearbox.spec = params.gearbox;
    this.applyChassis();
  }

  /** Reposiciona o carro, zera velocidades e estados internos. */
  reset(x: number, z: number, yaw: number, y?: number): void {
    const h = y ?? this.params.comHeightStatic + 0.05;
    this.body.setTranslation({ x, y: h, z }, true);
    this.body.setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) }, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.engineOmega = this.params.engine.idleRpm * RPM_TO_RADS;
    this.gearbox.gear = 1;
    this.gearbox.shiftTimer = 0;
    this.turbo.boost = 0;
    for (let i = 0; i < 4; i++) {
      const w = this.wheels[i]!;
      w.omega = 0;
      this.alphaF[i] = 0;
      this.xPrev[i] = 0;
    }
    this.steerAngle = 0;
    this.captureTransform();
    this.prevPos.copy(this.curPos);
    this.prevQuat.copy(this.curQuat);
  }

  /** Endireita o carro onde está (mantém a posição e a direção), levantando-o um pouco, e zera as velocidades. */
  uprightInPlace(): void {
    const r = this.body.rotation();
    const t = this.body.translation();
    this.s.q.set(r.x, r.y, r.z, r.w);
    this.s.fwd.set(0, 0, -1).applyQuaternion(this.s.q);
    // Se a frente aponta quase na vertical, usa o lado para achar a direção no plano.
    if (Math.hypot(this.s.fwd.x, this.s.fwd.z) < 0.2) this.s.fwd.set(1, 0, 0).applyQuaternion(this.s.q).applyAxisAngle(this.s.up.set(0, 1, 0), Math.PI / 2);
    const yaw = Math.atan2(-this.s.fwd.x, -this.s.fwd.z);
    this.reset(t.x, t.z, yaw, this.params.comHeightStatic + 0.6);
  }

  /** Lança o carro para frente a `speed` m/s já em `gear`, com rodas e motor coerentes. */
  setForwardSpeed(speed: number, gear: number): void {
    const q = this.body.rotation();
    this.s.q.set(q.x, q.y, q.z, q.w);
    this.s.fwd.set(0, 0, -1).applyQuaternion(this.s.q);
    this.body.setLinvel({ x: this.s.fwd.x * speed, y: 0, z: this.s.fwd.z * speed }, true);
    this.gearbox.gear = gear;
    this.gearbox.shiftTimer = 0;
    for (let i = 0; i < 4; i++) this.wheels[i]!.omega = speed / this.params.wheels[i]!.radius;
    const ratio = this.gearbox.totalRatio;
    const wheelOmega = speed / this.params.wheels[0].radius;
    this.engineOmega = Math.max(this.params.engine.idleRpm * RPM_TO_RADS, Math.abs(ratio) * wheelOmega);
  }

  // ---------------------------------------------------------------------------
  // Passo de simulação (antes de world.step)
  // ---------------------------------------------------------------------------

  update(dt: number, input: DriveInput): void {
    const { s, params, wheels } = this;
    this.eventShift = this.eventBlowOff = this.eventRevLimiter = false;

    // Estado do corpo
    const body = this.body;
    const t = body.translation();
    const rq = body.rotation();
    const lv = body.linvel();
    const av = body.angvel();
    s.q.set(rq.x, rq.y, rq.z, rq.w);
    s.p.set(t.x, t.y, t.z);
    s.lv.set(lv.x, lv.y, lv.z);
    s.av.set(av.x, av.y, av.z);
    s.fwd.set(0, 0, -1).applyQuaternion(s.q);
    s.up.set(0, 1, 0).applyQuaternion(s.q);
    s.right.set(1, 0, 0).applyQuaternion(s.q);
    s.down.copy(s.up).negate();

    this.prevPos.copy(this.curPos);
    this.prevQuat.copy(this.curQuat);

    const vLong = s.lv.dot(s.fwd);
    const vLatBody = s.lv.dot(s.right);
    this.speed = vLong;
    this.speedKmh = Math.abs(vLong) * 3.6;

    // Acelerações em g (diferença de velocidade no mundo, projetada no corpo).
    if (this.stepCount > 0) {
      s.tmp.copy(s.lv).sub(this.prevVel).multiplyScalar(1 / dt);
      this.gLat = lerp(this.gLat, s.tmp.dot(s.right) / 9.81, 0.15);
      this.gLong = lerp(this.gLong, s.tmp.dot(s.fwd) / 9.81, 0.15);
    }
    this.prevVel.copy(s.lv);
    this.stepCount++;

    // ----- Comandos -----
    const gb = this.gearbox;
    gb.auto = this.options.autoGear;
    if (input.shiftUp) gb.shift(1, !gb.auto);
    if (input.shiftDown) gb.shift(-1, !gb.auto);

    const reversing = gb.auto && gb.gear < 0;
    let throttle = reversing ? input.brake : input.throttle;
    let brake = reversing ? input.throttle : input.brake;
    // Em marcha à frente, trocar acelerador por freio em ré parada é tratado pelo câmbio automático.
    throttle = clamp(throttle, 0, 1);
    brake = clamp(brake, 0, 1);
    this.throttle = throttle;
    this.brake = brake;

    this.rpm = this.engineOmega * RADS_TO_RPM;
    // O câmbio decide ré/frente pelos pedais originais, não pelos já trocados para ré.
    gb.update(dt, {
      rpm: this.rpm,
      throttle: clamp(input.throttle, 0, 1),
      brake: clamp(input.brake, 0, 1),
      speed: vLong,
      limiterRpm: params.engine.limiterRpm,
      idleRpm: params.engine.idleRpm,
    });
    if (gb.shifted) this.eventShift = true;

    // ----- Direção -----
    this.updateSteering(dt, input, vLong, vLatBody);

    // ----- Suspensão: passo 1 (raios e compressão) -----
    let anyContact = false;
    for (let i = 0; i < 4; i++) {
      const P = params.wheels[i]!;
      const w = wheels[i]!;
      s.hp.set(P.hardpoint[0], P.hardpoint[1], P.hardpoint[2]).applyQuaternion(s.q).add(s.p);
      const maxToi = P.susp.lengthMax + P.radius;
      this.ray.origin.x = s.hp.x; this.ray.origin.y = s.hp.y; this.ray.origin.z = s.hp.z;
      this.ray.dir.x = s.down.x; this.ray.dir.y = s.down.y; this.ray.dir.z = s.down.z;
      const hit = this.pw.world.castRayAndGetNormal(this.ray, maxToi, true, undefined, undefined, undefined, body);
      if (hit) {
        const lenHit = hit.timeOfImpact - P.radius;
        const lMin = P.susp.lengthMax - P.susp.travel;
        const len = Math.max(lenHit, lMin);
        w.contact = true;
        w.length = len;
        w.compression = P.susp.lengthMax - len;
        w.point.copy(s.hp).addScaledVector(s.down, hit.timeOfImpact);
        w.normal.set(hit.normal.x, hit.normal.y, hit.normal.z);
        // A normal pode apontar para dentro se o raio começou dentro de um colisor: força para cima.
        if (w.normal.y < 0.05) w.normal.set(0, 1, 0);
        w.surface = this.pw.surfaceOf(hit.collider.handle);
        anyContact = true;
      } else {
        w.contact = false;
        w.length = P.susp.lengthMax;
        w.compression = 0;
        w.load = 0;
        w.surface = 'asphalt';
      }
    }
    this.airborne = !anyContact;

    // Forças de mola/amortecedor com barra estabilizadora (por eixo).
    const spring = this.spring;
    spring.fill(0);
    for (let i = 0; i < 4; i++) {
      const w = wheels[i]!;
      if (!w.contact) { this.xPrev[i] = 0; continue; }
      const P = params.wheels[i]!;
      // Velocidade de compressão = velocidade do ponto de fixação projetada para baixo.
      s.hp.set(P.hardpoint[0], P.hardpoint[1], P.hardpoint[2]).applyQuaternion(s.q);
      s.rel.copy(s.hp);
      s.tmp.crossVectors(s.av, s.rel).add(s.lv);
      const v = clamp(s.tmp.dot(s.down), -6, 6);
      spring[i] = suspensionForce(P.susp, w.compression, v);
    }
    for (const [l, r] of [[0, 1], [2, 3]] as const) {
      const wl = wheels[l]!, wr = wheels[r]!;
      if (wl.contact && wr.contact) {
        const arb = params.wheels[l]!.susp.arb;
        const d = wl.compression - wr.compression;
        spring[l]! += arb * d;
        spring[r]! -= arb * d;
      }
    }

    // ----- Pneus: passo 2 -----
    const slopes = this.slopes;
    slopes.fill(0);
    let maxSlip = 0;
    for (let i = 0; i < 4; i++) {
      const P = params.wheels[i]!;
      const w = wheels[i]!;
      if (!w.contact) {
        w.load = 0; w.fx = 0; w.fy = 0; w.mz = 0; w.slipRatio = 0; w.slipAngle = 0; w.slip = 0;
        this.alphaF[i] = 0;
        continue;
      }
      const load = Math.max(0, spring[i]!);
      w.load = load;

      // Velocidade do ponto de contato (rígido com o chassi).
      s.rel.copy(w.point).sub(s.p);
      s.vc.crossVectors(s.av, s.rel).add(s.lv);

      // Base do pneu: frente do carro girada pelo esterço, projetada no plano do solo.
      const steer = w.steer;
      s.fw.copy(s.fwd).multiplyScalar(Math.cos(steer)).addScaledVector(s.right, Math.sin(steer));
      s.fw.addScaledVector(w.normal, -s.fw.dot(w.normal)).normalize();
      s.lat.crossVectors(s.fw, w.normal);

      const vlong = s.vc.dot(s.fw);
      const vlat = s.vc.dot(s.lat);
      const tire = this.tires[i]!;
      this.alphaF[i] = tire.relax(this.alphaF[i]!, vlong, vlat, dt);

      const surf = SURFACES[w.surface];
      const camberDeg = (-P.camber * 180) / Math.PI;
      const latScale = 1 + 0.03 * camberDeg - 0.0045 * camberDeg * camberDeg;
      const longScale = 1 - 0.006 * camberDeg;
      const omegaR = w.omega * P.radius;

      tire.force(this.out0, vlong, vlat, omegaR, load, this.alphaF[i]!, surf.grip, latScale, longScale);
      tire.force(this.out1, vlong, vlat, omegaR + DV_SLOPE, load, this.alphaF[i]!, surf.grip, latScale, longScale);
      // Derivada de Fx em relação a ωR (só a parte estabilizante entra no passo implícito).
      slopes[i] = Math.max(0, (this.out1.fx - this.out0.fx) / DV_SLOPE);

      // Resistência ao rolamento.
      const rr = P.tire.rollingResistance * surf.rolling * load * Math.tanh(vlong / 0.6);
      w.fx = this.out0.fx - rr;
      w.fy = this.out0.fy;
      w.mz = this.out0.mz;
      w.slipRatio = this.out0.kappa;
      w.slipAngle = this.out0.alpha;
      w.slip = this.out0.rho;
      if (w.slip > maxSlip) maxSlip = w.slip;
    }
    this.maxSlip = maxSlip;
    this.steerFeedback = wheels[0]!.mz + wheels[1]!.mz;

    // ----- Motor, embreagem, diferencial e rodas (solução implícita) -----
    this.solveDrivetrain(dt, input, slopes);

    // ----- Aplica forças ao chassi -----
    for (let i = 0; i < 4; i++) {
      const w = wheels[i]!;
      if (!w.contact) continue;

      // Reação de apoio: ao longo da normal do solo, no ponto de contato. Aplicar ao longo do eixo do
      // chassi gera uma componente horizontal espúria quando o carro tem arfagem/rolagem de equilíbrio
      // (o carro parado "andaria" sozinho).
      s.force.copy(w.normal).multiplyScalar(w.load * dt);
      this.impulse(s.force, w.point);

      // Pneu: no ponto de contato.
      const steer = w.steer;
      s.fw.copy(s.fwd).multiplyScalar(Math.cos(steer)).addScaledVector(s.right, Math.sin(steer));
      s.fw.addScaledVector(w.normal, -s.fw.dot(w.normal)).normalize();
      s.lat.crossVectors(s.fw, w.normal);
      s.force.copy(s.fw).multiplyScalar(w.fx * dt).addScaledVector(s.lat, w.fy * dt);
      this.impulse(s.force, w.point);
    }

    // ----- Aerodinâmica -----
    const speedAbs = s.lv.length();
    if (speedAbs > 0.1) {
      s.force.copy(s.lv).multiplyScalar(-params.aero.dragCoef * speedAbs * dt);
      this.impulse(s.force, s.p);
      const v2 = speedAbs * speedAbs * dt;
      s.tmp.set(0, 0, params.wheels[0].hardpoint[2]).applyQuaternion(s.q).add(s.p);
      s.force.copy(s.up).multiplyScalar(-params.aero.downforceFront * v2);
      this.impulse(s.force, s.tmp);
      s.tmp.set(0, 0, params.wheels[2].hardpoint[2]).applyQuaternion(s.q).add(s.p);
      s.force.copy(s.up).multiplyScalar(-params.aero.downforceRear * v2);
      this.impulse(s.force, s.tmp);
    }

    // Ângulo de deriva do corpo (para efeitos).
    this.driftAngle = Math.abs(vLong) > 3 ? Math.atan2(vLatBody, Math.abs(vLong)) : 0;
  }

  /** Chamar após world.step: lê a nova pose para renderização/interpolação. */
  postStep(): void {
    this.captureTransform();
  }

  private captureTransform(): void {
    const t = this.body.translation();
    const r = this.body.rotation();
    this.curPos.set(t.x, t.y, t.z);
    this.curQuat.set(r.x, r.y, r.z, r.w);
  }

  /** Pose interpolada entre o passo anterior e o atual (alpha 0..1). */
  getRenderPose(alpha: number, outPos: THREE.Vector3, outQuat: THREE.Quaternion): void {
    outPos.lerpVectors(this.prevPos, this.curPos, alpha);
    outQuat.slerpQuaternions(this.prevQuat, this.curQuat, alpha);
  }

  private impulse(f: THREE.Vector3, at: THREE.Vector3): void {
    this.impF.x = f.x; this.impF.y = f.y; this.impF.z = f.z;
    this.impP.x = at.x; this.impP.y = at.y; this.impP.z = at.z;
    this.body.applyImpulseAtPoint(this.impF, this.impP, true);
  }

  // ---------------------------------------------------------------------------
  // Direção
  // ---------------------------------------------------------------------------

  private updateSteering(dt: number, input: DriveInput, vLong: number, vLatBody: number): void {
    const st = this.params.steering;
    let cmd = clamp(input.steer, -1, 1);

    // Contra-esterço automático: aponta as rodas na direção em que o carro está deslizando.
    const assist = this.options.steerAssist;
    if (assist > 0 && vLong > 4) {
      const beta = Math.atan2(vLatBody, vLong);
      cmd = clamp(cmd + assist * 1.6 * beta, -1, 1);
    }
    this.steerNorm = cmd;

    const v = Math.abs(vLong);
    let target: number;
    if (input.steerIsAbsolute) {
      target = cmd * st.maxAngleRad;
      this.steerAngle += (target - this.steerAngle) * Math.min(1, dt * 30);
    } else {
      // Teclado/gamepad: o curso diminui com a velocidade para manter o carro controlável.
      const sens = lerp(1, 0.32, smoothstep(6, 48, v));
      target = cmd * st.maxAngleRad * sens;
      const rate = st.ratePerSec * (1 - 0.35 * smoothstep(10, 50, v));
      const maxStep = rate * dt;
      this.steerAngle += clamp(target - this.steerAngle, -maxStep, maxStep);
    }

    // Ackermann: roda interna = steerAngle; a externa gira menos.
    const a = st.ackermann;
    const tOverL = this.params.trackFront / this.params.wheelbase;
    const inner = this.steerAngle;
    const absIn = Math.abs(inner);
    let outer = absIn;
    if (absIn > 1e-4) outer = Math.atan(1 / (1 / Math.tan(absIn) + a * tOverL));
    const sgn = inner >= 0 ? 1 : -1;
    // inner > 0 (direita): a roda direita é a interna.
    this.wheels[1]!.steer = sgn > 0 ? absIn * sgn : outer * sgn;
    this.wheels[0]!.steer = sgn > 0 ? outer * sgn : absIn * sgn;
    // Eixo traseiro não esterça.
    this.wheels[2]!.steer = 0;
    this.wheels[3]!.steer = 0;
  }

  // ---------------------------------------------------------------------------
  // Transmissão
  // ---------------------------------------------------------------------------

  private brakeTorque(i: number, input: DriveInput, brake: number): number {
    const P = this.params;
    const front = i < 2;
    const w = this.wheels[i]!;
    let t = brake * (front ? P.brakes.maxFront : P.brakes.maxRear);
    if (this.options.abs && w.contact && brake > 0) {
      // Reduz a pressão quando a roda escorrega demais.
      const k = -w.slipRatio;
      if (k > 0.2) t *= clamp(1 - (k - 0.2) * 5, 0.15, 1);
    }
    if (!front) t += input.handbrake * P.brakes.handbrake;
    return t;
  }

  private solveDrivetrain(dt: number, input: DriveInput, slopes: number[]): void {
    const { params, wheels, gearbox } = this;
    const eng = this.engine;
    const es = params.engine;
    const driveL = params.driveAxle === 'rear' ? 2 : 0;
    const driveR = driveL + 1;

    // Freios e coeficientes implícitos por roda.
    const A = this.wA; // I/dt + inclinação do pneu + inclinação do freio (N·m por rad/s)
    const rhs = this.wRhs; // torque nas rodas, sem a transmissão
    for (let i = 0; i < 4; i++) {
      const P = params.wheels[i]!;
      const w = wheels[i]!;
      const tb = this.brakeTorque(i, input, this.brake);
      const om = w.omega;
      const d2 = om * om + BRAKE_EPS * BRAKE_EPS;
      const sg = om / Math.sqrt(d2);
      const cB = (tb * BRAKE_EPS * BRAKE_EPS) / (d2 * Math.sqrt(d2));
      const cT = P.radius * P.radius * slopes[i]!;
      A[i] = P.inertia / dt + cT + cB;
      rhs[i] = -P.radius * w.fx - tb * sg;
    }

    // Marcha, embreagem e torque do motor.
    this.rpm = this.engineOmega * RADS_TO_RPM;
    this.turbo.update(dt, this.rpm, this.throttle);
    if (this.turbo.blowOff) this.eventBlowOff = true;
    const wasCut = eng.fuelCut;
    const r = gearbox.totalRatio;
    const eta = params.gearbox.efficiency;
    const omegaIn = r * 0.5 * (wheels[driveL]!.omega + wheels[driveR]!.omega);

    const TeRaw = eng.torque(this.rpm, this.throttle, this.turbo.boost);
    if (eng.fuelCut && !wasCut) this.eventRevLimiter = true;
    let Te = TeRaw;
    // Sincronismo na troca: o ECU acerta a rotação para a nova marcha.
    if (gearbox.shiftTimer > 0 && r !== 0) {
      Te += clamp((es.inertia * (omegaIn - this.engineOmega)) / 0.12, -350, 350);
    }
    this.engineTorque = Te;

    // Capacidade da embreagem (N·m).
    let cap: number;
    if (gearbox.auto) {
      // Controle de lançamento: a capacidade acompanha o torque do motor e é escalada pelo erro de
      // rotação em relação a uma rotação-alvo (maior com mais acelerador). Em regime a embreagem
      // transmite exatamente o torque do motor e a rotação fica no alvo enquanto o carro ganha
      // velocidade; quando as rotações se igualam, o erro cresce e ela trava. É um sistema de primeira
      // ordem (o motor é um único integrador), então não oscila. Sem acelerador o alvo fica acima da
      // marcha lenta: o carro não rasteja e o motor não afoga.
      const target = lerp(es.idleRpm + 250, 3200, Math.pow(this.throttle, 0.75));
      const base = Math.max(Math.abs(TeRaw), 60);
      const f = Math.max(0, 1 + (this.rpm - target) / 200);
      cap = Math.min(params.clutchCapacity, base * f);
    } else {
      cap = (1 - clamp(input.clutch, 0, 1)) * params.clutchCapacity;
    }
    cap *= gearbox.shiftEngage;
    this.clutch = cap / params.clutchCapacity;

    const K = params.clutchStiffness;
    let Tc = 0;
    let q = 0;
    if (r !== 0 && cap > 1e-3) {
      const lin = K * (this.engineOmega - omegaIn);
      if (Math.abs(lin) < cap) { Tc = lin; q = K; } else { Tc = Math.sign(lin) * cap; q = 0; }
    }

    // Diferencial: torque de travamento entre as rodas motrizes.
    const pinion = r * Tc * eta;
    const dw = wheels[driveL]!.omega - wheels[driveR]!.omega;
    const { lk, slope: kLk } = lockTorque(params.diff, pinion, dw, this.lock);

    // Rodas não motrizes: equação escalar.
    for (let i = 0; i < 4; i++) {
      if (i === driveL || i === driveR) continue;
      const w = wheels[i]!;
      const d = rhs[i]! / A[i]!;
      w.omega += d;
      w.spin += w.omega * dt;
    }

    // Sistema 3x3: [Δωe, ΔωL, ΔωR].
    const Ie = es.inertia;
    const a = (r * eta * 0.5);
    const M = this.M;
    const b = this.rhs;
    // linha do motor
    M[0] = Ie / dt + q; M[1] = -q * r * 0.5; M[2] = -q * r * 0.5;
    b[0] = Te - Tc;
    // linha da roda esquerda
    M[3] = -a * q;
    M[4] = A[driveL]! + a * q * r * 0.5 + kLk;
    M[5] = a * q * r * 0.5 - kLk;
    b[1] = a * Tc - lk + rhs[driveL]!;
    // linha da roda direita
    M[6] = -a * q;
    M[7] = a * q * r * 0.5 - kLk;
    M[8] = A[driveR]! + a * q * r * 0.5 + kLk;
    b[2] = a * Tc + lk + rhs[driveR]!;

    const ok = solve3(M, b, this.sol);
    const dwe = ok ? this.sol[0]! : (Te - Tc) * dt / Ie;
    const dwl = ok ? this.sol[1]! : 0;
    const dwr = ok ? this.sol[2]! : 0;

    this.engineOmega = clamp(this.engineOmega + dwe, es.idleRpm * 0.45 * RPM_TO_RADS, es.limiterRpm * 1.25 * RPM_TO_RADS);
    const wl = wheels[driveL]!;
    const wr = wheels[driveR]!;
    wl.omega += dwl;
    wr.omega += dwr;
    wl.spin += wl.omega * dt;
    wr.spin += wr.omega * dt;

    // Corrige as forças longitudinais com a variação de ω deste passo (consistência de momento).
    const deltas = this.wDelta;
    deltas[driveL] = dwl;
    deltas[driveR] = dwr;
    for (let i = 0; i < 4; i++) {
      if (i === driveL || i === driveR) continue;
      deltas[i] = rhs[i]! / A[i]!;
    }
    for (let i = 0; i < 4; i++) {
      const w = wheels[i]!;
      if (w.contact) w.fx += params.wheels[i]!.radius * slopes[i]! * deltas[i]!;
    }

    this.rpm = this.engineOmega * RADS_TO_RPM;
  }
}

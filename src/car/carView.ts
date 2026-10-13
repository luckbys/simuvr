import * as THREE from 'three';
import { HANABI_200S, type CarSpec } from '../physics/carSpec';
import type { Vehicle } from '../physics/vehicle/vehicle';
import type { VehicleParams } from '../physics/tuning';
import { additiveMaterial } from '../fx/glow';
import { buildCarGeometries, type CarGeometries, type CarDims, type CarLod } from './carGeometry';

export type PaintFinish = 'gloss' | 'metallic' | 'matte' | 'pearl' | 'chrome';

export interface CarLook {
  paint: string;
  finish: PaintFinish;
  rimColor: string;
  /** Cor do neon inferior; `null` desliga. */
  underglow: string | null;
  spoiler: 'none' | 'lip' | 'gt' | 'wing';
  windowTint: number;
}

export function defaultLook(): CarLook {
  return { paint: '#e0158a', finish: 'metallic', rimColor: '#c9ced6', underglow: '#27e8ff', spoiler: 'none', windowTint: 0.85 };
}

export function dimsOf(spec: CarSpec): CarDims {
  const b = spec.wheelbase * spec.frontWeight; // CG → eixo traseiro
  return {
    length: spec.body.length,
    width: spec.body.width,
    wheelbase: spec.wheelbase,
    trackFront: spec.trackFront,
    trackRear: spec.trackRear,
    wheelRadius: spec.wheelRadius,
    wheelWidth: spec.wheelWidth,
    comHeight: spec.comHeight,
    frontAxleZ: -(spec.wheelbase - b),
    rearAxleZ: b,
  };
}

const FINISH: Record<PaintFinish, { metalness: number; roughness: number; clearcoat: number }> = {
  gloss: { metalness: 0.15, roughness: 0.22, clearcoat: 1 },
  metallic: { metalness: 0.7, roughness: 0.26, clearcoat: 0.9 },
  matte: { metalness: 0.1, roughness: 0.82, clearcoat: 0 },
  pearl: { metalness: 0.45, roughness: 0.2, clearcoat: 1 },
  chrome: { metalness: 1, roughness: 0.06, clearcoat: 0 },
};

export function applyPaint(mat: THREE.MeshStandardMaterial, look: CarLook): void {
  const f = FINISH[look.finish];
  mat.color.set(look.paint);
  mat.metalness = f.metalness;
  mat.roughness = f.roughness;
  // Verniz e iridescência só existem no material físico (tier alto).
  if (mat instanceof THREE.MeshPhysicalMaterial) {
    mat.clearcoat = f.clearcoat;
    mat.clearcoatRoughness = 0.08;
    mat.iridescence = look.finish === 'pearl' ? 0.6 : 0;
  } else if (look.finish === 'gloss' || look.finish === 'pearl') {
    // Sem verniz: compensa com um pouco menos de rugosidade.
    mat.roughness = Math.max(0.12, f.roughness * 0.8);
  }
  mat.needsUpdate = true;
}

/** Carro do jogador: malhas completas, rodas animadas pela física e visual ajustável. */
export class CarView {
  readonly root = new THREE.Group();
  readonly geo: CarGeometries;
  readonly look: CarLook;
  /** Pontos úteis para o cockpit/VR (no referencial do chassi). */
  readonly driverEye = new THREE.Vector3();
  readonly steeringWheelPos = new THREE.Vector3();
  readonly steeringWheel: THREE.Mesh;
  /** Pivô do volante (posição e inclinação); o giro é feito na malha `steeringWheel`. */
  readonly wheelPivot = new THREE.Group();
  /** Referencial do volante no chassi: centro, normal (para o motorista), 12 horas e 3 horas. */
  readonly wheelFrame = {
    center: new THREE.Vector3(),
    normal: new THREE.Vector3(0, 0, 1),
    up: new THREE.Vector3(0, 1, 0),
    right: new THREE.Vector3(1, 0, 0),
    radius: 0.17,
  };

  private readonly paintMat: THREE.MeshStandardMaterial;
  private readonly glassMat: THREE.MeshStandardMaterial;
  private readonly trimMat = new THREE.MeshStandardMaterial({ color: 0x0c0c10, roughness: 0.6, metalness: 0.2 });
  private readonly wheelMat = new THREE.MeshStandardMaterial({ color: 0x1b1b24, roughness: 0.55, metalness: 0.3, emissive: 0x0a0a10 });
  private readonly tireMat = new THREE.MeshStandardMaterial({ color: 0x08080a, roughness: 0.92, metalness: 0 });
  private readonly rimMat = new THREE.MeshStandardMaterial({ color: 0xc9ced6, roughness: 0.28, metalness: 0.95 });
  private readonly headMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xfff2d8).multiplyScalar(2.5) });
  private readonly tailMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff1020).multiplyScalar(1.6) });
  private readonly intMat = new THREE.MeshStandardMaterial({ color: 0x2a2a36, roughness: 0.8, metalness: 0.05, side: THREE.DoubleSide, emissive: 0x0c0c14 });
  private readonly exhaustMat = new THREE.MeshStandardMaterial({ color: 0xaab0ba, roughness: 0.3, metalness: 1 });
  private readonly underglowMat = additiveMaterial(0x27e8ff, 0.9);
  private readonly underglow: THREE.Mesh;
  private readonly spoilerMeshes = new Map<string, THREE.Mesh>();
  private readonly wheelPivots: THREE.Group[] = [];
  private readonly wheelSpin: THREE.Group[] = [];
  private brakeLights = false;
  private readonly tmpPos = new THREE.Vector3();
  private readonly tmpQuat = new THREE.Quaternion();

  constructor(spec: CarSpec = HANABI_200S, look: CarLook = defaultLook(), opts: { physical?: boolean; lod?: CarLod } = {}) {
    this.look = { ...look };
    const physical = opts.physical ?? true;
    const glassParams = { color: 0x07090d, metalness: 0.2, roughness: 0.05, transparent: true, opacity: 0.85 };
    this.paintMat = physical ? new THREE.MeshPhysicalMaterial() : new THREE.MeshStandardMaterial();
    this.glassMat = physical ? new THREE.MeshPhysicalMaterial(glassParams) : new THREE.MeshStandardMaterial(glassParams);
    const d = dimsOf(spec);
    this.geo = buildCarGeometries(d, opts.lod ?? 'high');
    const g = this.geo;
    const add = (geom: THREE.BufferGeometry, mat: THREE.Material) => {
      const m = new THREE.Mesh(geom, mat);
      this.root.add(m);
      return m;
    };

    add(g.body, this.paintMat);
    add(g.roof, this.paintMat);
    add(g.flares, this.paintMat);
    this.paintMat.side = THREE.DoubleSide; // as meias-cascas dos paralamas são abertas
    add(g.glass, this.glassMat);
    add(g.trim, this.trimMat);
    add(g.headlights, this.headMat);
    add(g.taillights, this.tailMat);
    add(g.exhaust, this.exhaustMat);
    add(g.interior, this.intMat);
    for (const id of ['lip', 'gt', 'wing'] as const) {
      const m = add(g.spoilers[id], this.paintMat);
      m.visible = false;
      this.spoilerMeshes.set(id, m);
    }

    // Rodas: pivô (esterço/cambagem/posição) → giro → pneu + aro.
    for (let i = 0; i < 4; i++) {
      const pivot = new THREE.Group();
      const spin = new THREE.Group();
      const tire = new THREE.Mesh(g.tire, this.tireMat);
      const rim = new THREE.Mesh(g.rim, this.rimMat);
      spin.add(tire, rim);
      pivot.add(spin);
      // Rodas do lado esquerdo: o desenho da face do aro aponta para +X; espelha para -X.
      if (i % 2 === 0) spin.scale.x = -1;
      this.root.add(pivot);
      this.wheelPivots.push(pivot);
      this.wheelSpin.push(spin);
    }

    // Neon inferior: um quadro aditivo logo abaixo do assoalho.
    const ug = new THREE.Mesh(new THREE.PlaneGeometry(spec.body.width * 2.1, spec.body.length * 1.6), this.underglowMat);
    ug.rotation.x = -Math.PI / 2;
    ug.renderOrder = 2;
    this.root.add(ug);
    this.underglow = ug;

    // Volante (posição do cockpit, referencial do chassi; frente do carro = -Z, motorista à esquerda).
    this.steeringWheel = new THREE.Mesh(g.steeringWheel, this.wheelMat);
    this.steeringWheelPos.set(-0.36, 0.7 - spec.comHeight, -0.34);
    this.wheelPivot.position.copy(this.steeringWheelPos);
    const tilt = -0.7;
    this.wheelPivot.rotation.x = tilt;
    this.wheelPivot.add(this.steeringWheel);
    this.root.add(this.wheelPivot);
    this.driverEye.set(-0.36, 1.12 - spec.comHeight, 0.12);
    // Eixos do volante no chassi (inclinação em X): normal aponta para o motorista (+Z e para cima).
    const qt = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), tilt);
    this.wheelFrame.center.copy(this.steeringWheelPos);
    this.wheelFrame.normal.set(0, 0, 1).applyQuaternion(qt);
    this.wheelFrame.up.set(0, 1, 0).applyQuaternion(qt);
    // 3 horas do ponto de vista do motorista (olhando em -normal): (-n) × up.
    this.wheelFrame.right.crossVectors(this.wheelFrame.normal.clone().negate(), this.wheelFrame.up).normalize();

    this.setLook(this.look);
  }

  /** Gira o volante: `phi` em rad, positivo = sentido horário visto pelo motorista (esterço à direita). */
  setWheelAngle(phi: number): void {
    this.steeringWheel.rotation.z = -phi;
  }

  /** Aplica um visual novo (tinta, aros, spoiler, neon). */
  setLook(look: Partial<CarLook>): void {
    Object.assign(this.look, look);
    applyPaint(this.paintMat, this.look);
    this.rimMat.color.set(this.look.rimColor);
    this.glassMat.opacity = this.look.windowTint;
    for (const [id, m] of this.spoilerMeshes) m.visible = id === this.look.spoiler;
    if (this.look.underglow) {
      this.underglowMat.color.set(this.look.underglow);
      this.underglow.visible = true;
    } else {
      this.underglow.visible = false;
    }
  }

  setEnvironment(env: THREE.Texture | null): void {
    for (const m of [this.paintMat, this.glassMat, this.trimMat, this.tireMat, this.rimMat, this.intMat, this.exhaustMat, this.wheelMat]) {
      (m as THREE.MeshStandardMaterial).envMap = env;
      (m as THREE.MeshStandardMaterial).envMapIntensity = m === this.paintMat || m === this.glassMat ? 1.4 : 0.8;
      m.needsUpdate = true;
    }
  }

  /** Altura do assoalho acima do chão: usada para posicionar o neon. */
  private underglowLocalY(p: VehicleParams): number {
    return p.body.bottomLocalY - 0.04;
  }

  /** Atualiza a pose a partir da física (interpolada) e as rodas a partir do estado do veículo. */
  update(vehicle: Vehicle, alpha: number): void {
    vehicle.getRenderPose(alpha, this.tmpPos, this.tmpQuat);
    this.root.position.copy(this.tmpPos);
    this.root.quaternion.copy(this.tmpQuat);

    const p = vehicle.params;
    this.underglow.position.y = this.underglowLocalY(p);

    for (let i = 0; i < 4; i++) {
      const wp = p.wheels[i]!;
      const ws = vehicle.wheels[i]!;
      const pivot = this.wheelPivots[i]!;
      pivot.position.set(wp.hardpoint[0], wp.hardpoint[1] - ws.length, wp.hardpoint[2]);
      pivot.rotation.set(0, -ws.steer, wp.camber * (wp.right ? -1 : 1), 'YXZ');
      this.wheelSpin[i]!.rotation.x = -ws.spin;
    }

    // Luz de freio: brilho extra quando freando.
    const braking = vehicle.brake > 0.05 || vehicle.options.autoGear === false;
    if (braking !== this.brakeLights) {
      this.brakeLights = braking;
      this.tailMat.color.set(0xff1020).multiplyScalar(braking ? 4 : 1.2);
    }
  }

  dispose(): void {
    this.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) m.geometry.dispose();
    });
  }
}

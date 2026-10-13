import * as THREE from 'three';
import type { Vehicle } from '../physics/vehicle/vehicle';

export type CamMode = 'chase' | 'far' | 'hood' | 'cockpit' | 'orbit';
/** 'orbit' (garagem) fica fora do ciclo do teclado. */
const ORDER: CamMode[] = ['chase', 'far', 'hood', 'cockpit'];

/** Câmeras de desktop: perseguição com mola, distante, capô e cockpit. */
export class CameraRig {
  mode: CamMode = 'chase';
  /** Câmera orbital da garagem: azimute, elevação (rad) e distância (m). */
  orbit = { azimuth: 0.6, elevation: 0.22, distance: 6.2 };

  private readonly pos = new THREE.Vector3();
  private readonly target = new THREE.Vector3();
  private readonly fwd = new THREE.Vector3();
  private readonly vel = new THREE.Vector3();
  private readonly want = new THREE.Vector3();
  private readonly look = new THREE.Vector3();
  private readonly tmp = new THREE.Vector3();
  private readonly q = new THREE.Quaternion();
  private heading = 0;
  private fov = 65;
  private ready = false;

  constructor(private readonly camera: THREE.PerspectiveCamera) {}

  cycle(): void {
    this.mode = ORDER[(ORDER.indexOf(this.mode) + 1) % ORDER.length] ?? 'chase';
    this.ready = false;
  }

  /** Reposiciona a câmera imediatamente atrás do carro (após reset). */
  snap(): void {
    this.ready = false;
  }

  update(dt: number, car: Vehicle, carPos: THREE.Vector3, carQuat: THREE.Quaternion, driverEye: THREE.Vector3): void {
    const speed = car.speed;
    if (this.mode === 'orbit') {
      const o = this.orbit;
      this.tmp.set(
        Math.sin(o.azimuth) * Math.cos(o.elevation),
        Math.sin(o.elevation),
        Math.cos(o.azimuth) * Math.cos(o.elevation),
      ).multiplyScalar(o.distance).applyQuaternion(carQuat);
      this.camera.position.copy(carPos).add(this.tmp);
      this.look.set(0, 0.1, 0).applyQuaternion(carQuat).add(carPos);
      this.camera.lookAt(this.look);
      this.fovTo(dt, 45);
      return;
    }
    this.fwd.set(0, 0, -1).applyQuaternion(carQuat);
    const carHeading = Math.atan2(this.fwd.x, -this.fwd.z);

    if (this.mode === 'cockpit' || this.mode === 'hood') {
      const local = this.mode === 'cockpit' ? driverEye : this.tmp.set(0, 0.85 - 0.49, -0.6);
      this.pos.copy(local).applyQuaternion(carQuat).add(carPos);
      this.camera.position.copy(this.pos);
      // O cockpit acompanha o carro por inteiro (inclusive a rolagem), com leve olhar para a curva.
      this.q.copy(carQuat);
      this.camera.quaternion.copy(this.q);
      this.camera.rotateY(-car.steerNorm * 0.08);
      this.fovTo(dt, 78 + Math.min(18, Math.abs(speed) * 0.25));
      return;
    }

    // Velocidade no plano XZ; em derrapagem a câmera acompanha parcialmente a direção do movimento.
    const lv = car.body.linvel();
    this.vel.set(lv.x, 0, lv.z);
    let desired = carHeading;
    const planar = this.vel.length();
    if (planar > 6 && speed > 0) {
      const velHeading = Math.atan2(this.vel.x, -this.vel.z);
      let diff = velHeading - carHeading;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      desired = carHeading + diff * 0.55;
    }
    if (!this.ready) {
      this.heading = carHeading;
    } else {
      let dh = desired - this.heading;
      dh = Math.atan2(Math.sin(dh), Math.cos(dh));
      this.heading += dh * (1 - Math.exp(-dt * 4.5));
    }

    const far = this.mode === 'far';
    const dist = (far ? 9.5 : 6.2) + Math.min(2.2, Math.abs(speed) * 0.03);
    const height = far ? 3.6 : 2.0;
    const bx = Math.sin(this.heading);
    const bz = -Math.cos(this.heading);
    this.target.set(carPos.x, carPos.y + 0.6, carPos.z);
    this.want.set(carPos.x - bx * dist, carPos.y + height, carPos.z - bz * dist);

    if (!this.ready) {
      this.pos.copy(this.want);
      this.ready = true;
    } else {
      const k = 1 - Math.exp(-dt * 7);
      this.pos.lerp(this.want, k);
    }
    // Mantém a câmera acima do chão.
    if (this.pos.y < 0.5) this.pos.y = 0.5;
    this.camera.position.copy(this.pos);
    this.look.set(carPos.x + bx * 3, carPos.y + 0.9, carPos.z + bz * 3);
    this.camera.lookAt(this.look);
    this.fovTo(dt, 62 + Math.min(20, Math.abs(speed) * 0.35));
  }

  private fovTo(dt: number, target: number): void {
    this.fov += (target - this.fov) * (1 - Math.exp(-dt * 3));
    if (Math.abs(this.camera.fov - this.fov) > 0.01) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }
  }
}

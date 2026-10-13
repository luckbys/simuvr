import * as THREE from 'three';
import { makeGlowMaterial, glowQuad } from './billboard';

export interface ParticleConfig {
  max: number;
  /** Aceleração (m/s²), arrasto por segundo. */
  gravity: number;
  drag: number;
  /** Intensidade máxima do brilho aditivo. */
  intensity: number;
  /** Partículas mais perto da câmera que isto (m) somem: evita telas cobertas e overdraw aditivo. */
  nearFade?: number;
}

/**
 * Sistema de partículas em CPU com 1 draw call (InstancedMesh de halos aditivos). O desvanecer é feito
 * escurecendo a cor (aditivo: preto = invisível), e o tamanho cresce com a idade.
 */
export class ParticleSystem {
  readonly mesh: THREE.InstancedMesh;
  private readonly n: number;
  private readonly px: Float32Array;
  private readonly vel: Float32Array;
  private readonly age: Float32Array;
  private readonly life: Float32Array;
  private readonly size: Float32Array; // size0, size1
  private readonly col: Float32Array;
  private head = 0;
  private readonly m = new THREE.Matrix4();
  private readonly c = new THREE.Color();
  private readonly zero = new THREE.Matrix4().makeScale(0, 0, 0);

  constructor(private readonly cfg: ParticleConfig) {
    this.n = cfg.max;
    this.mesh = new THREE.InstancedMesh(glowQuad(), makeGlowMaterial(1), cfg.max);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 4;
    this.px = new Float32Array(cfg.max * 3);
    this.vel = new Float32Array(cfg.max * 3);
    this.age = new Float32Array(cfg.max).fill(1e9);
    this.life = new Float32Array(cfg.max).fill(1);
    this.size = new Float32Array(cfg.max * 2);
    this.col = new Float32Array(cfg.max * 3);
    for (let i = 0; i < cfg.max; i++) {
      this.mesh.setMatrixAt(i, this.zero);
      this.mesh.setColorAt(i, this.c.setRGB(0, 0, 0));
    }
  }

  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, size0: number, size1: number, life: number, color: THREE.ColorRepresentation): void {
    const i = this.head;
    this.head = (this.head + 1) % this.n;
    this.px[i * 3] = x; this.px[i * 3 + 1] = y; this.px[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.age[i] = 0;
    this.life[i] = life;
    this.size[i * 2] = size0;
    this.size[i * 2 + 1] = size1;
    this.c.set(color);
    this.col[i * 3] = this.c.r; this.col[i * 3 + 1] = this.c.g; this.col[i * 3 + 2] = this.c.b;
  }

  get activeCount(): number {
    let k = 0;
    for (let i = 0; i < this.n; i++) if (this.age[i]! < this.life[i]!) k++;
    return k;
  }

  update(dt: number, cam?: THREE.Vector3): void {
    const { gravity, drag, intensity } = this.cfg;
    const near = this.cfg.nearFade ?? 0;
    const damp = Math.exp(-drag * dt);
    for (let i = 0; i < this.n; i++) {
      const a = this.age[i]!;
      const life = this.life[i]!;
      if (a >= life) {
        if (a < 1e8) {
          this.mesh.setMatrixAt(i, this.zero);
          this.age[i] = 1e9;
        }
        continue;
      }
      const t = a + dt;
      this.age[i] = t;
      const k = i * 3;
      this.vel[k]! *= damp;
      this.vel[k + 1] = this.vel[k + 1]! * damp + gravity * dt;
      this.vel[k + 2]! *= damp;
      this.px[k]! += this.vel[k]! * dt;
      this.px[k + 1]! += this.vel[k + 1]! * dt;
      this.px[k + 2]! += this.vel[k + 2]! * dt;
      const u = t / life;
      const s = this.size[i * 2]! + (this.size[i * 2 + 1]! - this.size[i * 2]!) * u;
      this.m.makeScale(s, s, 1).setPosition(this.px[k]!, this.px[k + 1]!, this.px[k + 2]!);
      this.mesh.setMatrixAt(i, this.m);
      let f = (1 - u) * (1 - u) * intensity;
      if (cam && near > 0) {
        // Perto da câmera a partícula some (suave): o overdraw aditivo de poucas partículas grandes é o que mais custa.
        const d = Math.hypot(this.px[k]! - cam.x, this.px[k + 1]! - cam.y, this.px[k + 2]! - cam.z);
        f *= Math.min(1, Math.max(0, (d - near * 0.4) / (near * 0.6)));
      }
      this.mesh.setColorAt(i, this.c.setRGB(this.col[k]! * f, this.col[k + 1]! * f, this.col[k + 2]! * f));
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}

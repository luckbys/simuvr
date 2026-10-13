import * as THREE from 'three';

/**
 * Marcas de pneu no asfalto: buffer circular de quadriláteros escuros alinhados ao rastro de cada
 * roda que desliza. Um único draw call; só envia dados à GPU quando entra um segmento novo.
 */
export class SkidMarks {
  readonly mesh: THREE.Mesh;
  private readonly max: number;
  private readonly pos: Float32Array;
  private readonly col: Float32Array;
  private head = 0;
  private dirty = false;
  private readonly last: Array<{ x: number; z: number; y: number; ok: boolean; lx: number; lz: number }>;
  private readonly geo = new THREE.BufferGeometry();

  constructor(max = 2400, wheels = 4) {
    this.max = max;
    this.pos = new Float32Array(max * 4 * 3);
    this.col = new Float32Array(max * 4 * 4);
    const idx = new Uint32Array(max * 6);
    for (let i = 0; i < max; i++) {
      const v = i * 4;
      idx.set([v, v + 1, v + 2, v + 2, v + 1, v + 3], i * 6);
    }
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    this.geo.setIndex(new THREE.BufferAttribute(idx, 1));
    this.geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
    this.mesh = new THREE.Mesh(
      this.geo,
      new THREE.MeshBasicMaterial({
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
        fog: true,
      }),
    );
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    this.last = Array.from({ length: wheels }, () => ({ x: 0, y: 0, z: 0, ok: false, lx: 1, lz: 0 }));
  }

  /**
   * Chamar por roda a cada quadro. `slipping` ativa o rastro; `dirX/dirZ` é a direção do pneu (para a largura).
   */
  update(wheel: number, active: boolean, x: number, y: number, z: number, dirX: number, dirZ: number, strength: number, width = 0.22): void {
    const l = this.last[wheel]!;
    if (!active) {
      l.ok = false;
      return;
    }
    if (l.ok) {
      const dx = x - l.x, dz = z - l.z;
      const d = Math.hypot(dx, dz);
      if (d > 0.18 && d < 3) {
        // Largura perpendicular ao movimento do rastro.
        const nx = -dz / d, nz = dx / d;
        const hw = width / 2;
        this.push(l.x - nx * hw, l.y, l.z - nz * hw, l.x + nx * hw, l.y, l.z + nz * hw, x - nx * hw, y, z - nz * hw, x + nx * hw, y, z + nz * hw, strength);
        l.x = x; l.y = y; l.z = z;
      } else if (d >= 3) {
        l.ok = false;
      }
    }
    if (!l.ok) {
      l.x = x; l.y = y; l.z = z; l.ok = true;
    }
    void dirX; void dirZ;
  }

  private push(ax: number, ay: number, az: number, bx: number, by: number, bz: number, cx: number, cy: number, cz: number, dx: number, dy: number, dz: number, strength: number): void {
    const i = this.head;
    this.head = (this.head + 1) % this.max;
    const p = i * 12;
    this.pos.set([ax, ay + 0.014, az, bx, by + 0.014, bz, cx, cy + 0.014, cz, dx, dy + 0.014, dz], p);
    const a = Math.min(0.62, 0.18 + strength * 0.3);
    const c = i * 16;
    for (let k = 0; k < 4; k++) this.col.set([0.01, 0.01, 0.012, a], c + k * 4);
    this.dirty = true;
  }

  flush(): void {
    if (!this.dirty) return;
    this.dirty = false;
    (this.geo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
  }

  get segments(): number {
    return this.head;
  }
}

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { CarSlot } from '../city/layout';
import type { CarGeometries, CarDims } from './carGeometry';
import { additiveMaterial } from '../fx/glow';

const SPOILER_IDS = ['lip', 'gt', 'wing'] as const;

/**
 * Todos os carros do encontro em ~10 draw calls: cada parte (pintura, vidro, acabamento, luzes,
 * pneus, aros, neon) é um InstancedMesh e a cor da pintura/aro/neon vai em `instanceColor`.
 */
export class InstancedCars {
  readonly group = new THREE.Group();

  constructor(geo: CarGeometries, d: CarDims, slots: CarSlot[], env: THREE.Texture | null, physical = true) {
    const n = slots.length;
    const paintGeo = mergeNoUv([geo.body, geo.roof, geo.flares]);
    const darkGeo = mergeNoUv([geo.trim, geo.exhaust, geo.interior]);
    // Luzes com cor por vértice: faróis claros na frente, lanternas vermelhas atrás.
    const head = geo.headlights.clone();
    const tail = geo.taillights.clone();
    paintVertices(head, new THREE.Color(0xfff2d8).multiplyScalar(0.9));
    paintVertices(tail, new THREE.Color(0xff1020).multiplyScalar(1.1));
    const lightsGeo = mergeNoUv([head, tail]);

    const mk = (g: THREE.BufferGeometry, mat: THREE.Material, count: number) => {
      const m = new THREE.InstancedMesh(g, mat, count);
      m.frustumCulled = false;
      this.group.add(m);
      return m;
    };

    const paintBase = { color: 0xffffff, metalness: 0.7, roughness: 0.26, envMap: env, envMapIntensity: 1.4, side: THREE.DoubleSide };
    const paintMat = physical
      ? new THREE.MeshPhysicalMaterial({ ...paintBase, clearcoat: 0.9, clearcoatRoughness: 0.08 })
      : new THREE.MeshStandardMaterial(paintBase);
    const paint = mk(paintGeo, paintMat, n);
    const glassParams = { color: 0x07090d, metalness: 0.2, roughness: 0.05, transparent: true, opacity: 0.85, envMap: env, envMapIntensity: 1.2 };
    const glass = mk(geo.glass, physical ? new THREE.MeshPhysicalMaterial(glassParams) : new THREE.MeshStandardMaterial(glassParams), n);
    const dark = mk(darkGeo, new THREE.MeshStandardMaterial({ color: 0x101016, roughness: 0.65, metalness: 0.3, side: THREE.DoubleSide, envMap: env, envMapIntensity: 0.6 }), n);
    const lights = mk(lightsGeo, new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }), n);
    const tires = mk(geo.tire, new THREE.MeshStandardMaterial({ color: 0x08080a, roughness: 0.92 }), n * 4);
    const rims = mk(geo.rim, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.28, metalness: 0.95, side: THREE.DoubleSide, envMap: env, envMapIntensity: 0.9 }), n * 4);
    const ug = mk(new THREE.PlaneGeometry(d.width * 2.1, d.length * 1.6), additiveMaterial(0xffffff, 0.9), n);
    ug.renderOrder = 2;

    const spoilerSets = new Map<string, { mesh: THREE.InstancedMesh; count: number }>();
    for (const id of SPOILER_IDS) {
      const cnt = slots.filter((s) => s.spoiler === id).length;
      if (!cnt) continue;
      spoilerSets.set(id, { mesh: mk(geo.spoilers[id], paintMat, cnt), count: 0 });
    }

    const m = new THREE.Matrix4();
    const mw = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const qy = new THREE.Quaternion();
    const qz = new THREE.Quaternion();
    const p = new THREE.Vector3();
    const one = new THREE.Vector3(1, 1, 1);
    const up = new THREE.Vector3(0, 1, 0);
    const fwd = new THREE.Vector3(0, 0, 1);
    const col = new THREE.Color();
    const hubs = [
      [-d.trackFront / 2, d.frontAxleZ, false],
      [d.trackFront / 2, d.frontAxleZ, true],
      [-d.trackRear / 2, d.rearAxleZ, false],
      [d.trackRear / 2, d.rearAxleZ, true],
    ] as const;

    slots.forEach((s, i) => {
      const comH = d.comHeight - s.drop;
      q.setFromAxisAngle(up, s.yaw);
      m.compose(p.set(s.x, comH, s.z), q, one);
      for (const mesh of [paint, glass, dark, lights]) mesh.setMatrixAt(i, m);
      paint.setColorAt(i, col.set(s.paint));
      const set = spoilerSets.get(s.spoiler);
      if (set) {
        set.mesh.setMatrixAt(set.count, m);
        set.mesh.setColorAt(set.count, col.set(s.paint));
        set.count++;
      }
      ug.setMatrixAt(i, mw.compose(p.set(s.x, 0.03, s.z), new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, s.yaw, 0, 'YXZ')), one));
      ug.setColorAt(i, col.set(s.underglow).multiplyScalar(0.9));

      hubs.forEach(([hx, hz, right], k) => {
        // Cubo: sobe `drop` em relação ao CG porque o chassi desce com o rebaixamento.
        const local = new THREE.Vector3(hx, d.wheelRadius - comH, hz);
        // Cambagem: topo para dentro (esquerda: rotação -Z; direita: +Z em valor absoluto do ângulo)
        qz.setFromAxisAngle(fwd, ((s.camber * Math.PI) / 180) * (right ? -1 : 1));
        // A roda esquerda é virada 180° em Y: o prato do aro aponta para fora.
        const flip = right ? 0 : Math.PI;
        const qf = new THREE.Quaternion().setFromAxisAngle(up, flip);
        const wq = new THREE.Quaternion().copy(q).multiply(qz).multiply(qf);
        const wp = local.clone().applyQuaternion(q).add(new THREE.Vector3(s.x, comH, s.z));
        const idx = i * 4 + k;
        mw.compose(wp, wq, one);
        tires.setMatrixAt(idx, mw);
        rims.setMatrixAt(idx, mw);
        rims.setColorAt(idx, col.set(s.rim));
      });
      void qy;
    });

    for (const mesh of this.group.children as THREE.InstancedMesh[]) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
    for (const set of spoilerSets.values()) set.mesh.count = set.count;
  }
}

/** Mescla cópias sem `uv` (a carroceria em loft não tem; as caixas e cilindros têm). */
function mergeNoUv(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const copies = geos.map((g) => {
    const c = g.clone();
    c.deleteAttribute('uv');
    return c;
  });
  return mergeGeometries(copies)!;
}

function paintVertices(g: THREE.BufferGeometry, color: THREE.Color): void {
  const n = g.getAttribute('position').count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) arr.set([color.r, color.g, color.b], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
}

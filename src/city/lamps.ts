import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Lamp } from './layout';
import { makeGlowSet } from '../fx/billboard';
import { additiveMaterial } from '../fx/glow';

/** Postes (1 DC), cabeças emissivas (1 DC), halos (1 DC) e poças de luz no chão (1 DC). */
export function buildLamps(lamps: Lamp[]): THREE.Object3D[] {
  const out: THREE.Object3D[] = [];
  if (!lamps.length) return out;

  const poleGeo = mergeGeometries([
    (() => { const g = new THREE.CylinderGeometry(0.1, 0.16, 8.6, 6); g.translate(0, 4.3, 0); return g; })(),
    (() => { const g = new THREE.BoxGeometry(0.09, 0.09, 2.2); g.translate(0, 8.55, 1.0); return g; })(),
  ])!;
  const poles = new THREE.InstancedMesh(poleGeo, new THREE.MeshStandardMaterial({ color: 0x15151c, roughness: 0.5, metalness: 0.6 }), lamps.length);
  const heads = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.5, 0.12, 0.9),
    new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }),
    lamps.length,
  );
  const pools = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), additiveMaterial(0xffffff, 0.5), lamps.length);

  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const p = new THREE.Vector3();
  const one = new THREE.Vector3(1, 1, 1);
  const c = new THREE.Color();
  const glows: Array<{ x: number; y: number; z: number; size: number; color: number; intensity: number }> = [];
  lamps.forEach((l, i) => {
    q.setFromAxisAngle(up, l.rotY);
    m.compose(p.set(l.x, 0, l.z), q, one);
    poles.setMatrixAt(i, m);
    // O braço aponta para +Z local; a cabeça fica na ponta.
    const hx = l.x + Math.sin(l.rotY) * 2.0;
    const hz = l.z + Math.cos(l.rotY) * 2.0;
    const col = l.warm ? 0xffc477 : 0xbfd8ff;
    m.compose(p.set(hx, 8.5, hz), q, one);
    heads.setMatrixAt(i, m);
    heads.setColorAt(i, c.set(col).multiplyScalar(3));
    glows.push({ x: hx, y: 8.3, z: hz, size: 7, color: col, intensity: 0.7 });
    // Poça de luz no chão sob a cabeça.
    m.compose(p.set(hx, 0.025, hz), new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0)), new THREE.Vector3(18, 18, 1));
    pools.setMatrixAt(i, m);
    pools.setColorAt(i, c.set(col).multiplyScalar(0.55));
  });
  for (const o of [poles, heads, pools]) {
    o.count = lamps.length;
    o.frustumCulled = false;
  }
  pools.renderOrder = 1;
  out.push(poles, heads, pools, makeGlowSet(glows, 0.9));
  return out;
}

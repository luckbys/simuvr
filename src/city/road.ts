import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { CityLayout } from './layout';
import { wetAsphaltTextures } from './testArena';

export const CURB_HEIGHT = 0.15;

/** Piso de asfalto molhado, calçadas elevadas e faixas pintadas. Devolve objetos prontos (4 DC). */
export function buildRoads(city: CityLayout, env: THREE.Texture | null): THREE.Object3D[] {
  const out: THREE.Object3D[] = [];
  const ext = city.extent + 220;

  const tex = wetAsphaltTextures((ext * 2) / 4);
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(ext * 2, ext * 2),
    new THREE.MeshStandardMaterial({ map: tex.map, roughnessMap: tex.roughnessMap, roughness: 1, metalness: 0.05, envMap: env, envMapIntensity: 1.6 }),
  );
  ground.rotation.x = -Math.PI / 2;
  out.push(ground);

  // Calçadas: uma laje por quarteirão (o encontro tem piso próprio).
  const slabs: THREE.BufferGeometry[] = [];
  for (const b of city.blocks) {
    if (rectsEqualMeet(b, city)) continue;
    const g = new THREE.BoxGeometry(b.x1 - b.x0, CURB_HEIGHT, b.z1 - b.z0);
    g.translate((b.x0 + b.x1) / 2, CURB_HEIGHT / 2, (b.z0 + b.z1) / 2);
    slabs.push(g);
  }
  const sidewalks = new THREE.Mesh(
    mergeGeometries(slabs)!,
    new THREE.MeshStandardMaterial({ color: 0x2a2833, roughness: 0.75, metalness: 0.05, envMap: env, envMapIntensity: 0.5 }),
  );
  out.push(sidewalks);

  // Faixas pintadas (um único mesh): eixo tracejado das ruas e faixas de pedestres nos cruzamentos.
  const P = city.pitch;
  const road = city.config.roadWidth;
  const nx = city.config.blocksX, nz = city.config.blocksZ;
  const cx0 = -((nx - 1) / 2) * P;
  const cz0 = -((nz - 1) / 2) * P;
  const white: THREE.BufferGeometry[] = [];
  const yellow: THREE.BufferGeometry[] = [];
  const plane = (w: number, d: number, x: number, z: number, arr: THREE.BufferGeometry[]) => {
    const g = new THREE.PlaneGeometry(w, d);
    g.rotateX(-Math.PI / 2);
    g.translate(x, 0.014, z);
    arr.push(g);
  };
  // Ruas em X (z fixo) e em Z (x fixo)
  for (let j = 0; j <= nz; j++) {
    const z = cz0 + (j - 0.5) * P;
    for (let x = cx0 - P / 2 + road; x < cx0 + (nx - 0.5) * P - road; x += 6) {
      if (inCrossing(x, cx0, P, nx, road)) continue;
      plane(2.2, 0.18, x, z, yellow);
    }
  }
  for (let i = 0; i <= nx; i++) {
    const x = cx0 + (i - 0.5) * P;
    for (let z = cz0 - P / 2 + road; z < cz0 + (nz - 0.5) * P - road; z += 6) {
      if (inCrossing(z, cz0, P, nz, road)) continue;
      plane(0.18, 2.2, x, z, yellow);
    }
  }
  // Faixas de pedestres: 4 por cruzamento
  for (let i = 0; i <= nx; i++) {
    for (let j = 0; j <= nz; j++) {
      const x = cx0 + (i - 0.5) * P;
      const z = cz0 + (j - 0.5) * P;
      if (x > city.meet.x0 - road && x < city.meet.x1 + road && z > city.meet.z0 - road && z < city.meet.z1 + road) continue;
      for (let k = -2; k <= 2; k++) {
        const o = k * 1.5;
        plane(0.7, 3.2, x + o, z - road / 2 - 1.6, white);
        plane(0.7, 3.2, x + o, z + road / 2 + 1.6, white);
        plane(3.2, 0.7, x - road / 2 - 1.6, z + o, white);
        plane(3.2, 0.7, x + road / 2 + 1.6, z + o, white);
      }
    }
  }
  const paintMat = (color: number) => new THREE.MeshStandardMaterial({ color, roughness: 0.4, metalness: 0.1, envMap: env, envMapIntensity: 0.9 });
  if (white.length) out.push(new THREE.Mesh(mergeGeometries(white)!, paintMat(0xc9cde0)));
  if (yellow.length) out.push(new THREE.Mesh(mergeGeometries(yellow)!, paintMat(0xe0b020)));
  return out;
}

function rectsEqualMeet(b: { x0: number; x1: number; z0: number; z1: number }, city: CityLayout): boolean {
  const m = city.meet;
  const cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;
  return cx > m.x0 && cx < m.x1 && cz > m.z0 && cz < m.z1;
}

function inCrossing(t: number, c0: number, P: number, n: number, road: number): boolean {
  const rel = (t - (c0 - P / 2)) / P;
  const frac = rel - Math.floor(rel);
  const k = Math.floor(rel);
  if (k < 0 || k > n) return false;
  return frac < (road / 2 + 4) / P || frac > 1 - (road / 2 + 4) / P;
}

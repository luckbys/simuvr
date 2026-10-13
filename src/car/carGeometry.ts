import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * Geometrias procedurais do carro (sem assets de terceiros). Tudo no referencial do chassi:
 * origem no centro de massa, frente em -Z, alturas dadas "acima do chão" e convertidas por `h2y`.
 */

/** Estação de um loft: posição z, alturas inferior/superior e meia-largura. */
export interface Station {
  z: number;
  hb: number;
  ht: number;
  hw: number;
}

export interface CarDims {
  length: number;
  width: number;
  wheelbase: number;
  trackFront: number;
  trackRear: number;
  wheelRadius: number;
  wheelWidth: number;
  /** Altura do CG acima do chão na altura original (m). */
  comHeight: number;
  /** Posições z dos eixos (dianteiro negativo). */
  frontAxleZ: number;
  rearAxleZ: number;
}

/**
 * Cria um anel superelíptico por estação e liga os anéis em malha fechada, com tampas nas pontas.
 * `n` controla o "quadrado" da seção: 2 = elipse, 4+ = caixa arredondada.
 */
export function loft(stations: Station[], h2y: (h: number) => number, n = 3.2, segs = 28): THREE.BufferGeometry {
  const pos: number[] = [];
  const idx: number[] = [];
  const e = 2 / n;
  for (const st of stations) {
    const yc = h2y((st.hb + st.ht) / 2);
    const hh = (st.ht - st.hb) / 2;
    for (let k = 0; k < segs; k++) {
      const a = (k / segs) * Math.PI * 2;
      const c = Math.cos(a), s = Math.sin(a);
      pos.push(Math.sign(c) * Math.abs(c) ** e * st.hw, yc + Math.sign(s) * Math.abs(s) ** e * hh, st.z);
    }
  }
  for (let i = 0; i < stations.length - 1; i++) {
    for (let k = 0; k < segs; k++) {
      const a = i * segs + k;
      const b = i * segs + ((k + 1) % segs);
      const c = (i + 1) * segs + k;
      const d = (i + 1) * segs + ((k + 1) % segs);
      idx.push(a, c, b, b, c, d);
    }
  }
  // Tampas.
  const first = stations[0]!;
  const last = stations[stations.length - 1]!;
  const cf = pos.length / 3;
  pos.push(0, h2y((first.hb + first.ht) / 2), first.z);
  const cl = pos.length / 3;
  pos.push(0, h2y((last.hb + last.ht) / 2), last.z);
  const lastBase = (stations.length - 1) * segs;
  for (let k = 0; k < segs; k++) {
    const k2 = (k + 1) % segs;
    idx.push(cf, k, k2);
    idx.push(cl, lastBase + k2, lastBase + k);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Garante que as normais apontam para fora (a malha nasce com um sentido de enrolamento fixo). */
function orientOutward(g: THREE.BufferGeometry): THREE.BufferGeometry {
  g.computeBoundingBox();
  const c = g.boundingBox!.getCenter(new THREE.Vector3());
  const p = g.getAttribute('position');
  const n = g.getAttribute('normal');
  let dot = 0;
  for (let i = 0; i < p.count; i++) {
    dot += (p.getX(i) - c.x) * n.getX(i) + (p.getY(i) - c.y) * n.getY(i) + (p.getZ(i) - c.z) * n.getZ(i);
  }
  if (dot < 0) {
    const index = g.getIndex()!;
    for (let i = 0; i < index.count; i += 3) {
      const t = index.getX(i + 1);
      index.setX(i + 1, index.getX(i + 2));
      index.setX(i + 2, t);
    }
    g.computeVertexNormals();
  }
  return g;
}

/**
 * Remove os triângulos voltados para cima dentro de uma faixa em z, abrindo o "deck" da carroceria.
 * Usado na cabine: o carro fica com laterais/portas mas sem tampa sólida sobre o habitáculo.
 */
function openTop(g: THREE.BufferGeometry, zMin: number, zMax: number, minY: number): THREE.BufferGeometry {
  const pos = g.getAttribute('position');
  const index = g.getIndex()!;
  const kept: number[] = [];
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const e1 = new THREE.Vector3(), e2 = new THREE.Vector3();
  for (let i = 0; i < index.count; i += 3) {
    a.fromBufferAttribute(pos, index.getX(i));
    b.fromBufferAttribute(pos, index.getX(i + 1));
    c.fromBufferAttribute(pos, index.getX(i + 2));
    e1.subVectors(b, a);
    e2.subVectors(c, a);
    const ny = e1.z * e2.x - e1.x * e2.z; // componente y de e1 × e2 (não normalizada)
    const len = e1.cross(e2).length();
    const cz = (a.z + b.z + c.z) / 3;
    const cy = (a.y + b.y + c.y) / 3;
    const topFacing = len > 0 && Math.abs(ny) / len > 0.45 && cy > minY;
    if (topFacing && cz > zMin && cz < zMax) continue;
    kept.push(index.getX(i), index.getX(i + 1), index.getX(i + 2));
  }
  g.setIndex(kept);
  g.computeVertexNormals();
  return g;
}

export interface CarGeometries {
  /** Carroceria inferior + capô + porta-malas (pintura). */
  body: THREE.BufferGeometry;
  /** Teto (pintura). */
  roof: THREE.BufferGeometry;
  /** Vidros. */
  glass: THREE.BufferGeometry;
  /** Faixas pretas: para-choques inferiores, saias e difusor. */
  trim: THREE.BufferGeometry;
  /** Paralamas largos sobre as rodas (pintura). */
  flares: THREE.BufferGeometry;
  headlights: THREE.BufferGeometry;
  taillights: THREE.BufferGeometry;
  tire: THREE.BufferGeometry;
  rim: THREE.BufferGeometry;
  /** Spoilers prontos, indexados por id do tuning. */
  spoilers: Record<'lip' | 'gt' | 'wing', THREE.BufferGeometry>;
  exhaust: THREE.BufferGeometry;
  /** Interior: painel e bancos. */
  interior: THREE.BufferGeometry;
  /** Aro do volante, centrado na origem e no plano XY, raio 0.18 (será posicionado no cockpit). */
  steeringWheel: THREE.BufferGeometry;
}

export type CarLod = 'low' | 'high';

export function buildCarGeometries(d: CarDims, lod: CarLod = 'high'): CarGeometries {
  const hi = lod === 'high';
  const h2y = (h: number) => h - d.comHeight;
  const L2 = d.length / 2;

  // ----- Carroceria: front → traseira. hw nas rodas fica abaixo da face externa do pneu. -----
  const bodySt: Station[] = [
    { z: -L2, hb: 0.3, ht: 0.52, hw: 0.62 },
    { z: -L2 + 0.08, hb: 0.22, ht: 0.6, hw: 0.74 },
    { z: -L2 + 0.35, hb: 0.18, ht: 0.64, hw: 0.8 },
    { z: d.frontAxleZ, hb: 0.18, ht: 0.68, hw: 0.8 },
    { z: -0.7, hb: 0.18, ht: 0.74, hw: 0.82 },
    // Estação exata na borda do recorte do deck da cabine (começa em z = -0,6).
    { z: -0.6, hb: 0.18, ht: 0.76, hw: 0.82 },
    { z: -0.15, hb: 0.18, ht: 0.84, hw: 0.84 },
    { z: 0.6, hb: 0.18, ht: 0.86, hw: 0.84 },
    { z: d.rearAxleZ - 0.2, hb: 0.18, ht: 0.9, hw: 0.82 },
    // Fim do recorte do deck da cabine (z = 1,46): a tampa do porta-malas fica intacta daqui para trás.
    { z: 1.46, hb: 0.18, ht: 0.915, hw: 0.81 },
    { z: d.rearAxleZ + 0.35, hb: 0.2, ht: 0.94, hw: 0.8 },
    { z: L2 - 0.08, hb: 0.24, ht: 0.92, hw: 0.72 },
    { z: L2, hb: 0.3, ht: 0.84, hw: 0.6 },
  ];
  const body = openTop(orientOutward(loft(bodySt, h2y, 3.6, hi ? 28 : 16)), -0.601, 1.461, h2y(0.66));

  // ----- Cabine (vidros) e teto -----
  const cabinSt: Station[] = [
    { z: -0.62, hb: 0.8, ht: 0.84, hw: 0.78 },
    { z: -0.45, hb: 0.82, ht: 1.0, hw: 0.74 },
    { z: -0.05, hb: 0.84, ht: 1.26, hw: 0.64 },
    { z: 0.8, hb: 0.86, ht: 1.27, hw: 0.64 },
    { z: 1.28, hb: 0.88, ht: 1.08, hw: 0.7 },
    { z: 1.5, hb: 0.9, ht: 0.94, hw: 0.76 },
  ];
  const glass = orientOutward(loft(cabinSt, h2y, 3.0, hi ? 24 : 14));

  // Chapa do teto: cabe na parte plana do vidro (z de -0,05 a 0,8) e fica assentada nele.
  const roof = new THREE.BoxGeometry(1.1, 0.03, 0.86);
  roof.translate(0, h2y(1.262), 0.38);

  // ----- Faixas pretas (bocal, saias, difusor) -----
  const trimParts: THREE.BufferGeometry[] = [];
  const front = new THREE.BoxGeometry(1.46, 0.1, 0.12);
  front.translate(0, h2y(0.22), -L2 + 0.04);
  trimParts.push(front);
  const rear = new THREE.BoxGeometry(1.4, 0.12, 0.12);
  rear.translate(0, h2y(0.24), L2 - 0.04);
  trimParts.push(rear);
  for (const sx of [-1, 1]) {
    const skirt = new THREE.BoxGeometry(0.06, 0.1, 1.9);
    skirt.translate(sx * 0.82, h2y(0.22), 0.4);
    trimParts.push(skirt);
  }
  const trim = mergeGeometries(trimParts)!;

  // ----- Paralamas largos: meia-casca cilíndrica sobre cada roda -----
  const flareParts: THREE.BufferGeometry[] = [];
  const flareR = d.wheelRadius + 0.05;
  for (const [x, z, w] of [
    [-d.trackFront / 2, d.frontAxleZ, d.wheelWidth + 0.04],
    [d.trackFront / 2, d.frontAxleZ, d.wheelWidth + 0.04],
    [-d.trackRear / 2, d.rearAxleZ, d.wheelWidth + 0.06],
    [d.trackRear / 2, d.rearAxleZ, d.wheelWidth + 0.06],
  ] as const) {
    const fl = new THREE.CylinderGeometry(flareR, flareR, w, hi ? 20 : 10, 1, true, -Math.PI * 0.62, Math.PI * 1.24);
    // eixo do cilindro de Y para X; abertura voltada para baixo
    fl.rotateZ(Math.PI / 2);
    fl.rotateX(0);
    fl.translate(x, h2y(d.wheelRadius), z);
    flareParts.push(fl);
  }
  const flares = mergeGeometries(flareParts)!;

  // ----- Faróis e lanternas (emissivos) -----
  const hl: THREE.BufferGeometry[] = [];
  const tl: THREE.BufferGeometry[] = [];
  for (const sx of [-1, 1]) {
    const h = new THREE.BoxGeometry(0.34, 0.09, 0.05);
    h.translate(sx * 0.52, h2y(0.62), -L2 + 0.12);
    hl.push(h);
    const t = new THREE.BoxGeometry(0.42, 0.1, 0.04);
    t.translate(sx * 0.5, h2y(0.82), L2 - 0.06);
    tl.push(t);
  }
  const headlights = mergeGeometries(hl)!;
  const taillights = mergeGeometries(tl)!;

  // ----- Rodas -----
  const tire = buildTire(d.wheelRadius, d.wheelWidth, hi ? 28 : 16);
  const rim = buildRim(d.wheelRadius * 0.7, d.wheelWidth * 0.84, hi ? 28 : 16);

  // ----- Spoilers -----
  const spoilers = {
    lip: (() => {
      const g = new THREE.BoxGeometry(1.3, 0.03, 0.12);
      g.translate(0, h2y(0.96), L2 - 0.12);
      return g;
    })(),
    gt: buildWing(h2y, L2, 1.5, 1.04, 0.3, 0.6),
    wing: buildWing(h2y, L2, 1.62, 1.18, 0.34, 0.95),
  };

  // ----- Escapamento -----
  const ex = new THREE.CylinderGeometry(0.045, 0.045, 0.24, 12);
  ex.rotateX(Math.PI / 2);
  ex.translate(0.42, h2y(0.3), L2 + 0.02);
  const ex2 = ex.clone();
  ex2.translate(-0.84, 0, 0);
  const exhaust = mergeGeometries([ex, ex2])!;

  // ----- Interior simplificado -----
  const int: THREE.BufferGeometry[] = [];
  // Painel baixo: o topo fica ~15 cm abaixo dos olhos do motorista para não tapar o horizonte.
  const dash = new THREE.BoxGeometry(1.4, 0.16, 0.4);
  dash.translate(0, h2y(0.84), -0.66);
  int.push(dash);
  const console_ = new THREE.BoxGeometry(0.24, 0.28, 0.9);
  console_.translate(0, h2y(0.62), 0.0);
  int.push(console_);
  for (const sx of [-0.36, 0.36]) {
    const seat = new THREE.BoxGeometry(0.46, 0.14, 0.5);
    seat.translate(sx, h2y(0.52), 0.18);
    const back = new THREE.BoxGeometry(0.46, 0.62, 0.12);
    back.rotateX(-0.18);
    back.translate(sx, h2y(0.86), 0.46);
    int.push(seat, back);
  }
  const floor = new THREE.BoxGeometry(1.5, 0.04, 2.1);
  floor.translate(0, h2y(0.3), 0.45);
  int.push(floor);
  const interior = mergeGeometries(int)!;

  // ----- Volante -----
  const sw: THREE.BufferGeometry[] = [];
  const ring = new THREE.TorusGeometry(0.17, 0.016, 10, 28);
  sw.push(ring);
  const hub = new THREE.CylinderGeometry(0.045, 0.045, 0.03, 14);
  hub.rotateX(Math.PI / 2);
  sw.push(hub);
  for (let i = 0; i < 3; i++) {
    const spoke = new THREE.BoxGeometry(0.17, 0.022, 0.014);
    spoke.translate(0.085, 0, 0);
    spoke.rotateZ((i * 2 * Math.PI) / 3 + Math.PI / 2);
    sw.push(spoke);
  }
  const steeringWheel = mergeGeometries(sw)!;

  return {
    body, roof, glass, trim, flares, headlights, taillights, tire, rim,
    spoilers, exhaust, interior, steeringWheel,
  };
}

function buildWing(
  h2y: (h: number) => number,
  L2: number,
  width: number,
  height: number,
  chord: number,
  tilt: number,
): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const plane = new THREE.BoxGeometry(width, 0.025, chord);
  plane.rotateX(-tilt * 0.35);
  plane.translate(0, h2y(height + 0.18), L2 - 0.2);
  parts.push(plane);
  for (const sx of [-1, 1]) {
    const strut = new THREE.BoxGeometry(0.025, 0.22, 0.1);
    strut.translate(sx * width * 0.32, h2y(height + 0.06), L2 - 0.2);
    parts.push(strut);
    const endplate = new THREE.BoxGeometry(0.02, 0.15, chord + 0.04);
    endplate.translate(sx * (width / 2), h2y(height + 0.17), L2 - 0.2);
    parts.push(endplate);
  }
  return mergeGeometries(parts)!;
}

/** Pneu com ombro arredondado, eixo ao longo de X. */
function buildTire(radius: number, width: number, segs: number): THREE.BufferGeometry {
  const inner = radius * 0.62;
  const hw = width / 2;
  const pts: THREE.Vector2[] = [];
  pts.push(new THREE.Vector2(inner, -hw * 0.82));
  pts.push(new THREE.Vector2(radius * 0.86, -hw));
  pts.push(new THREE.Vector2(radius * 0.97, -hw * 0.92));
  pts.push(new THREE.Vector2(radius, -hw * 0.55));
  pts.push(new THREE.Vector2(radius, hw * 0.55));
  pts.push(new THREE.Vector2(radius * 0.97, hw * 0.92));
  pts.push(new THREE.Vector2(radius * 0.86, hw));
  pts.push(new THREE.Vector2(inner, hw * 0.82));
  const g = new THREE.LatheGeometry(pts, segs);
  g.rotateZ(Math.PI / 2);
  g.computeVertexNormals();
  return g;
}

/** Roda de 5 raios com aro e prato côncavo, eixo ao longo de X. */
function buildRim(radius: number, width: number, segs: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const hw = width / 2;
  // aro
  const barrel = new THREE.LatheGeometry(
    [
      new THREE.Vector2(radius * 0.86, -hw),
      new THREE.Vector2(radius, -hw * 0.9),
      new THREE.Vector2(radius, hw * 0.9),
      new THREE.Vector2(radius * 0.86, hw),
    ],
    segs,
  );
  barrel.rotateZ(Math.PI / 2);
  parts.push(barrel);
  // prato
  const dish = new THREE.CylinderGeometry(radius * 0.9, radius * 0.9, 0.02, segs);
  dish.rotateZ(Math.PI / 2);
  dish.translate(hw * 0.78, 0, 0);
  parts.push(dish);
  // raios (voltados para fora)
  for (let i = 0; i < 5; i++) {
    const sp = new THREE.BoxGeometry(0.035, radius * 0.86, 0.05);
    sp.translate(hw * 0.86, radius * 0.45, 0);
    sp.rotateX((i * 2 * Math.PI) / 5);
    parts.push(sp);
  }
  const hub = new THREE.CylinderGeometry(radius * 0.22, radius * 0.22, 0.05, Math.min(16, segs));
  hub.rotateZ(Math.PI / 2);
  hub.translate(hw * 0.9, 0, 0);
  parts.push(hub);
  return mergeGeometries(parts)!;
}

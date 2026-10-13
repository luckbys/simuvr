import * as THREE from 'three';
import type { PhysicsWorld } from '../physics/world';

/** Texturas de asfalto molhado geradas por canvas: cor e rugosidade (poças). */
export function wetAsphaltTextures(repeat: number): { map: THREE.CanvasTexture; roughnessMap: THREE.CanvasTexture } {
  const S = 512;
  const color = document.createElement('canvas');
  const rough = document.createElement('canvas');
  color.width = color.height = rough.width = rough.height = S;
  const c = color.getContext('2d')!;
  const r = rough.getContext('2d')!;
  c.fillStyle = '#16161c';
  c.fillRect(0, 0, S, S);
  r.fillStyle = '#707070';
  r.fillRect(0, 0, S, S);
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < 5200; i++) {
    const v = 18 + Math.floor(rnd() * 22);
    c.fillStyle = `rgb(${v},${v},${v + 4})`;
    c.fillRect(rnd() * S, rnd() * S, 1 + rnd() * 2, 1 + rnd() * 2);
  }
  // Poças: rugosidade baixa (espelhadas).
  for (let i = 0; i < 5; i++) {
    const x = rnd() * S, y = rnd() * S, rad = 40 + rnd() * 90;
    const g = r.createRadialGradient(x, y, 0, x, y, rad);
    g.addColorStop(0, 'rgb(30,30,30)');
    g.addColorStop(0.7, 'rgb(70,70,70)');
    g.addColorStop(1, 'rgba(112,112,112,0)');
    r.fillStyle = g;
    r.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  const mk = (cv: HTMLCanvasElement, srgb: boolean) => {
    const t = new THREE.CanvasTexture(cv);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat, repeat);
    t.anisotropy = 4;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  return { map: mk(color, true), roughnessMap: mk(rough, false) };
}

/** Cones laranja dinâmicos (corpo = caixa pequena) com um InstancedMesh sincronizado à física. */
export function buildCones(pw: PhysicsWorld, spots: ReadonlyArray<readonly [number, number]>): { mesh: THREE.InstancedMesh; sync: () => void } {
  const coneGeo = new THREE.ConeGeometry(0.17, 0.5, 14);
  coneGeo.translate(0, 0.25, 0);
  const mesh = new THREE.InstancedMesh(
    coneGeo,
    new THREE.MeshStandardMaterial({ color: 0xff6a1a, roughness: 0.5, emissive: 0x401400 }),
    Math.max(1, spots.length),
  );
  const bodies = spots.map(([x, z]) => pw.addDynamicBox([x, 0.25, z], [0.17, 0.25, 0.17], 1.5));
  mesh.count = bodies.length;
  mesh.frustumCulled = false;
  const m4 = new THREE.Matrix4();
  const p = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const one = new THREE.Vector3(1, 1, 1);
  const sync = () => {
    for (let i = 0; i < bodies.length; i++) {
      const b = bodies[i]!;
      const t = b.translation();
      const r = b.rotation();
      // O corpo é uma caixa centrada em y=0.25; o cone tem a base na origem.
      p.set(t.x, t.y - 0.25, t.z);
      q.set(r.x, r.y, r.z, r.w);
      m4.compose(p, q, one);
      mesh.setMatrixAt(i, m4);
    }
    mesh.instanceMatrix.needsUpdate = true;
  };
  sync();
  return { mesh, sync };
}

/** Barris dinâmicos (corpo = caixa; visual = cilindro neon), para derrubar em pilha. */
export function buildBarrels(pw: PhysicsWorld, spots: ReadonlyArray<readonly [number, number, number]>): { mesh: THREE.InstancedMesh; sync: () => void } {
  const geo = new THREE.CylinderGeometry(0.29, 0.29, 0.9, 14);
  const mesh = new THREE.InstancedMesh(
    geo,
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4, metalness: 0.5, emissive: 0x111118 }),
    Math.max(1, spots.length),
  );
  const palette = [0x27e8ff, 0xff2fb3, 0xffb02f, 0x7a5cff];
  const c = new THREE.Color();
  const bodies = spots.map(([x, y, z], i) => {
    mesh.setColorAt(i, c.set(palette[i % palette.length]!));
    return pw.addDynamicBox([x, y, z], [0.28, 0.45, 0.28], 22);
  });
  mesh.count = bodies.length;
  mesh.frustumCulled = false;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  const m4 = new THREE.Matrix4();
  const p = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const one = new THREE.Vector3(1, 1, 1);
  const sync = () => {
    for (let i = 0; i < bodies.length; i++) {
      const t = bodies[i]!.translation();
      const r = bodies[i]!.rotation();
      p.set(t.x, t.y, t.z);
      q.set(r.x, r.y, r.z, r.w);
      m4.compose(p, q, one);
      mesh.setMatrixAt(i, m4);
    }
    mesh.instanceMatrix.needsUpdate = true;
  };
  sync();
  return { mesh, sync };
}

export interface Arena {
  group: THREE.Group;
  /** Atualiza os cones dinâmicos a partir da física. */
  sync(): void;
  spawn: { x: number; z: number; yaw: number };
}

/**
 * Arena de teste do marco 3: lote plano com asfalto molhado, slalom de cones dinâmicos, rampa e
 * paredes. O marco 4 substitui isto pela cidade.
 */
export function buildTestArena(pw: PhysicsWorld, env: THREE.Texture | null): Arena {
  const group = new THREE.Group();
  const SIZE = 220;

  pw.addGround(SIZE, 'wet');
  const tex = wetAsphaltTextures(SIZE / 3);
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(SIZE * 2, SIZE * 2),
    new THREE.MeshStandardMaterial({ map: tex.map, roughnessMap: tex.roughnessMap, roughness: 1, metalness: 0.05, envMap: env, envMapIntensity: 0.8 }),
  );
  ground.rotation.x = -Math.PI / 2;
  group.add(ground);

  // Faixas pintadas: skidpad e pista reta (emissivo fraco para ler no escuro).
  const paint = new THREE.MeshBasicMaterial({ color: 0x9aa4c8, transparent: true, opacity: 0.55 });
  const ring = new THREE.Mesh(new THREE.RingGeometry(29.8, 30.2, 96), paint);
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(60, 0.01, -40);
  group.add(ring);
  for (let i = 0; i < 24; i++) {
    const dash = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 3), paint);
    dash.rotation.x = -Math.PI / 2;
    dash.position.set(0, 0.01, -8 - i * 8);
    group.add(dash);
  }

  // Paredes (colisão + visual neon).
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x1a1830, roughness: 0.6, emissive: 0x2a1060, emissiveIntensity: 0.6 });
  for (const [x, z, hx, hz] of [[0, -SIZE, SIZE, 1], [0, SIZE, SIZE, 1], [-SIZE, 0, 1, SIZE], [SIZE, 0, 1, SIZE]] as const) {
    pw.addBox([x, 2, z], [hx, 2, hz], { surface: 'concrete' });
    const m = new THREE.Mesh(new THREE.BoxGeometry(hx * 2, 4, hz * 2), wallMat);
    m.position.set(x, 2, z);
    group.add(m);
  }

  // Rampa.
  const rampAngle = 0.2;
  pw.addBox([-14, 0.55, -70], [3, 0.08, 8], { pitch: rampAngle, surface: 'concrete' });
  const ramp = new THREE.Mesh(new THREE.BoxGeometry(6, 0.16, 16), new THREE.MeshStandardMaterial({ color: 0x3a3550, roughness: 0.5 }));
  ramp.position.set(-14, 0.55, -70);
  ramp.rotation.x = rampAngle;
  group.add(ramp);

  // Cones dinâmicos: slalom e uma pirâmide.
  const spots: [number, number][] = [];
  for (let i = 0; i < 10; i++) spots.push([(i % 2 ? 3.5 : -3.5) + 22, -20 - i * 12]);
  for (let row = 0; row < 4; row++) for (let k = 0; k <= row; k++) spots.push([-30 + (k - row / 2) * 0.6, -40 - row * 0.5]);
  const { mesh: conesMesh, sync } = buildCones(pw, spots);
  group.add(conesMesh);

  return { group, sync, spawn: { x: 0, z: 0, yaw: 0 } };
}

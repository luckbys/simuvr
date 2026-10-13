import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { PhysicsWorld } from '../physics/world';
import type { CityLayout } from './layout';
import { makeGlowSet } from '../fx/billboard';
import { buildLamps } from './lamps';
import type { Lamp } from './layout';

function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, srgb = true): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Ponto de encontro: piso com vagas, palco com painel de LED, barreiras, refletores e portal de entrada. */
export function buildMeetSpot(pw: PhysicsWorld, city: CityLayout, env: THREE.Texture | null): THREE.Object3D[] {
  const out: THREE.Object3D[] = [];
  const { meet, stage } = city;
  const W = meet.x1 - meet.x0;
  const D = meet.z1 - meet.z0;
  const cx = (meet.x0 + meet.x1) / 2;
  const cz = (meet.z0 + meet.z1) / 2;

  // ---- Piso de concreto com vagas pintadas ----
  const floorTex = canvasTex(2048, 1024, (g) => {
    g.fillStyle = '#25232d';
    g.fillRect(0, 0, 2048, 1024);
    let s = 7;
    const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
    for (let i = 0; i < 9000; i++) {
      const v = 28 + Math.floor(rnd() * 22);
      g.fillStyle = `rgb(${v},${v},${v + 5})`;
      g.fillRect(rnd() * 2048, rnd() * 1024, 2, 2);
    }
    const toX = (x: number) => ((x - meet.x0) / W) * 2048;
    const toZ = (z: number) => ((z - meet.z0) / D) * 1024;
    g.strokeStyle = 'rgba(210,214,235,0.75)';
    g.lineWidth = 5;
    const rowX0 = meet.x0 + 62;
    for (const zRow of [cz - 24, cz + 24]) {
      for (let k = 0; k <= 7; k++) {
        const x = rowX0 - 3.2 + k * 6.4 + (zRow > cz ? 1.5 : 0);
        g.beginPath();
        g.moveTo(toX(x), toZ(zRow - 4.2));
        g.lineTo(toX(x), toZ(zRow + 4.2));
        g.stroke();
      }
    }
    // Círculo de destaque em frente ao palco
    g.strokeStyle = 'rgba(39,232,255,0.55)';
    g.lineWidth = 8;
    g.beginPath();
    g.ellipse(toX(stage.x0 - 22), toZ(cz), 15 * (2048 / W), 15 * (1024 / D), 0, 0, Math.PI * 2);
    g.stroke();
  });
  const floorRough = canvasTex(256, 128, (g) => { g.fillStyle = '#707070'; g.fillRect(0, 0, 256, 128); }, false);
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(W, D),
    new THREE.MeshStandardMaterial({ map: floorTex, roughnessMap: floorRough, roughness: 1, metalness: 0.05, envMap: env, envMapIntensity: 0.8 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(cx, 0.012, cz);
  out.push(floor);
  // Colisor do piso: concreto, ligeiramente acima do asfalto molhado.
  pw.addBox([cx, -0.0, cz], [W / 2, 0.05, D / 2], { surface: 'concrete' });

  // ---- Palco ----
  const sx = (stage.x0 + stage.x1) / 2;
  const sz = (stage.z0 + stage.z1) / 2;
  const sw = stage.x1 - stage.x0;
  const sd = stage.z1 - stage.z0;
  const platform = new THREE.Mesh(
    new THREE.BoxGeometry(sw, 1.1, sd),
    new THREE.MeshStandardMaterial({ color: 0x16141f, roughness: 0.45, metalness: 0.4, envMap: env, envMapIntensity: 0.7 }),
  );
  platform.position.set(sx, 0.55, sz);
  out.push(platform);
  pw.addBox([sx, 0.55, sz], [sw / 2, 0.55, sd / 2], { surface: 'concrete' });

  const ledTex = canvasTex(1024, 512, (g) => {
    const grad = g.createLinearGradient(0, 0, 1024, 512);
    grad.addColorStop(0, '#2a0a5e');
    grad.addColorStop(0.5, '#ff2fb3');
    grad.addColorStop(1, '#27e8ff');
    g.fillStyle = grad;
    g.fillRect(0, 0, 1024, 512);
    g.fillStyle = 'rgba(0,0,0,0.35)';
    for (let i = 0; i < 28; i++) {
      const h = 40 + ((i * 53) % 190);
      g.fillRect(24 + i * 35, 512 - h, 22, h);
    }
    g.textAlign = 'center';
    g.fillStyle = '#ffffff';
    g.shadowColor = '#ffffff';
    g.shadowBlur = 24;
    g.font = '900 96px ui-sans-serif, "Segoe UI", Arial, sans-serif';
    g.fillText('ENCONTRO', 512, 190);
    g.fillText('NOTURNO', 512, 290);
    g.shadowBlur = 0;
    g.font = '700 38px ui-sans-serif, "Segoe UI", Arial, sans-serif';
    g.fillText('SPOT 88  ·  TUNING  ·  DRIFT  ·  SOM', 512, 360);
  });
  const led = new THREE.Mesh(
    new THREE.PlaneGeometry(sd * 0.96, 10),
    new THREE.MeshBasicMaterial({ map: ledTex, toneMapped: false, side: THREE.DoubleSide }),
  );
  led.material.color.setScalar(1.5);
  led.rotation.y = -Math.PI / 2;
  led.position.set(stage.x1 - 0.8, 7.3, sz);
  out.push(led);
  pw.addBox([stage.x1 - 0.8, 6, sz], [0.4, 6, sd / 2], { surface: 'concrete' });

  // Treliça, caixas de som e barras de neon do palco (um mesh só).
  const trussParts: THREE.BufferGeometry[] = [];
  const box = (w: number, h: number, d: number, x: number, y: number, z: number) => {
    const g = new THREE.BoxGeometry(w, h, d);
    g.translate(x, y, z);
    trussParts.push(g);
  };
  box(0.5, 13, 0.5, stage.x1 - 1.4, 7.0, sz - sd / 2 + 0.4);
  box(0.5, 13, 0.5, stage.x1 - 1.4, 7.0, sz + sd / 2 - 0.4);
  box(0.5, 0.6, sd, stage.x1 - 1.4, 13.2, sz);
  for (const k of [-1, 1]) {
    for (let r = 0; r < 3; r++) box(1.4, 2.4, 1.4, stage.x0 + 2.4, 1.1 + 1.2 + r * 2.4, sz + k * (sd / 2 - 1.6));
  }
  const truss = new THREE.Mesh(
    mergeGeometries(trussParts)!,
    new THREE.MeshStandardMaterial({ color: 0x0e0d14, roughness: 0.55, metalness: 0.5 }),
  );
  out.push(truss);

  const neonGeo: THREE.BufferGeometry[] = [];
  const strip = (w: number, d: number, x: number, y: number, z: number) => {
    const g = new THREE.BoxGeometry(w, 0.14, d);
    g.translate(x, y, z);
    neonGeo.push(g);
  };
  strip(sw, 0.14, sx, 1.14, stage.z0);
  strip(sw, 0.14, sx, 1.14, stage.z1);
  strip(0.14, sd, stage.x0, 1.14, sz);
  const neon = new THREE.Mesh(mergeGeometries(neonGeo)!, new THREE.MeshBasicMaterial({ color: new THREE.Color(0x27e8ff).multiplyScalar(3), toneMapped: false }));
  out.push(neon);

  // ---- Barreiras de concreto (norte e sul) com fitas de neon ----
  const barGeo: THREE.BufferGeometry[] = [];
  const stripGeo: THREE.BufferGeometry[] = [];
  const entranceGap = 30; // abertura para os carros entrarem
  for (const z of [meet.z0 + 1.2, meet.z1 - 1.2]) {
    for (let x = meet.x0 + 2; x < meet.x1 - 2; x += 4.2) {
      if (Math.abs(x - (meet.x0 + 22)) < entranceGap / 2 && false) continue;
      const g = new THREE.BoxGeometry(4, 0.9, 0.7);
      g.translate(x, 0.45, z);
      barGeo.push(g);
      const s2 = new THREE.BoxGeometry(3.8, 0.07, 0.72);
      s2.translate(x, 0.82, z);
      stripGeo.push(s2);
    }
    pw.addBox([cx, 0.45, z], [W / 2 - 2, 0.45, 0.35], { surface: 'concrete' });
  }
  out.push(new THREE.Mesh(mergeGeometries(barGeo)!, new THREE.MeshStandardMaterial({ color: 0x2c2a36, roughness: 0.85 })));
  const barNeon = new THREE.Mesh(mergeGeometries(stripGeo)!, new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff2fb3).multiplyScalar(2.6), toneMapped: false }));
  out.push(barNeon);

  // ---- Refletores do pátio (reaproveita o poste da rua) ----
  const lamps: Lamp[] = [];
  for (const fx of [0.18, 0.5, 0.82]) {
    for (const fz of [0.2, 0.8]) {
      lamps.push({ x: meet.x0 + W * fx, z: meet.z0 + D * fz, rotY: fz < 0.5 ? 0 : Math.PI, warm: fx < 0.7 });
    }
  }
  out.push(...buildLamps(lamps));
  for (const l of lamps) pw.addBox([l.x, 4.3, l.z], [0.2, 4.3, 0.2], { surface: 'concrete' });

  // ---- Portal de entrada: "BEM-VINDO AO SPOT" ----
  const gateTex = canvasTex(1024, 256, (g) => {
    g.fillStyle = '#07050f';
    g.fillRect(0, 0, 1024, 256);
    g.strokeStyle = '#27e8ff';
    g.lineWidth = 10;
    g.shadowColor = '#27e8ff';
    g.shadowBlur = 30;
    g.strokeRect(14, 14, 996, 228);
    g.textAlign = 'center';
    g.fillStyle = '#ffffff';
    g.shadowColor = '#ff2fb3';
    g.shadowBlur = 34;
    g.font = '900 108px ui-sans-serif, "Segoe UI", Arial, sans-serif';
    g.fillText('BEM-VINDO AO SPOT', 512, 150);
  });
  const gateZ = meet.z0 + 2;
  const gate = new THREE.Mesh(new THREE.PlaneGeometry(22, 5.5), new THREE.MeshBasicMaterial({ map: gateTex, toneMapped: false, side: THREE.DoubleSide }));
  gate.material.color.setScalar(1.5);
  gate.position.set(meet.x0 + 22, 8.5, gateZ);
  out.push(gate);
  const posts = new THREE.Mesh(
    mergeGeometries([-1, 1].map((k) => { const g = new THREE.BoxGeometry(0.5, 9, 0.5); g.translate(meet.x0 + 22 + k * 11.2, 4.5, gateZ); return g; }))!,
    new THREE.MeshStandardMaterial({ color: 0x0e0d14, roughness: 0.5, metalness: 0.5 }),
  );
  out.push(posts);

  out.push(
    makeGlowSet([
      { x: sx - 3, y: 8, z: sz, size: 30, sizeY: 16, color: 0xff2fb3, intensity: 0.8 },
      { x: meet.x0 + 22, y: 8.5, z: gateZ, size: 28, sizeY: 10, color: 0x27e8ff, intensity: 0.6 },
    ], 0.9),
  );
  return out;
}

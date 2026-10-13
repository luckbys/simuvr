import * as THREE from 'three';
import type { PhysicsWorld } from '../physics/world';
import type { QualitySettings } from '../core/quality';
import { HANABI_200S } from '../physics/carSpec';
import { buildCarGeometries } from '../car/carGeometry';
import { dimsOf } from '../car/carView';
import { InstancedCars } from '../car/instancedCars';
import { DEFAULT_CITY, generateCity, type CityLayout } from './layout';
import { buildBuildings } from './buildings';
import { buildSigns } from './signs';
import { buildLamps } from './lamps';
import { buildRoads, CURB_HEIGHT } from './road';
import { buildMeetSpot } from './meetSpot';
import { buildSky } from './sky';
import { buildBarrels, buildCones } from './testArena';

export interface City {
  group: THREE.Group;
  layout: CityLayout;
  spawn: { x: number; z: number; yaw: number };
  sky: THREE.Group;
  /** Atualiza o que depende do estado da física (cones). */
  sync(): void;
  /** Captura o cubemap real da cidade a partir do ponto de encontro e devolve o ambiente PMREM. */
  captureEnvironment(renderer: THREE.WebGLRenderer, scene: THREE.Scene, size: number): THREE.Texture;
}

export function buildCity(pw: PhysicsWorld, quality: QualitySettings, env: THREE.Texture | null): City {
  const layout = generateCity({ ...DEFAULT_CITY, detail: quality.detail });
  const group = new THREE.Group();
  group.name = 'city';

  for (const o of buildRoads(layout, env)) group.add(o);
  const b = buildBuildings(layout.buildings, env);
  group.add(b.mesh, ...b.extras);
  for (const o of buildSigns(layout.signs)) group.add(o);
  for (const o of buildLamps(layout.lamps)) group.add(o);
  for (const o of buildMeetSpot(pw, layout, env)) group.add(o);

  // Carros parados do encontro (instanciados).
  const geo = buildCarGeometries(dimsOf(HANABI_200S), quality.carLod);
  group.add(new InstancedCars(geo, dimsOf(HANABI_200S), layout.carSlots, env, quality.physicalMaterials).group);

  const sky = buildSky();

  // ---------------- Física estática ----------------
  const ext = layout.extent;
  pw.addGround(ext + 300, 'wet');
  for (const blk of layout.blocks) {
    const cx = (blk.x0 + blk.x1) / 2, cz = (blk.z0 + blk.z1) / 2;
    if (cx > layout.meet.x0 && cx < layout.meet.x1 && cz > layout.meet.z0 && cz < layout.meet.z1) continue;
    pw.addBox([cx, CURB_HEIGHT / 2, cz], [(blk.x1 - blk.x0) / 2, CURB_HEIGHT / 2, (blk.z1 - blk.z0) / 2], { surface: 'concrete' });
  }
  for (const bd of layout.buildings) pw.addBox([bd.x, bd.h / 2, bd.z], [bd.w / 2, bd.h / 2, bd.d / 2], { surface: 'concrete', friction: 0.4 });
  for (const l of layout.lamps) pw.addBox([l.x, 4.3, l.z], [0.14, 4.3, 0.14], { surface: 'concrete' });
  // Carros parados: uma caixa por carro (estática).
  for (const c of layout.carSlots) {
    pw.addBox([c.x, 0.62, c.z], [0.88, 0.55, 2.15], { yaw: c.yaw, surface: 'concrete' });
  }
  // Paredes invisíveis do limite do mapa.
  const wall = ext + 40;
  for (const [x, z, hx, hz] of [[0, -wall, wall, 1], [0, wall, wall, 1], [-wall, 0, 1, wall], [wall, 0, 1, wall]] as const) {
    pw.addBox([x, 4, z], [hx, 4, hz], { surface: 'concrete' });
  }

  // Cones para derrubar, perto do ponto inicial.
  const m = layout.meet;
  const cz = (m.z0 + m.z1) / 2;
  const spots: [number, number][] = [];
  for (let i = 0; i < 8; i++) spots.push([m.x0 + 32 + i * 4, cz - 3.2 + (i % 2 ? 6.4 : 0)]);
  const cones = buildCones(pw, spots);
  group.add(cones.mesh);

  // Barris em pilha (pirâmide de 6) na frente do palco, para derrubar.
  const st = layout.stage;
  const bx = st.x0 - 8;
  const barrelSpots: [number, number, number][] = [];
  for (let row = 0; row < 3; row++) {
    for (let k = 0; k < 3 - row; k++) barrelSpots.push([bx, 0.45 + row * 0.9, cz + 8 + (k + row * 0.5) * 0.62]);
  }
  const barrels = buildBarrels(pw, barrelSpots);
  group.add(barrels.mesh);

  const probe = new THREE.Vector3((m.x0 + m.x1) / 2 - 10, 2.2, cz);

  return {
    group,
    layout,
    spawn: layout.spawn,
    sky,
    sync: () => {
      cones.sync();
      barrels.sync();
    },
    captureEnvironment(renderer, scene, size) {
      const rt = new THREE.WebGLCubeRenderTarget(size, { type: THREE.HalfFloatType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter });
      const cam = new THREE.CubeCamera(0.1, 1400, rt);
      cam.position.copy(probe);
      const prevEnv = scene.environment;
      const wasXr = renderer.xr.enabled;
      renderer.xr.enabled = false;
      scene.environment = null;
      cam.update(renderer, scene);
      scene.environment = prevEnv;
      renderer.xr.enabled = wasXr;
      const pmrem = new THREE.PMREMGenerator(renderer);
      const tex = pmrem.fromCubemap(rt.texture).texture;
      pmrem.dispose();
      rt.dispose();
      return tex;
    },
  };
}

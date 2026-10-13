import { mulberry32, pick, range, type Rng } from './rng';

export interface CityConfig {
  seed: number;
  blocksX: number;
  blocksZ: number;
  blockSize: number;
  roadWidth: number;
  sidewalk: number;
  /** Multiplicador de densidade de letreiros e luzes (qualidade). */
  detail: number;
}

export const DEFAULT_CITY: CityConfig = {
  seed: 1999,
  blocksX: 7,
  blocksZ: 7,
  blockSize: 80,
  roadWidth: 14,
  sidewalk: 3,
  detail: 1,
};

export interface Building {
  x: number;
  z: number;
  w: number;
  d: number;
  h: number;
  /** Semente por prédio (padrão de janelas) e fração de janelas acesas. */
  seed: number;
  lit: number;
  /** Matiz do tom da fachada (0..1) e do brilho das janelas. */
  tint: number;
  /** Tem coroa de neon no topo. */
  crown: boolean;
}

export interface SignSpec {
  x: number;
  y: number;
  z: number;
  /** Rotação em Y: a normal do painel aponta para (sin rot, cos rot) no plano XZ. */
  rotY: number;
  w: number;
  h: number;
  /** Índice da célula do atlas de letreiros. */
  cell: number;
  color: number;
}

export interface Lamp {
  x: number;
  z: number;
  /** Direção do braço da luminária (rad em Y). */
  rotY: number;
  warm: boolean;
}

export interface CarSlot {
  x: number;
  z: number;
  yaw: number;
  paint: string;
  /** Rebaixamento (m) e cambagem (graus, negativo = topo para dentro). */
  drop: number;
  camber: number;
  spoiler: 'none' | 'lip' | 'gt' | 'wing';
  underglow: string;
  rim: string;
}

export interface Rect {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

export interface CityLayout {
  config: CityConfig;
  pitch: number;
  buildings: Building[];
  signs: SignSpec[];
  lamps: Lamp[];
  carSlots: CarSlot[];
  /** Quarteirões (incluindo a calçada) que NÃO são edificados por causa do ponto de encontro. */
  meet: Rect;
  /** Retângulo do palco no ponto de encontro. */
  stage: Rect;
  spawn: { x: number; z: number; yaw: number };
  /** Metade do lado do quadrado ocupado pela cidade. */
  extent: number;
  /** Retângulos de calçada/quarteirão (para piso e colisão). */
  blocks: Rect[];
}

export const SIGN_CELLS = 32;

const PAINTS = ['#e0158a', '#27e8ff', '#ffb02f', '#7a5cff', '#3dff9a', '#f5f5fa', '#ff3b30', '#1d4bff', '#c8ff2f', '#ff7a1a'];
const GLOWS = ['#27e8ff', '#ff2fb3', '#7a5cff', '#3dff9a', '#ffb02f', '#ff3b30', '#ffffff'];
const RIMS = ['#c9ced6', '#ffd24a', '#111111', '#ff2fb3', '#27e8ff', '#e8e8f0'];
const NEON = [0xff2fb3, 0x27e8ff, 0xffb02f, 0x7a5cff, 0x3dff9a, 0xff4a3a];

/** Gera a cidade inteira de forma determinística a partir da configuração. */
export function generateCity(cfg: CityConfig = DEFAULT_CITY): CityLayout {
  const rng = mulberry32(cfg.seed);
  const P = cfg.blockSize + cfg.roadWidth;
  const B = cfg.blockSize;
  const cx0 = -((cfg.blocksX - 1) / 2) * P;
  const cz0 = -((cfg.blocksZ - 1) / 2) * P;
  const extent = (Math.max(cfg.blocksX, cfg.blocksZ) * P) / 2;

  // Ponto de encontro: dois quarteirões vizinhos fundidos (o do centro e o do lado +X) + a rua entre eles.
  const ci = Math.floor(cfg.blocksX / 2);
  const cj = Math.floor(cfg.blocksZ / 2);
  const meetBlocks = new Set([`${ci},${cj}`, `${ci + 1},${cj}`]);
  const centerOf = (i: number, j: number) => ({ x: cx0 + i * P, z: cz0 + j * P });
  const c0 = centerOf(ci, cj);
  const c1 = centerOf(ci + 1, cj);
  const meet: Rect = { x0: c0.x - B / 2, x1: c1.x + B / 2, z0: c0.z - B / 2, z1: c0.z + B / 2 };

  const buildings: Building[] = [];
  const signs: SignSpec[] = [];
  const blocks: Rect[] = [];
  let signCell = 0;

  const maxDist = Math.hypot(cfg.blocksX, cfg.blocksZ) * P * 0.5;
  for (let i = 0; i < cfg.blocksX; i++) {
    for (let j = 0; j < cfg.blocksZ; j++) {
      const c = centerOf(i, j);
      blocks.push({ x0: c.x - B / 2, x1: c.x + B / 2, z0: c.z - B / 2, z1: c.z + B / 2 });
      if (meetBlocks.has(`${i},${j}`)) continue;

      const inner = B - 2 * cfg.sidewalk;
      const cols = 1 + Math.floor(rng() * 3);
      const rows = 1 + Math.floor(rng() * 3);
      const colW = splitSizes(rng, cols, inner, 18);
      const rowD = splitSizes(rng, rows, inner, 18);
      const dist = Math.hypot(c.x, c.z) / maxDist;

      let ox = c.x - inner / 2;
      for (let a = 0; a < cols; a++) {
        let oz = c.z - inner / 2;
        for (let b = 0; b < rows; b++) {
          const w = colW[a]! - 1.5;
          const d = rowD[b]! - 1.5;
          const lx = ox + colW[a]! / 2;
          const lz = oz + rowD[b]! / 2;
          const base = 78 - 58 * Math.min(1, dist * 1.25);
          const h = Math.max(9, base * range(rng, 0.45, 1.25));
          buildings.push({
            x: lx, z: lz, w, d, h,
            seed: Math.floor(rng() * 1e6),
            lit: range(rng, 0.25, 0.7),
            tint: rng(),
            crown: h > 38 && rng() < 0.55,
          });

          // Letreiros nas fachadas voltadas para a rua (lotes da borda do quarteirão).
          const edges: Array<{ nx: number; nz: number; rot: number; len: number; px: number; pz: number }> = [];
          if (a === 0) edges.push({ nx: -1, nz: 0, rot: -Math.PI / 2, len: d, px: lx - w / 2, pz: lz });
          if (a === cols - 1) edges.push({ nx: 1, nz: 0, rot: Math.PI / 2, len: d, px: lx + w / 2, pz: lz });
          if (b === 0) edges.push({ nx: 0, nz: -1, rot: Math.PI, len: w, px: lx, pz: lz - d / 2 });
          if (b === rows - 1) edges.push({ nx: 0, nz: 1, rot: 0, len: w, px: lx, pz: lz + d / 2 });
          for (const e of edges) {
            const count = Math.round(range(rng, 0.8, 2.4) * cfg.detail);
            for (let s = 0; s < count; s++) {
              const sw = range(rng, 4, Math.min(8, e.len * 0.7));
              const sh = sw * range(rng, 0.22, 0.4);
              const along = range(rng, -e.len / 2 + sw / 2 + 1, e.len / 2 - sw / 2 - 1);
              const y = range(rng, 4.5, Math.min(10, h - 2));
              const tx = e.nz !== 0 ? 1 : 0;
              const tz = e.nx !== 0 ? 1 : 0;
              signs.push({
                x: e.px + tx * along + e.nx * 0.2,
                y,
                z: e.pz + tz * along + e.nz * 0.2,
                rotY: e.rot,
                w: sw,
                h: sh,
                cell: signCell++ % SIGN_CELLS,
                color: pick(rng, NEON),
              });
            }
          }
          oz += rowD[b]!;
        }
        ox += colW[a]!;
      }
    }
  }

  // Postes de luz ao longo das ruas, alternando os lados.
  const lamps: Lamp[] = [];
  const spacing = 34 / Math.max(0.6, cfg.detail);
  const curb = cfg.roadWidth / 2 + 1.2;
  // Ruas que correm em X (entre fileiras de quarteirões, mais as bordas externas)
  for (let j = -1; j < cfg.blocksZ; j++) {
    const zc = cz0 + j * P + P / 2;
    let side = 1;
    for (let x = cx0 - P / 2; x <= cx0 + (cfg.blocksX - 1) * P + P / 2; x += spacing) {
      if (inIntersection(x, cx0, P, cfg.blocksX, cfg.roadWidth)) continue;
      const lx = x, lz = zc + side * curb;
      if (insideRect(lx, lz, meet, 0)) continue;
      lamps.push({ x: lx, z: lz, rotY: side > 0 ? Math.PI : 0, warm: rng() < 0.8 });
      side = -side;
    }
  }
  for (let i = -1; i < cfg.blocksX; i++) {
    const xc = cx0 + i * P + P / 2;
    let side = 1;
    for (let z = cz0 - P / 2; z <= cz0 + (cfg.blocksZ - 1) * P + P / 2; z += spacing) {
      if (inIntersection(z, cz0, P, cfg.blocksZ, cfg.roadWidth)) continue;
      const lx = xc + side * curb, lz = z;
      if (insideRect(lx, lz, meet, 0)) continue;
      lamps.push({ x: lx, z: lz, rotY: side > 0 ? -Math.PI / 2 : Math.PI / 2, warm: rng() < 0.8 });
      side = -side;
    }
  }

  // Palco no extremo leste do encontro.
  const stage: Rect = { x0: meet.x1 - 16, x1: meet.x1 - 3, z0: (meet.z0 + meet.z1) / 2 - 12, z1: (meet.z0 + meet.z1) / 2 + 12 };

  // Vagas: duas fileiras inclinadas e alguns carros "de destaque" na frente do palco.
  const carSlots: CarSlot[] = [];
  const mkCar = (x: number, z: number, yaw: number): CarSlot => ({
    x, z, yaw,
    paint: pick(rng, PAINTS),
    drop: range(rng, 0.0, 0.07),
    camber: -Math.round(range(rng, 0, 7)),
    spoiler: pick(rng, ['none', 'lip', 'gt', 'wing', 'gt'] as const),
    underglow: pick(rng, GLOWS),
    rim: pick(rng, RIMS),
  });
  const midZ = (meet.z0 + meet.z1) / 2;
  const rowX0 = meet.x0 + 62;
  for (let k = 0; k < 7; k++) {
    const x = rowX0 + k * 6.4;
    carSlots.push(mkCar(x, midZ - 24, Math.PI + range(rng, -0.35, 0.35)));
    carSlots.push(mkCar(x + 1.5, midZ + 24, range(rng, -0.35, 0.35)));
  }
  for (let k = 0; k < 4; k++) {
    carSlots.push(mkCar(stage.x0 - 18 - (k % 2) * 7, midZ - 9 + k * 6, -Math.PI / 2 + range(rng, -0.5, 0.5)));
  }

  // Posição inicial: livre, à oeste do encontro, de frente para as vagas.
  const spawn = { x: meet.x0 + 22, z: midZ + 4, yaw: -Math.PI / 2 };

  return { config: cfg, pitch: P, buildings, signs, lamps, carSlots, meet, stage, spawn, extent, blocks };
}

function splitSizes(rng: Rng, n: number, total: number, min: number): number[] {
  const parts = Array.from({ length: n }, () => range(rng, 1, 2));
  const sum = parts.reduce((a, b) => a + b, 0);
  let sizes = parts.map((p) => (p / sum) * total);
  // Garante o tamanho mínimo redistribuindo o excesso.
  for (let it = 0; it < 4; it++) {
    const small = sizes.filter((s) => s < min).length;
    if (!small) break;
    sizes = Array.from({ length: n }, () => total / n);
  }
  return sizes;
}

function inIntersection(t: number, c0: number, P: number, n: number, road: number): boolean {
  // `t` está dentro de uma rua transversal?
  const rel = (t - (c0 - P / 2)) / P;
  const frac = rel - Math.floor(rel);
  const k = Math.floor(rel);
  if (k < 0 || k > n) return false;
  return frac < road / 2 / P || frac > 1 - road / 2 / P;
}

export function insideRect(x: number, z: number, r: Rect, pad = 0): boolean {
  return x > r.x0 - pad && x < r.x1 + pad && z > r.z0 - pad && z < r.z1 + pad;
}

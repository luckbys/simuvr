import * as THREE from 'three';
import { SIGN_CELLS, type SignSpec } from './layout';
import { makeGlowSet } from '../fx/billboard';

const TEXTS: ReadonlyArray<readonly [string, string]> = [
  ['OFICINA DO ZÉ', '#27e8ff'], ['TURBO SHOP', '#ff2fb3'], ['DRIFT KING', '#ffb02f'], ['RAMEN 24H', '#ff4a3a'],
  ['KARAOKÊ', '#7a5cff'], ['PNEUS & RODAS', '#3dff9a'], ['LAVA JATO', '#27e8ff'], ['AUTO PEÇAS', '#ffb02f'],
  ['GARAGEM 88', '#ff2fb3'], ['BAR DO CHOPP', '#ffb02f'], ['LAN HOUSE', '#7a5cff'], ['SUSHI', '#ff4a3a'],
  ['MOTO CLUBE', '#27e8ff'], ['TATUAGEM', '#ff2fb3'], ['FARMÁCIA', '#3dff9a'], ['LANCHES', '#ffb02f'],
  ['NEON CAFÉ', '#27e8ff'], ['VIDEOLOCADORA', '#ff2fb3'], ['ESTÉTICA AUTO', '#7a5cff'], ['NITRO', '#ff4a3a'],
  ['SPORT TUNING', '#27e8ff'], ['PIZZARIA', '#ffb02f'], ['HOTEL ★★★', '#ff2fb3'], ['DJ NIGHT', '#7a5cff'],
  ['ADESIVOS', '#3dff9a'], ['REBAIXADOS', '#ff2fb3'], ['MECÂNICA', '#ffb02f'], ['SOM AUTOMOTIVO', '#27e8ff'],
  ['ACADEMIA', '#ff4a3a'], ['PASTELARIA', '#ffb02f'], ['ARCADE', '#7a5cff'], ['TURBO 200', '#3dff9a'],
];

const COLS = 4;
const ROWS = SIGN_CELLS / COLS;

/** Atlas 2048×1024 com letreiros neon. Cada célula tem 512×128. */
export function makeSignAtlas(): THREE.CanvasTexture {
  const W = 2048, H = 1024;
  const cw = W / COLS, ch = H / ROWS;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  g.fillStyle = '#05040c';
  g.fillRect(0, 0, W, H);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  for (let i = 0; i < SIGN_CELLS; i++) {
    const [text, color] = TEXTS[i % TEXTS.length]!;
    const x = (i % COLS) * cw;
    const y = Math.floor(i / COLS) * ch;
    g.save();
    g.translate(x, y);
    // painel e moldura de neon
    g.fillStyle = '#0a0814';
    g.fillRect(6, 6, cw - 12, ch - 12);
    g.strokeStyle = color;
    g.lineWidth = 5;
    g.shadowColor = color;
    g.shadowBlur = 16;
    g.strokeRect(12, 12, cw - 24, ch - 24);
    // texto
    let size = 64;
    g.font = `800 ${size}px ui-sans-serif, "Segoe UI", Roboto, Arial, sans-serif`;
    while (g.measureText(text).width > cw - 60 && size > 20) {
      size -= 4;
      g.font = `800 ${size}px ui-sans-serif, "Segoe UI", Roboto, Arial, sans-serif`;
    }
    g.shadowBlur = 22;
    g.fillStyle = color;
    g.fillText(text, cw / 2, ch / 2 + 3);
    g.shadowBlur = 0;
    g.fillStyle = '#ffffff';
    g.globalAlpha = 0.85;
    g.fillText(text, cw / 2, ch / 2 + 3);
    g.restore();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.generateMipmaps = true;
  return tex;
}

export function buildSigns(signs: SignSpec[]): THREE.Object3D[] {
  const atlas = makeSignAtlas();
  const mat = new THREE.MeshBasicMaterial({ map: atlas, toneMapped: true });
  mat.color.setScalar(1.7);
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aUv;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\n#ifdef USE_MAP\n vMapUv = uv * aUv.zw + aUv.xy;\n#endif');
  };

  const quad = new THREE.PlaneGeometry(1, 1);
  const uvs = new Float32Array(Math.max(1, signs.length) * 4);
  const mesh = new THREE.InstancedMesh(quad, mat, Math.max(1, signs.length));
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const p = new THREE.Vector3();
  const s = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  signs.forEach((sg, i) => {
    q.setFromAxisAngle(up, sg.rotY);
    p.set(sg.x, sg.y, sg.z);
    s.set(sg.w, sg.h, 1);
    m.compose(p, q, s);
    mesh.setMatrixAt(i, m);
    const col = sg.cell % COLS;
    const row = Math.floor(sg.cell / COLS);
    uvs[i * 4] = col / COLS;
    uvs[i * 4 + 1] = 1 - (row + 1) / ROWS;
    uvs[i * 4 + 2] = 1 / COLS;
    uvs[i * 4 + 3] = 1 / ROWS;
  });
  quad.setAttribute('aUv', new THREE.InstancedBufferAttribute(uvs, 4));
  mesh.count = signs.length;
  mesh.frustumCulled = false;

  // Halos coloridos atrás dos letreiros (bloom falso), levemente à frente da fachada.
  const glows = signs.map((sg) => ({
    x: sg.x + Math.sin(sg.rotY) * 0.5,
    y: sg.y,
    z: sg.z + Math.cos(sg.rotY) * 0.5,
    size: sg.w * 1.9,
    sizeY: sg.h * 3.2,
    color: sg.color,
    intensity: 0.5,
  }));
  return [mesh, makeGlowSet(glows, 0.85)];
}

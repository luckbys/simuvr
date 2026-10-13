import * as THREE from 'three';
import { makeGlowSet } from '../fx/billboard';
import { mulberry32 } from './rng';

/** Céu noturno: degradê, estrelas, lua e silhueta de uma metrópole distante. Segue a câmera. */
export function buildSky(): THREE.Group {
  const g = new THREE.Group();

  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(850, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
      fragmentShader: `varying vec3 vP;
        void main(){
          float h = normalize(vP).y;
          vec3 horizon = vec3(0.26, 0.09, 0.30);
          vec3 mid = vec3(0.05, 0.03, 0.14);
          vec3 zenith = vec3(0.012, 0.014, 0.05);
          vec3 c = h > 0.0 ? mix(horizon, mix(mid, zenith, smoothstep(0.15, 0.85, h)), smoothstep(0.0, 0.3, h)) : horizon * 0.45;
          gl_FragColor = vec4(c, 1.0);
        }`,
    }),
  );
  dome.renderOrder = -10;
  g.add(dome);

  // Estrelas
  const rnd = mulberry32(99);
  const N = 650;
  const pos = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    const y = 0.12 + rnd() * 0.88;
    const a = rnd() * Math.PI * 2;
    const r = Math.sqrt(1 - y * y);
    pos.set([Math.cos(a) * r * 800, y * 800, Math.sin(a) * r * 800], i * 3);
  }
  const sg = new THREE.BufferGeometry();
  sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xcfd8ff, size: 1.6, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.8, depthWrite: false }));
  stars.renderOrder = -9;
  g.add(stars);

  // Lua: disco + halo
  const moonDir = new THREE.Vector3(-0.5, 0.42, -0.75).normalize().multiplyScalar(780);
  const disc = new THREE.Mesh(new THREE.CircleGeometry(20, 32), new THREE.MeshBasicMaterial({ color: 0xe8ecff, fog: false, depthWrite: false, toneMapped: false }));
  disc.position.copy(moonDir);
  disc.lookAt(0, 0, 0);
  disc.renderOrder = -8;
  g.add(disc);
  const halo = makeGlowSet([{ x: moonDir.x * 0.99, y: moonDir.y * 0.99, z: moonDir.z * 0.99, size: 260, color: 0x8fa6ff, intensity: 0.6 }], 0.8);
  halo.renderOrder = -8;
  g.add(halo);

  // Silhueta da metrópole distante, anel de textura repetida com janelas acesas.
  const W = 2048, H = 256;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const x = c.getContext('2d')!;
  const r2 = mulberry32(31);
  x.clearRect(0, 0, W, H);
  let px = 0;
  while (px < W) {
    const bw = 18 + r2() * 60;
    const bh = 30 + Math.pow(r2(), 1.6) * 190;
    x.fillStyle = '#0b0818';
    x.fillRect(px, H - bh, bw, bh);
    for (let wy = H - bh + 6; wy < H - 4; wy += 9) {
      for (let wx = px + 4; wx < px + bw - 4; wx += 7) {
        if (r2() < 0.28) {
          x.fillStyle = r2() < 0.8 ? 'rgba(255,190,110,0.85)' : 'rgba(150,220,255,0.85)';
          x.fillRect(wx, wy, 3, 4);
        }
      }
    }
    if (bh > 150 && r2() < 0.5) {
      x.fillStyle = '#ff2fb3';
      x.fillRect(px, H - bh - 3, bw, 3);
    }
    px += bw + r2() * 6;
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.repeat.set(2, 1);
  const ring = new THREE.Mesh(
    new THREE.CylinderGeometry(690, 690, 150, 48, 1, true),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.BackSide, fog: false, depthWrite: false }),
  );
  ring.position.y = 55;
  ring.renderOrder = -7;
  g.add(ring);

  g.frustumCulled = false;
  return g;
}

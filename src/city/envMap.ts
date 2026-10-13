import * as THREE from 'three';

/**
 * Ambiente noturno procedural para reflexos (verniz, asfalto molhado). Gera um cubemap PMREM uma
 * única vez: céu escuro em degradê, faixas de neon e algumas "janelas" luminosas ao redor.
 * O marco da cidade pode substituir isto por uma captura real da cena.
 */
export function makeNightEnvironment(renderer: THREE.WebGLRenderer, size = 256): THREE.Texture {
  const scene = new THREE.Scene();

  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(50, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {},
      vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
      fragmentShader: `varying vec3 vP;
        void main(){
          float h = normalize(vP).y;
          vec3 horizon = vec3(0.30, 0.10, 0.34);
          vec3 zenith = vec3(0.01, 0.015, 0.05);
          vec3 ground = vec3(0.015, 0.012, 0.03);
          vec3 c = h > 0.0 ? mix(horizon, zenith, pow(h, 0.55)) : mix(horizon * 0.35, ground, clamp(-h * 3.0, 0.0, 1.0));
          gl_FragColor = vec4(c, 1.0);
        }`,
    }),
  );
  scene.add(sky);

  const neon = [0xff2fb3, 0x27e8ff, 0xffb02f, 0x7a5cff, 0x3dff9a];
  const rnd = mulberry(7);
  for (let i = 0; i < 46; i++) {
    const a = rnd() * Math.PI * 2;
    const r = 30 + rnd() * 10;
    const y = -2 + rnd() * 22;
    const w = 2 + rnd() * 10;
    const h = 0.3 + rnd() * 1.4;
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, 0.4),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(neon[Math.floor(rnd() * neon.length)]!).multiplyScalar(2.2) }),
    );
    m.position.set(Math.cos(a) * r, y, Math.sin(a) * r);
    m.lookAt(0, y, 0);
    scene.add(m);
  }
  // "Postes" altos de luz quente
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2 + 0.3;
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.9, 8, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffc477).multiplyScalar(4) }));
    m.position.set(Math.cos(a) * 26, 9 + (i % 3) * 2, Math.sin(a) * 26);
    scene.add(m);
  }

  const pmrem = new THREE.PMREMGenerator(renderer);
  const rt = pmrem.fromScene(scene, 0.02, 0.1, 100, { size });
  pmrem.dispose();
  scene.traverse((o) => {
    const m = o as THREE.Mesh;
    m.geometry?.dispose();
    (m.material as THREE.Material | undefined)?.dispose();
  });
  return rt.texture;
}

function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

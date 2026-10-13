import * as THREE from 'three';

/**
 * Chuva: riscos animados inteiramente no vertex shader, num volume que acompanha a câmera.
 * Um draw call, zero custo de CPU por gota.
 */
export class Rain {
  readonly mesh: THREE.LineSegments;
  private readonly uniforms = {
    uTime: { value: 0 },
    uCenter: { value: new THREE.Vector3() },
    uSize: { value: new THREE.Vector3(26, 18, 26) },
    uAlpha: { value: 0.32 },
  };

  constructor(count = 1800) {
    const pos = new Float32Array(count * 2 * 3);
    const seed = new Float32Array(count * 2 * 3);
    const tip = new Float32Array(count * 2);
    let s = 1;
    const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < count; i++) {
      const a = r(), b = r(), c = r();
      for (let k = 0; k < 2; k++) {
        const o = (i * 2 + k) * 3;
        seed[o] = a; seed[o + 1] = b; seed[o + 2] = c;
        tip[i * 2 + k] = k;
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 3));
    g.setAttribute('aTip', new THREE.BufferAttribute(tip, 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
    this.mesh = new THREE.LineSegments(
      g,
      new THREE.ShaderMaterial({
        uniforms: this.uniforms,
        transparent: true,
        depthWrite: false,
        fog: false,
        vertexShader: `
          attribute vec3 aSeed; attribute float aTip;
          uniform float uTime; uniform vec3 uCenter; uniform vec3 uSize;
          varying float vA;
          void main() {
            float speed = 11.0 + aSeed.z * 5.0;
            float y = mod(aSeed.y * uSize.y - uTime * speed, uSize.y);
            vec3 p = uCenter + vec3((aSeed.x - 0.5) * uSize.x, y - uSize.y * 0.35, (aSeed.z - 0.5) * uSize.z);
            p += vec3(0.12, 0.0, 0.05) * aTip;           // vento inclina o rastro
            p.y += aTip * 0.55;                           // comprimento do risco
            vA = (1.0 - aTip * 0.7) * smoothstep(0.0, 2.0, y) * smoothstep(uSize.y, uSize.y - 3.0, y);
            gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
          }`,
        fragmentShader: `
          uniform float uAlpha; varying float vA;
          void main() { gl_FragColor = vec4(0.62, 0.72, 1.0, vA * uAlpha); }`,
      }),
    );
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 6;
  }

  update(time: number, center: THREE.Vector3): void {
    this.uniforms.uTime.value = time;
    this.uniforms.uCenter.value.copy(center);
  }
}

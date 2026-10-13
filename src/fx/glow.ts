import * as THREE from 'three';

let radial: THREE.CanvasTexture | null = null;

/** Textura de brilho radial (branco no centro → transparente), para "bloom" falso aditivo. */
export function radialGlowTexture(): THREE.CanvasTexture {
  if (radial) return radial;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  grad.addColorStop(0.6, 'rgba(255,255,255,0.12)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  radial = new THREE.CanvasTexture(c);
  radial.colorSpace = THREE.SRGBColorSpace;
  return radial;
}

/** Material aditivo, sem escrita de profundidade: base de halos, poças de luz e neon inferior. */
export function additiveMaterial(color: THREE.ColorRepresentation, opacity = 1): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    map: radialGlowTexture(),
    color,
    transparent: true,
    opacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    fog: false,
  });
}

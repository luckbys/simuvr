import * as THREE from 'three';
import { radialGlowTexture } from './glow';

/**
 * Halo aditivo voltado para a câmera, instanciado: a escala (x, y) de cada instância define o
 * tamanho em metros e `instanceColor` a cor. É o "bloom" falso de neon, lâmpadas e faróis:
 * o pós-processamento de bloom não funciona no caminho WebXR, e isto custa 1 draw call.
 */
export function makeGlowMaterial(opacity = 1): THREE.MeshBasicMaterial {
  const mat = new THREE.MeshBasicMaterial({
    map: radialGlowTexture(),
    transparent: true,
    opacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    fog: false,
    toneMapped: false,
  });
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace(
      '#include <project_vertex>',
      `
      vec4 mvPosition = vec4( 0.0, 0.0, 0.0, 1.0 );
      #ifdef USE_INSTANCING
        vec3 isc = vec3( length( instanceMatrix[0].xyz ), length( instanceMatrix[1].xyz ), 1.0 );
        mvPosition = modelViewMatrix * instanceMatrix * vec4( 0.0, 0.0, 0.0, 1.0 );
        mvPosition.xy += position.xy * isc.xy;
      #else
        mvPosition = modelViewMatrix * vec4( transformed, 1.0 );
      #endif
      gl_Position = projectionMatrix * mvPosition;
      `,
    );
  };
  return mat;
}

/** Quadrado unitário para halos instanciados. */
export function glowQuad(): THREE.PlaneGeometry {
  return new THREE.PlaneGeometry(1, 1);
}

/** Cria um InstancedMesh de halos a partir de (x, y, z, tamanho, cor). */
export function makeGlowSet(
  items: ReadonlyArray<{ x: number; y: number; z: number; size: number; sizeY?: number; color: THREE.ColorRepresentation; intensity?: number }>,
  opacity = 1,
): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(glowQuad(), makeGlowMaterial(opacity), Math.max(1, items.length));
  const m = new THREE.Matrix4();
  const c = new THREE.Color();
  items.forEach((it, i) => {
    m.makeScale(it.size, it.sizeY ?? it.size, 1).setPosition(it.x, it.y, it.z);
    mesh.setMatrixAt(i, m);
    mesh.setColorAt(i, c.set(it.color).multiplyScalar(it.intensity ?? 1));
  });
  mesh.count = items.length;
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.frustumCulled = false;
  mesh.renderOrder = 3;
  return mesh;
}

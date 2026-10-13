import * as THREE from 'three';
import type { Building } from './layout';
import { makeGlowSet } from '../fx/billboard';
import { mulberry32 } from './rng';

/**
 * Prédios instanciados com janelas acesas desenhadas no shader: a grade de janelas sai da posição
 * no mundo, então não há textura e cada instância continua custando só uma matriz.
 */
export function makeBuildingMaterial(env: THREE.Texture | null): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7, metalness: 0.1, envMap: env, envMapIntensity: 0.6 });
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        attribute vec4 aBld;
        varying vec4 vBld;
        varying vec3 vWP;
        varying vec3 vWN;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vBld = aBld;
        vec4 wpos = vec4( transformed, 1.0 );
        vec3 wn = objectNormal;
        #ifdef USE_INSTANCING
          wpos = instanceMatrix * wpos;
          wn = mat3( instanceMatrix ) * wn;
        #endif
        vWP = ( modelMatrix * wpos ).xyz;
        vWN = normalize( mat3( modelMatrix ) * wn );`,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec4 vBld;
        varying vec3 vWP;
        varying vec3 vWN;
        float hash21( vec2 p ) { p = fract( p * vec2( 123.34, 456.21 ) ); p += dot( p, p + 45.32 ); return fract( p.x * p.y ); }
        float winMask = 0.0;
        vec3 winColor = vec3( 0.0 );`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        {
          vec3 n = normalize( vWN );
          float vertical = step( abs( n.y ), 0.5 );
          vec2 fc = abs( n.x ) > abs( n.z ) ? vWP.zy : vWP.xy;
          vec2 cell = vec2( 3.4, 3.9 );
          vec2 uvc = fc / cell;
          vec2 id = floor( uvc );
          vec2 f = fract( uvc );
          // Janela com bordas suavizadas pela largura do pixel (antialiasing sem MSAA no shader).
          vec2 fw = fwidth( uvc ) + 1e-4;
          float ax = smoothstep( 0.2 - fw.x, 0.2 + fw.x, f.x ) * ( 1.0 - smoothstep( 0.8 - fw.x, 0.8 + fw.x, f.x ) );
          float ay = smoothstep( 0.24 - fw.y, 0.24 + fw.y, f.y ) * ( 1.0 - smoothstep( 0.78 - fw.y, 0.78 + fw.y, f.y ) );
          float inWin = ax * ay;
          float above = smoothstep( 4.0, 4.4, vWP.y ); // térreo é loja/letreiro
          float h = hash21( id + vBld.x );
          float lit = step( h, vBld.y );
          float hc = hash21( id * 1.7 + vBld.x * 3.1 );
          vec3 wc = hc < 0.72 ? vec3( 1.0, 0.7, 0.34 ) : ( hc < 0.9 ? vec3( 0.66, 0.82, 1.0 ) : ( hc < 0.95 ? vec3( 1.0, 0.28, 0.66 ) : vec3( 0.28, 1.0, 0.82 ) ) );
          // À distância (célula menor que ~2 px) as janelas viram o brilho médio: some o chiado.
          float farF = smoothstep( 0.12, 0.4, max( fw.x, fw.y ) );
          float areaMean = 0.6 * 0.54;
          vec3 avg = vec3( 1.0, 0.72, 0.42 ) * vBld.y * areaMean;
          winMask = mix( inWin, areaMean, farF ) * vertical * above;
          winColor = mix( wc * lit * inWin, avg, farF ) * vertical * above * 1.25;
          diffuseColor.rgb = mix( diffuseColor.rgb, diffuseColor.rgb * 0.35, winMask );
        }`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        roughnessFactor = mix( roughnessFactor, 0.18, winMask );`,
      )
      .replace(
        '#include <metalnessmap_fragment>',
        `#include <metalnessmap_fragment>
        metalnessFactor = mix( metalnessFactor, 0.7, winMask );`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        totalEmissiveRadiance += winColor;`,
      );
  };
  return mat;
}

export interface BuildingMeshes {
  mesh: THREE.InstancedMesh;
  /** Coroas de neon e seus halos. */
  extras: THREE.Object3D[];
}

export function buildBuildings(buildings: Building[], env: THREE.Texture | null): BuildingMeshes {
  const unit = new THREE.BoxGeometry(1, 1, 1);
  unit.translate(0, 0.5, 0);

  // Cada prédio vira 1 instância; os altos ganham um segundo volume recuado no topo.
  type Inst = { x: number; z: number; y: number; w: number; d: number; h: number; seed: number; lit: number; tint: number };
  const insts: Inst[] = [];
  const rnd = mulberry32(4242);
  for (const b of buildings) {
    insts.push({ x: b.x, z: b.z, y: 0, w: b.w, d: b.d, h: b.h, seed: b.seed, lit: b.lit, tint: b.tint });
    if (b.h > 34) {
      const f = 0.55 + rnd() * 0.2;
      const th = b.h * (0.12 + rnd() * 0.1);
      insts.push({ x: b.x, z: b.z, y: b.h, w: b.w * f, d: b.d * f, h: th, seed: b.seed + 7, lit: b.lit, tint: b.tint });
    }
  }

  const mat = makeBuildingMaterial(env);
  const mesh = new THREE.InstancedMesh(unit, mat, insts.length);
  const attr = new Float32Array(insts.length * 4);
  const m = new THREE.Matrix4();
  const c = new THREE.Color();
  insts.forEach((it, i) => {
    m.makeScale(it.w, it.h, it.d).setPosition(it.x, it.y, it.z);
    mesh.setMatrixAt(i, m);
    // Fachadas escuras e dessaturadas, com variação de matiz por prédio.
    c.setHSL(0.58 + 0.2 * it.tint, 0.22, 0.09 + 0.07 * ((it.seed % 7) / 7));
    mesh.setColorAt(i, c);
    attr[i * 4] = (it.seed % 1000) / 10;
    attr[i * 4 + 1] = it.lit;
    attr[i * 4 + 2] = it.tint;
    attr[i * 4 + 3] = 0;
  });
  unit.setAttribute('aBld', new THREE.InstancedBufferAttribute(attr, 4));
  mesh.frustumCulled = false;

  // Coroas de neon: tira fina emissiva no topo dos prédios altos + halo.
  const crowns = buildings.filter((b) => b.crown);
  const extras: THREE.Object3D[] = [];
  if (crowns.length) {
    const palette = [0xff2fb3, 0x27e8ff, 0xffb02f, 0x7a5cff];
    const strip = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }),
      crowns.length,
    );
    const glows: Array<{ x: number; y: number; z: number; size: number; sizeY: number; color: number; intensity: number }> = [];
    crowns.forEach((b, i) => {
      const col = palette[(b.seed >> 3) % palette.length]!;
      m.makeScale(b.w * 0.98, 0.5, b.d * 0.98).setPosition(b.x, b.h * (b.h > 34 ? 1.0 : 1) + 0.25, b.z);
      strip.setMatrixAt(i, m);
      strip.setColorAt(i, c.set(col).multiplyScalar(3));
      glows.push({ x: b.x, y: b.h + 2, z: b.z, size: Math.max(b.w, b.d) * 1.7, sizeY: 14, color: col, intensity: 0.55 });
    });
    strip.frustumCulled = false;
    extras.push(strip, makeGlowSet(glows, 0.9));
  }
  return { mesh, extras };
}

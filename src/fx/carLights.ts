import * as THREE from 'three';
import { makeGlowSet } from './billboard';
import { additiveMaterial } from './glow';
import type { CarView } from '../car/carView';

/** Halos dos faróis e lanternas (brilho extra ao frear) e a mancha de luz no chão à frente do carro. */
export class CarLights {
  private readonly halos: THREE.InstancedMesh;
  private readonly pool: THREE.Mesh;
  private readonly c = new THREE.Color();
  private lastBrake = -1;

  constructor(private readonly car: CarView, length: number, comHeight: number) {
    const L2 = length / 2;
    const y = (h: number) => h - comHeight;
    this.halos = makeGlowSet(
      [
        { x: -0.52, y: y(0.62), z: -L2 - 0.1, size: 1.1, color: 0xfff2d8, intensity: 0.9 },
        { x: 0.52, y: y(0.62), z: -L2 - 0.1, size: 1.1, color: 0xfff2d8, intensity: 0.9 },
        { x: -0.5, y: y(0.82), z: L2 + 0.1, size: 0.9, color: 0xff1020, intensity: 0.5 },
        { x: 0.5, y: y(0.82), z: L2 + 0.1, size: 0.9, color: 0xff1020, intensity: 0.5 },
      ],
      1,
    );
    car.root.add(this.halos);

    // Mancha de luz dos faróis no asfalto (aditiva, achatada), presa ao carro.
    this.pool = new THREE.Mesh(new THREE.PlaneGeometry(7, 15), additiveMaterial(0xfff0d0, 0.14));
    this.pool.rotation.x = -Math.PI / 2;
    this.pool.position.set(0, y(0.03), -L2 - 6.5);
    this.pool.renderOrder = 2;
    car.root.add(this.pool);
  }

  update(braking: boolean, groundY: number): void {
    const b = braking ? 1 : 0;
    if (b !== this.lastBrake) {
      this.lastBrake = b;
      for (const i of [2, 3]) this.halos.setColorAt(i, this.c.set(0xff1020).multiplyScalar(braking ? 2.4 : 0.5));
      if (this.halos.instanceColor) this.halos.instanceColor.needsUpdate = true;
    }
    void groundY;
  }

  dispose(): void {
    this.car.root.remove(this.halos, this.pool);
  }
}

import * as THREE from 'three';
import type { Vehicle } from '../physics/vehicle/vehicle';
import type { CarView } from '../car/carView';
import type { QualitySettings } from '../core/quality';
import { ParticleSystem } from './particles';
import { SkidMarks } from './skidmarks';
import { Rain } from './rain';
import { CarLights } from './carLights';

/** Gerente de efeitos: fumaça, marcas, chamas, faíscas, luzes do carro e chuva. */
export class Fx {
  readonly smoke: ParticleSystem;
  readonly flames = new ParticleSystem({ max: 40, gravity: 0.3, drag: 3, intensity: 3.2, nearFade: 1.5 });
  readonly sparks = new ParticleSystem({ max: 100, gravity: -9, drag: 0.6, intensity: 3 });
  readonly marks = new SkidMarks();
  readonly rain: Rain | null;
  readonly lights: CarLights;
  readonly group = new THREE.Group();

  /** Nível de degradação do governador de desempenho (0 = tudo ligado). */
  level = 0;
  private readonly acc = [0, 0, 0, 0];
  private sparkAcc = 0;
  private time = 0;
  private readonly p = new THREE.Vector3();
  private readonly q = new THREE.Quaternion();
  private readonly v = new THREE.Vector3();
  private readonly exhaustL = new THREE.Vector3();

  constructor(scene: THREE.Scene, private readonly car: CarView, quality: QualitySettings, comHeight: number, rainOn: boolean) {
    // Fumaça: poucas partículas pequenas e que somem perto da câmera (overdraw aditivo é caro em GPU móvel).
    this.smoke = new ParticleSystem({ max: quality.smokeMax, gravity: 0.7, drag: 1.1, intensity: 0.2, nearFade: 4 });
    this.group.add(this.marks.mesh, this.smoke.mesh, this.flames.mesh, this.sparks.mesh);
    this.rain = rainOn ? new Rain(quality.name === 'high' ? 2200 : 1200) : null;
    if (this.rain) this.group.add(this.rain.mesh);
    scene.add(this.group);
    this.lights = new CarLights(car, 4.45, comHeight);
    this.exhaustL.set(0.42, 0.3 - comHeight, 4.45 / 2 + 0.05);
  }

  /** Aplica um nível do governador: 1 sem chuva; 2 metade da fumaça; 3 sem fumaça, faíscas e marcas. */
  setLevel(level: number): void {
    this.level = level;
    if (this.rain) this.rain.mesh.visible = level < 1;
    this.marks.mesh.visible = level < 3;
    this.smoke.mesh.visible = level < 3;
    this.sparks.mesh.visible = level < 3;
  }

  /** `backfires`: estouros de escapamento vindos do áudio neste quadro. */
  update(dt: number, v: Vehicle, camPos: THREE.Vector3, backfires: number): void {
    this.time += dt;
    const root = this.car.root;
    this.q.copy(root.quaternion);
    const lv = v.body.linvel();

    // --- Fumaça e marcas por roda ---
    for (let i = 0; i < 4; i++) {
      const w = v.wheels[i]!;
      const slipping = this.level < 3 && w.contact && w.slip > 1.12 && (v.speedKmh > 4 || Math.abs(w.slipRatio) > 0.9);
      this.marks.update(i, slipping, w.point.x, w.point.y, w.point.z, 0, 0, Math.min(1.5, w.slip - 1));
      if (!slipping) {
        this.acc[i] = 0;
        continue;
      }
      const rate = 20 * Math.min(2, w.slip - 1) * (i >= 2 ? 1 : 0.5) * (this.level >= 2 ? 0.5 : 1);
      this.acc[i]! += rate * dt;
      while (this.acc[i]! >= 1) {
        this.acc[i]! -= 1;
        const r = () => (Math.random() - 0.5);
        this.smoke.emit(
          w.point.x + r() * 0.3, w.point.y + 0.15, w.point.z + r() * 0.3,
          lv.x * 0.35 + r() * 1.4, 0.9 + Math.random() * 0.9, lv.z * 0.35 + r() * 1.4,
          0.5, 1.8 + Math.random() * 0.8, 1.0 + Math.random() * 0.6, 0xa9aed0,
        );
      }
    }
    this.marks.flush();

    // --- Chamas no escapamento ---
    for (let n = 0; n < backfires; n++) {
      for (const side of [1, -1]) {
        this.p.set(this.exhaustL.x * side, this.exhaustL.y, this.exhaustL.z).applyQuaternion(this.q).add(root.position);
        // Para trás do carro (+Z local) com dispersão.
        this.v.set((Math.random() - 0.5) * 2, Math.random() * 1.2, 5 + Math.random() * 5).applyQuaternion(this.q);
        this.flames.emit(this.p.x, this.p.y, this.p.z, this.v.x + lv.x, this.v.y, this.v.z + lv.z, 0.35, 1.1, 0.13 + Math.random() * 0.07, n % 2 ? 0xffb347 : 0xff6a1a);
      }
    }

    // --- Faíscas: assoalho raspando (curso esgotado em velocidade) ou batida ---
    const scrape = this.level < 3 && v.wheels.some((w) => w.contact && w.compression > v.params.wheels[0].susp.travel * 0.97) && v.speedKmh > 12;
    const hit = Math.hypot(v.gLat, v.gLong) > 2.6;
    this.sparkAcc += dt * (scrape ? 70 : 0) + (hit ? 14 : 0);
    while (this.sparkAcc >= 1) {
      this.sparkAcc -= 1;
      this.p.set((Math.random() - 0.5) * 1.2, -0.3, (Math.random() - 0.3) * 3).applyQuaternion(this.q).add(root.position);
      this.sparks.emit(this.p.x, this.p.y, this.p.z, lv.x * 0.2 + (Math.random() - 0.5) * 4, 1 + Math.random() * 3, lv.z * 0.2 + (Math.random() - 0.5) * 4, 0.1, 0.03, 0.5 + Math.random() * 0.4, 0xffc06a);
    }

    this.smoke.update(dt, camPos);
    this.flames.update(dt, camPos);
    this.sparks.update(dt);
    this.lights.update(v.brake > 0.05, 0);
    this.rain?.update(this.time, camPos);
  }
}

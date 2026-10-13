import RAPIER from '@dimforge/rapier3d-compat';
import type { SurfaceId } from './surfaces';

export type Rapier = typeof RAPIER;

/**
 * Envolve o mundo Rapier: criação, colisores estáticos com tipo de superfície
 * (o veículo consulta a superfície pelo handle do colisor atingido pelo raio) e passo fixo.
 */
export class PhysicsWorld {
  readonly R: Rapier = RAPIER;
  readonly world: RAPIER.World;
  private readonly surfaces = new Map<number, SurfaceId>();

  private constructor(gravityY: number) {
    this.world = new RAPIER.World({ x: 0, y: gravityY, z: 0 });
  }

  static async create(gravityY = -9.81): Promise<PhysicsWorld> {
    await RAPIER.init();
    return new PhysicsWorld(gravityY);
  }

  surfaceOf(colliderHandle: number): SurfaceId {
    return this.surfaces.get(colliderHandle) ?? 'asphalt';
  }

  /** Caixa estática, opcionalmente girada em torno de Y (yaw) e inclinada em X (pitch, para rampas). */
  addBox(
    center: readonly [number, number, number],
    half: readonly [number, number, number],
    opts: { yaw?: number; pitch?: number; surface?: SurfaceId; friction?: number } = {},
  ): RAPIER.Collider {
    const { yaw = 0, pitch = 0, surface = 'asphalt', friction = 0.6 } = opts;
    const body = this.world.createRigidBody(
      this.R.RigidBodyDesc.fixed().setTranslation(center[0], center[1], center[2]).setRotation(eulerYX(yaw, pitch)),
    );
    const col = this.world.createCollider(
      this.R.ColliderDesc.cuboid(half[0], half[1], half[2]).setFriction(friction).setRestitution(0.1),
      body,
    );
    this.surfaces.set(col.handle, surface);
    return col;
  }

  /** Chão plano infinito (uma laje grande) com a face de cima em y = 0. */
  addGround(halfSize = 1000, surface: SurfaceId = 'asphalt'): RAPIER.Collider {
    return this.addBox([0, -0.5, 0], [halfSize, 0.5, halfSize], { surface });
  }

  /** Corpo dinâmico simples (cones, barris). */
  addDynamicBox(
    center: readonly [number, number, number],
    half: readonly [number, number, number],
    mass: number,
  ): RAPIER.RigidBody {
    const body = this.world.createRigidBody(
      this.R.RigidBodyDesc.dynamic().setTranslation(center[0], center[1], center[2]),
    );
    const volume = 8 * half[0] * half[1] * half[2];
    this.world.createCollider(
      this.R.ColliderDesc.cuboid(half[0], half[1], half[2]).setDensity(mass / volume).setFriction(0.5).setRestitution(0.2),
      body,
    );
    return body;
  }

  step(dt: number): void {
    this.world.timestep = dt;
    this.world.step();
  }
}

/** Quaternion de yaw (em Y) seguido de pitch (em X local). */
function eulerYX(yaw: number, pitch: number): { x: number; y: number; z: number; w: number } {
  const cy = Math.cos(yaw / 2), sy = Math.sin(yaw / 2);
  const cp = Math.cos(pitch / 2), sp = Math.sin(pitch / 2);
  // q = qy * qx
  return { w: cy * cp, x: cy * sp, y: sy * cp, z: -sy * sp };
}

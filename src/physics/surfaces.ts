/** Tipos de superfície e escalas de atrito/resistência ao rolamento. */
export type SurfaceId = 'asphalt' | 'wet' | 'concrete' | 'paint' | 'curb' | 'grass' | 'dirt';

export interface Surface {
  id: SurfaceId;
  label: string;
  /** Multiplica o atrito de pico do pneu. */
  grip: number;
  /** Multiplica a resistência ao rolamento. */
  rolling: number;
}

export const SURFACES: Record<SurfaceId, Surface> = {
  asphalt: { id: 'asphalt', label: 'Asfalto seco', grip: 1.0, rolling: 1 },
  // As ruas da cidade ficam molhadas à noite: menos aderência, drift mais fácil.
  wet: { id: 'wet', label: 'Asfalto molhado', grip: 0.86, rolling: 1.1 },
  concrete: { id: 'concrete', label: 'Concreto', grip: 0.97, rolling: 1 },
  paint: { id: 'paint', label: 'Faixa pintada', grip: 0.78, rolling: 1 },
  curb: { id: 'curb', label: 'Guia', grip: 0.9, rolling: 1.5 },
  grass: { id: 'grass', label: 'Grama', grip: 0.5, rolling: 4 },
  dirt: { id: 'dirt', label: 'Terra', grip: 0.62, rolling: 3 },
};

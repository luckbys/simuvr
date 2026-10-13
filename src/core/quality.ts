export type QualityName = 'low' | 'high';

export interface QualitySettings {
  name: QualityName;
  /** Escala do framebuffer WebXR (1 = resolução nativa recomendada). */
  xrFramebufferScale: number;
  /** 0..1, foveated rendering do Quest. */
  foveation: number;
  /** Frequência de passo da física (Hz). */
  physicsHz: number;
  /** Teto do pixel ratio no modo desktop. */
  maxPixelRatio: number;
  rearMirror: boolean;
  rain: boolean;
  /** Lado do cubemap de reflexo gerado uma vez no carregamento. */
  envMapSize: number;
  /** Multiplicador de densidade de letreiros / luzes decorativas (0..1). */
  detail: number;
  /** Frequência-alvo preferida no Quest (Hz). */
  xrFrameRate: number;
  /** Faróis com SpotLight real (caro: toda superfície PBR avalia a luz). No baixo ficam só os halos e a mancha de luz. */
  headlightSpots: boolean;
  /** Pintura com verniz (MeshPhysicalMaterial) em vez de MeshStandardMaterial. */
  physicalMaterials: boolean;
  /** Detalhe da geometria dos carros (segmentos de loft, pneus e aros). */
  carLod: 'low' | 'high';
  /** Máximo de partículas de fumaça. */
  smokeMax: number;
}

export const QUALITY: Record<QualityName, QualitySettings> = {
  low: {
    name: 'low',
    xrFramebufferScale: 0.8,
    foveation: 1,
    physicsHz: 90,
    maxPixelRatio: 1,
    rearMirror: false,
    rain: false,
    envMapSize: 128,
    detail: 0.55,
    xrFrameRate: 72,
    headlightSpots: false,
    physicalMaterials: false,
    carLod: 'low',
    smokeMax: 48,
  },
  high: {
    name: 'high',
    xrFramebufferScale: 1.0,
    foveation: 1,
    physicsHz: 120,
    maxPixelRatio: 2,
    rearMirror: true,
    rain: true,
    envMapSize: 256,
    detail: 1,
    xrFrameRate: 90,
    headlightSpots: true,
    physicalMaterials: true,
    carLod: 'high',
    smokeMax: 110,
  },
};

const KEY = 'simuvr.quality';

export function loadQuality(): QualityName {
  const url = new URLSearchParams(location.search).get('q');
  if (url === 'low' || url === 'high') return url;
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'low' || v === 'high') return v;
  } catch {
    /* storage indisponível */
  }
  // Quest e outros headsets móveis começam no tier baixo.
  return /OculusBrowser|Quest|Mobile/i.test(navigator.userAgent) ? 'low' : 'high';
}

/** Grava a escolha do jogador; `null` volta ao automático (Quest = baixo, PC = alto). */
export function saveQuality(name: QualityName | null): void {
  try {
    if (name === null) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, name);
  } catch {
    /* ignorar */
  }
}

/** Escolha salva (ou null se automático). */
export function storedQuality(): QualityName | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'low' || v === 'high' ? v : null;
  } catch {
    return null;
  }
}

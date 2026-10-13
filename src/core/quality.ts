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

export function saveQuality(name: QualityName): void {
  try {
    localStorage.setItem(KEY, name);
  } catch {
    /* ignorar */
  }
}

import { describe, expect, it } from 'vitest';
import { QUALITY, applyOverrides } from '../../src/core/quality';

const q = (s: string) => applyOverrides(QUALITY.low, new URLSearchParams(s));

describe('applyOverrides (ajuste por URL no Quest)', () => {
  it('sem parâmetros devolve uma cópia idêntica, sem alterar o original', () => {
    const out = q('');
    expect(out).toEqual(QUALITY.low);
    expect(out).not.toBe(QUALITY.low);
  });

  it('aplica escala, foveation, taxa do headset e passo da física', () => {
    const out = q('scale=0.7&fove=0.5&rate=90&hz=60');
    expect(out.xrFramebufferScale).toBe(0.7);
    expect(out.foveation).toBe(0.5);
    expect(out.xrFrameRate).toBe(90);
    expect(out.physicsHz).toBe(60);
    // o resto do tier fica como estava
    expect(out.name).toBe('low');
    expect(out.headlightSpots).toBe(false);
    // e o original não muda
    expect(QUALITY.low.xrFramebufferScale).toBe(0.8);
  });

  it('valores inválidos, fora de faixa ou vazios são ignorados', () => {
    for (const bad of ['scale=abc', 'scale=0.1', 'scale=9', 'scale=', 'fove=-1', 'fove=2', 'rate=10', 'rate=500', 'hz=0', 'hz=NaN', 'scale=Infinity']) {
      expect(q(bad)).toEqual(QUALITY.low);
    }
  });

  it('um parâmetro inválido não impede os válidos', () => {
    const out = q('scale=abc&fove=0.25');
    expect(out.xrFramebufferScale).toBe(QUALITY.low.xrFramebufferScale);
    expect(out.foveation).toBe(0.25);
  });

  it('os tiers são coerentes: o baixo é mais leve que o alto em tudo que importa', () => {
    const lo = QUALITY.low, hi = QUALITY.high;
    expect(lo.xrFramebufferScale).toBeLessThan(hi.xrFramebufferScale);
    expect(lo.physicsHz).toBeLessThan(hi.physicsHz);
    expect(lo.smokeMax).toBeLessThan(hi.smokeMax);
    expect(lo.envMapSize).toBeLessThan(hi.envMapSize);
    expect(lo.detail).toBeLessThan(hi.detail);
    for (const k of ['headlightSpots', 'physicalMaterials', 'rearMirror', 'rain'] as const) {
      expect(lo[k]).toBe(false);
      expect(hi[k]).toBe(true);
    }
  });
});

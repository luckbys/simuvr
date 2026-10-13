import { describe, expect, it } from 'vitest';
import { cabinCutoff, engineSoundParams, tireSquealParams, windGain, type EngineSoundInput } from '../../src/audio/soundParams';

const base: EngineSoundInput = { rpm: 3000, throttle: 0.5, boostRatio: 0.3, idleRpm: 900, limiterRpm: 7400, fuelCut: false, exhaustOpen: 0.5 };
const p = (patch: Partial<EngineSoundInput> = {}) => engineSoundParams({ ...base, ...patch });

describe('engineSoundParams', () => {
  it('a frequência de disparo é rpm/30 para um 4 cilindros e sobe de forma proporcional', () => {
    expect(p({ rpm: 3000 }).f0).toBeCloseTo(100, 6);
    expect(p({ rpm: 6000 }).f0 / p({ rpm: 3000 }).f0).toBeCloseTo(2, 9);
    expect(p({ rpm: 900 }).f0).toBeCloseTo(30, 6);
  });

  it('abrir o acelerador deixa o som mais alto, mais brilhante e mais distorcido', () => {
    const idle = p({ throttle: 0 });
    const wot = p({ throttle: 1 });
    expect(wot.master).toBeGreaterThan(idle.master);
    expect(wot.cutoff).toBeGreaterThan(idle.cutoff);
    expect(wot.drive).toBeGreaterThan(idle.drive);
    expect(wot.gainNoise).toBeGreaterThan(idle.gainNoise);
  });

  it('o brilho acompanha a rotação e o escape livre', () => {
    expect(p({ rpm: 6500 }).cutoff).toBeGreaterThan(p({ rpm: 1500 }).cutoff);
    expect(p({ exhaustOpen: 1 }).cutoff).toBeGreaterThan(p({ exhaustOpen: 0 }).cutoff);
    expect(p({ exhaustOpen: 1, throttle: 1 }).drive).toBeGreaterThan(p({ exhaustOpen: 0, throttle: 1 }).drive);
  });

  it('o assobio do turbo sobe com a pressão e some sem turbo', () => {
    expect(p({ boostRatio: 1 }).whistleFreq).toBeGreaterThan(p({ boostRatio: 0.1 }).whistleFreq);
    expect(p({ boostRatio: 1 }).whistleGain).toBeGreaterThan(p({ boostRatio: 0 }).whistleGain);
    expect(p({ boostRatio: 0, throttle: 0 }).whistleGain).toBeLessThan(0.02);
  });

  it('o limitador de giro (corte de combustível) derruba o volume', () => {
    expect(p({ fuelCut: true }).master).toBeLessThan(p({ fuelCut: false }).master * 0.2);
  });

  it('todos os ganhos ficam finitos e em faixa segura em todo o envelope', () => {
    for (let rpm = 600; rpm <= 8200; rpm += 400) {
      for (const throttle of [0, 0.5, 1]) {
        for (const boostRatio of [0, 0.5, 1]) {
          const s = p({ rpm, throttle, boostRatio });
          for (const [k, v] of Object.entries(s)) {
            expect(Number.isFinite(v), k).toBe(true);
            expect(v, k).toBeGreaterThanOrEqual(0);
          }
          expect(s.master).toBeLessThanOrEqual(0.6);
          expect(s.gainSaw + s.gainSquare + s.gainSub + s.gainNoise).toBeLessThanOrEqual(1.4);
          expect(s.cutoff).toBeLessThan(10000);
          expect(s.whistleGain).toBeLessThanOrEqual(0.2);
        }
      }
    }
  });
});

describe('tireSquealParams', () => {
  it('só guincha além do limite de aderência, e mais rápido que parado', () => {
    expect(tireSquealParams({ slip: 0.4, speedKmh: 80, onGround: true, wet: false }).gain).toBe(0);
    const s = tireSquealParams({ slip: 1.8, speedKmh: 80, onGround: true, wet: false }).gain;
    expect(s).toBeGreaterThan(0.1);
    expect(tireSquealParams({ slip: 1.8, speedKmh: 2, onGround: true, wet: false }).gain).toBeLessThan(s * 0.3);
  });

  it('no ar não faz barulho, e no molhado é mais baixo e mais agudo com mais escorregamento', () => {
    expect(tireSquealParams({ slip: 2, speedKmh: 80, onGround: false, wet: false }).gain).toBe(0);
    const dry = tireSquealParams({ slip: 1.8, speedKmh: 80, onGround: true, wet: false });
    const wet = tireSquealParams({ slip: 1.8, speedKmh: 80, onGround: true, wet: true });
    expect(wet.gain).toBeLessThan(dry.gain);
    expect(tireSquealParams({ slip: 2.5, speedKmh: 80, onGround: true, wet: false }).freq).toBeGreaterThan(
      tireSquealParams({ slip: 1.2, speedKmh: 80, onGround: true, wet: false }).freq,
    );
  });
});

describe('vento e cabine', () => {
  it('o vento cresce com o quadrado da velocidade e é mais baixo dentro do carro', () => {
    expect(windGain({ speedKmh: 200, insideCar: false })).toBeGreaterThan(windGain({ speedKmh: 100, insideCar: false }) * 3);
    expect(windGain({ speedKmh: 150, insideCar: true })).toBeLessThan(windGain({ speedKmh: 150, insideCar: false }));
  });
  it('dentro do carro o som externo é abafado; vidros escuros abafam mais', () => {
    expect(cabinCutoff(false)).toBeGreaterThan(cabinCutoff(true));
    expect(cabinCutoff(true, 0.92)).toBeLessThan(cabinCutoff(true, 0.35));
  });
});

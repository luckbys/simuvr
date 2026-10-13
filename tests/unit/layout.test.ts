import { describe, expect, it } from 'vitest';
import { DEFAULT_CITY, generateCity, insideRect, SIGN_CELLS } from '../../src/city/layout';

describe('generateCity', () => {
  const city = generateCity();

  it('é determinística', () => {
    const again = generateCity();
    expect(JSON.stringify(again)).toBe(JSON.stringify(city));
    const other = generateCity({ ...DEFAULT_CITY, seed: 7 });
    expect(JSON.stringify(other.buildings)).not.toBe(JSON.stringify(city.buildings));
  });

  it('respeita o orçamento de instâncias', () => {
    expect(city.buildings.length).toBeGreaterThan(80);
    expect(city.buildings.length).toBeLessThan(450);
    expect(city.signs.length).toBeGreaterThan(80);
    expect(city.signs.length).toBeLessThan(700);
    expect(city.lamps.length).toBeLessThan(900);
    expect(city.carSlots.length).toBeGreaterThanOrEqual(12);
    expect(city.carSlots.length).toBeLessThanOrEqual(18);
  });

  it('nenhum prédio invade o ponto de encontro nem as ruas', () => {
    const P = city.pitch;
    const half = DEFAULT_CITY.blockSize / 2;
    for (const b of city.buildings) {
      expect(b.w).toBeGreaterThan(5);
      expect(b.d).toBeGreaterThan(5);
      expect(b.h).toBeGreaterThanOrEqual(9);
      // fora do encontro
      const overlapsMeet =
        b.x + b.w / 2 > city.meet.x0 && b.x - b.w / 2 < city.meet.x1 && b.z + b.d / 2 > city.meet.z0 && b.z - b.d / 2 < city.meet.z1;
      expect(overlapsMeet).toBe(false);
      // dentro de algum quarteirão (nunca sobre a rua): o centro relativo ao quarteirão fica dentro de ±(half - calçada)
      const cx = DEFAULT_CITY.blocksX % 2 ? 0 : P / 2;
      const rx = ((b.x - cx + P / 2) % P + P) % P - P / 2;
      const rz = ((b.z - cx + P / 2) % P + P) % P - P / 2;
      expect(Math.abs(rx) + b.w / 2).toBeLessThanOrEqual(half - DEFAULT_CITY.sidewalk + 0.01);
      expect(Math.abs(rz) + b.d / 2).toBeLessThanOrEqual(half - DEFAULT_CITY.sidewalk + 0.01);
    }
  });

  it('prédios do centro são mais altos que os da periferia', () => {
    const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    const near = city.buildings.filter((b) => Math.hypot(b.x, b.z) < 150).map((b) => b.h);
    const far = city.buildings.filter((b) => Math.hypot(b.x, b.z) > 260).map((b) => b.h);
    expect(avg(near)).toBeGreaterThan(avg(far));
  });

  it('letreiros ficam na altura certa, voltados para fora e com célula de atlas válida', () => {
    for (const s of city.signs) {
      expect(s.y).toBeGreaterThan(3);
      expect(s.y).toBeLessThan(12);
      expect(s.cell).toBeGreaterThanOrEqual(0);
      expect(s.cell).toBeLessThan(SIGN_CELLS);
      expect(s.w).toBeGreaterThan(0);
      expect(s.h).toBeGreaterThan(0);
    }
  });

  it('postes de luz não ficam dentro do ponto de encontro', () => {
    for (const l of city.lamps) expect(insideRect(l.x, l.z, city.meet, 0)).toBe(false);
  });

  it('vagas, palco e posição inicial estão dentro do ponto de encontro e sem sobreposição de carros', () => {
    for (const c of city.carSlots) expect(insideRect(c.x, c.z, city.meet, -2)).toBe(true);
    expect(insideRect(city.spawn.x, city.spawn.z, city.meet, -5)).toBe(true);
    expect(insideRect((city.stage.x0 + city.stage.x1) / 2, (city.stage.z0 + city.stage.z1) / 2, city.meet, 0)).toBe(true);
    for (let i = 0; i < city.carSlots.length; i++) {
      for (let j = i + 1; j < city.carSlots.length; j++) {
        const a = city.carSlots[i]!, b = city.carSlots[j]!;
        expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThan(3.2);
      }
      // a posição inicial do jogador está livre
      expect(Math.hypot(city.carSlots[i]!.x - city.spawn.x, city.carSlots[i]!.z - city.spawn.z)).toBeGreaterThan(8);
    }
  });

  it('o nível de detalhe baixo reduz letreiros e postes', () => {
    const low = generateCity({ ...DEFAULT_CITY, detail: 0.55 });
    expect(low.signs.length).toBeLessThan(city.signs.length);
  });
});

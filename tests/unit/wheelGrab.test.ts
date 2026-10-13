import { describe, expect, it } from 'vitest';
import { WheelGrabModel, wheelReturnRate, type HandSample } from '../../src/xr/wheelGrab';

const R = 0.18;
/** Mão sobre o aro no ângulo horário `deg` (0 = 12 horas, 90 = 3 horas). */
const onRim = (id: string, deg: number, gripping = true, z = 0): HandSample => {
  const a = (deg * Math.PI) / 180;
  return { id, x: Math.sin(a) * R, y: Math.cos(a) * R, z, gripping };
};
const DEG = Math.PI / 180;

describe('WheelGrabModel', () => {
  it('só agarra se o grip for apertado perto do aro', () => {
    const w = new WheelGrabModel();
    // grip apertado longe do aro (mão a 40 cm do centro): ignora
    w.update(0.01, [{ id: 'r', x: 0.4, y: 0, z: 0, gripping: true }], 0);
    expect(w.isHeld).toBe(false);
    // grip apertado perto do aro: agarra
    w.update(0.01, [onRim('l', 0, false)], 0);
    w.update(0.01, [onRim('l', 0, true)], 0);
    expect(w.heldBy('l')).toBe(true);
    expect(w.grabbedNow).toBe('l');
  });

  it('girar a mão no sentido horário esterça para a direita, e vice-versa', () => {
    const w = new WheelGrabModel();
    w.update(0.01, [onRim('r', 0, false)], 0);
    w.update(0.01, [onRim('r', 0, true)], 0);
    for (let d = 5; d <= 60; d += 5) w.update(0.01, [onRim('r', d)], 0);
    expect(w.angle / DEG).toBeCloseTo(60, 3);
    expect(w.steer).toBeGreaterThan(0);
    for (let d = 55; d >= -40; d -= 5) w.update(0.01, [onRim('r', d)], 0);
    expect(w.angle / DEG).toBeCloseTo(-40, 3);
    expect(w.steer).toBeLessThan(0);
  });

  it('o ângulo é relativo ao ponto onde agarrou (não dá salto)', () => {
    const w = new WheelGrabModel();
    w.update(0.01, [onRim('l', 270, false)], 0);
    w.update(0.01, [onRim('l', 270, true)], 0);
    expect(w.angle).toBeCloseTo(0, 6);
    w.update(0.01, [onRim('l', 300)], 0);
    expect(w.angle / DEG).toBeCloseTo(30, 3);
  });

  it('desenrola a passagem por ±180° (não perde voltas)', () => {
    const w = new WheelGrabModel({ radius: R, grabTolerance: 0.11, releaseDistance: 0.32, lockToLock: 4 * Math.PI * 2 });
    w.update(0.01, [onRim('r', 150, false)], 0);
    w.update(0.01, [onRim('r', 150, true)], 0);
    for (let d = 160; d <= 210; d += 10) w.update(0.01, [onRim('r', d % 360)], 0);
    expect(w.angle / DEG).toBeCloseTo(60, 3);
  });

  it('duas mãos giram juntas sem dobrar o ângulo', () => {
    const w = new WheelGrabModel();
    w.update(0.01, [onRim('l', 270, false), onRim('r', 90, false)], 0);
    w.update(0.01, [onRim('l', 270, true), onRim('r', 90, true)], 0);
    expect(w.heldBy('l') && w.heldBy('r')).toBe(true);
    for (let d = 5; d <= 40; d += 5) w.update(0.01, [onRim('l', 270 + d), onRim('r', 90 + d)], 0);
    expect(w.angle / DEG).toBeCloseTo(40, 3);
  });

  it('soltar o grip solta o volante; ele volta ao centro com a taxa dada', () => {
    const w = new WheelGrabModel();
    w.update(0.01, [onRim('r', 0, false)], 0);
    w.update(0.01, [onRim('r', 0, true)], 0);
    for (let d = 5; d <= 90; d += 5) w.update(0.01, [onRim('r', d)], 0);
    expect(w.angle / DEG).toBeCloseTo(90, 3);
    w.update(0.01, [onRim('r', 90, false)], 0);
    expect(w.isHeld).toBe(false);
    expect(w.releasedNow).toBe('r');
    // sem retorno (parado): continua onde está
    for (let i = 0; i < 100; i++) w.update(0.01, [onRim('r', 90, false)], 0);
    expect(w.angle / DEG).toBeCloseTo(90, 3);
    // com retorno: decai exponencialmente até zerar
    for (let i = 0; i < 500; i++) w.update(0.01, [onRim('r', 90, false)], 4);
    expect(Math.abs(w.angle)).toBeLessThan(0.001);
  });

  it('batente: não passa de metade do curso total', () => {
    const w = new WheelGrabModel({ radius: R, grabTolerance: 0.11, releaseDistance: 0.32, lockToLock: 360 * DEG });
    w.update(0.01, [onRim('r', 0, false)], 0);
    w.update(0.01, [onRim('r', 0, true)], 0);
    for (let d = 10; d <= 340; d += 10) w.update(0.01, [onRim('r', d)], 0);
    expect(w.angle).toBeLessThanOrEqual(w.maxAngle + 1e-9);
    expect(w.steer).toBeCloseTo(1, 6);
  });

  it('solta sozinho se a mão se afasta demais do aro', () => {
    const w = new WheelGrabModel();
    w.update(0.01, [onRim('r', 0, false)], 0);
    w.update(0.01, [onRim('r', 0, true)], 0);
    w.update(0.01, [{ id: 'r', x: 0.9, y: 0.9, z: 0.4, gripping: true }], 0);
    expect(w.isHeld).toBe(false);
  });

  it('controle que some (desconectou) solta o volante', () => {
    const w = new WheelGrabModel();
    w.update(0.01, [onRim('r', 0, false)], 0);
    w.update(0.01, [onRim('r', 0, true)], 0);
    w.update(0.01, [], 0);
    expect(w.isHeld).toBe(false);
  });

  it('o retorno ao centro é maior em velocidade', () => {
    expect(wheelReturnRate(0)).toBeLessThan(wheelReturnRate(15));
    expect(wheelReturnRate(15)).toBeLessThan(wheelReturnRate(30));
    expect(wheelReturnRate(0, 1)).toBeGreaterThan(wheelReturnRate(0, 0));
  });
});

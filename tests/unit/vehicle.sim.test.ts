import { describe, expect, it } from 'vitest';
import { HANABI_200S } from '../../src/physics/carSpec';
import { defaultTuning, driftTuning, type TuningState } from '../../src/physics/tuning';
import { finiteState, KMH, makeSim } from './simHelpers';

const G = 9.81;

describe('veículo parado', () => {
  it('assenta sem deslizar, na altura certa e com a carga somando o peso', async () => {
    const sim = await makeSim();
    sim.run(4, () => ({}));
    const car = sim.car;
    expect(finiteState(sim)).toBe(true);
    expect(Math.abs(car.speed)).toBeLessThan(0.02);
    const p = sim.pos();
    expect(Math.hypot(p.x, p.z)).toBeLessThan(0.05);
    expect(p.y).toBeCloseTo(car.params.comHeightStatic, 1);
    expect(car.wheels.every((w) => w.contact)).toBe(true);
    const total = sim.totalLoad();
    expect(total / (car.params.mass * G)).toBeGreaterThan(0.98);
    expect(total / (car.params.mass * G)).toBeLessThan(1.02);
    const front = car.wheels[0]!.load + car.wheels[1]!.load;
    expect(front / total).toBeCloseTo(HANABI_200S.frontWeight, 1);
    // Esquerda e direita equilibradas
    expect(Math.abs(car.wheels[0]!.load - car.wheels[1]!.load) / total).toBeLessThan(0.02);
    expect(Math.abs(sim.rollAngle())).toBeLessThan(0.01);
    expect(car.rpm).toBeGreaterThan(700);
    expect(car.rpm).toBeLessThan(1300); // marcha lenta estável
  });

  it('com freio de mão e rampa de atrito não escorrega (estático)', async () => {
    const sim = await makeSim();
    sim.run(2, () => ({ handbrake: 1 }));
    expect(Math.abs(sim.car.speed)).toBeLessThan(0.02);
  });
});

describe('aceleração', () => {
  it('0–100 km/h em tempo plausível, sem NaN, trocando marchas', async () => {
    const sim = await makeSim();
    let t100 = NaN;
    sim.run(14, () => ({ throttle: 1 }), (t) => {
      if (sim.car.speed >= 100 * KMH) { t100 = t; return false; }
    });
    expect(finiteState(sim)).toBe(true);
    expect(t100).toBeGreaterThan(4.2);
    expect(t100).toBeLessThan(8.0);
    expect(sim.car.gearbox.gear).toBeGreaterThanOrEqual(3);
  });

  it('é simétrico: sem esterço e sem cambagem o carro anda exatamente reto', async () => {
    const sim = await makeSim({ ...defaultTuning(), camberFront: 0, camberRear: 0 });
    sim.run(6, () => ({ throttle: 1 }));
    const p = sim.pos();
    expect(Math.abs(p.x)).toBeLessThan(0.05);
    expect(p.z).toBeLessThan(-30);
  });

  it('com acelerador moderado e direção solta não sai da reta', async () => {
    const sim = await makeSim();
    sim.run(6, () => ({ throttle: 0.6 }));
    const p = sim.pos();
    expect(Math.abs(p.x)).toBeLessThan(0.5);
    expect(Math.abs(sim.yaw())).toBeLessThan(0.06); // < 3,5°
    expect(p.z).toBeLessThan(-15);
  });

  it('aceleração parcial em 1ª não engasga: a velocidade sobe de forma monotônica', async () => {
    const sim = await makeSim();
    let prev = 0, dips = 0, maxSlip = 0;
    sim.run(6, () => ({ throttle: 0.5 }), (t) => {
      if (t > 1) {
        if (sim.car.speed < prev - 0.02) dips++;
        maxSlip = Math.max(maxSlip, Math.abs(sim.car.wheels[2]!.slipRatio));
      }
      prev = sim.car.speed;
    });
    expect(dips).toBe(0);
    expect(maxSlip).toBeLessThan(0.4); // sem a oscilação de embreagem
    expect(sim.car.speed).toBeGreaterThan(8);
  });

  it('velocidade final limitada pelo arrasto, dentro do esperado', async () => {
    const sim = await makeSim();
    sim.car.setForwardSpeed(50, 5);
    sim.run(50, () => ({ throttle: 1 }));
    const kmh = sim.car.speedKmh;
    expect(kmh).toBeGreaterThan(200);
    expect(kmh).toBeLessThan(285);
    expect(sim.car.rpm).toBeLessThan(HANABI_200S.engine.limiterRpm + 400);
  });

  it('ré: segurar o freio parado engata ré e anda para trás', async () => {
    const sim = await makeSim();
    sim.run(5, () => ({ brake: 1 }));
    expect(sim.car.speed).toBeLessThan(-2);
    expect(sim.car.gearbox.gear).toBe(-1);
  });

  it('com tração disponível (slicks), mais potência acelera mais de 60 a 120 km/h', async () => {
    const slick = { tireFront: 'slick', tireRear: 'slick' } as const;
    const time60to120 = async (tuning: TuningState): Promise<number> => {
      const sim = await makeSim(tuning);
      sim.car.setForwardSpeed(60 * KMH, 3);
      let t0 = NaN, t1 = NaN;
      sim.run(20, () => ({ throttle: 1 }), (t) => {
        if (Number.isNaN(t0) && sim.car.speed >= 60 * KMH) t0 = t;
        if (sim.car.speed >= 120 * KMH) { t1 = t; return false; }
      });
      return t1 - t0;
    };
    const na = await time60to120({ ...defaultTuning(), ...slick, turbo: 'none' });
    const stock = await time60to120({ ...defaultTuning(), ...slick });
    const tuned = await time60to120({ ...defaultTuning(), ...slick, turbo: 'race', ecu: 'stage2', intakeExhaust: true });
    expect(tuned).toBeLessThan(stock);
    expect(stock).toBeLessThan(na);
  });

  it('potência demais em pneu de rua só faz patinar: o turbo de competição escorrega mais que o original', async () => {
    const maxRearSlip = async (tuning: TuningState): Promise<number> => {
      const sim = await makeSim(tuning);
      sim.car.setForwardSpeed(60 * KMH, 3);
      let m = 0;
      sim.run(3, () => ({ throttle: 1 }), () => { m = Math.max(m, sim.car.wheels[2]!.slipRatio); });
      return m;
    };
    const stock = await maxRearSlip(defaultTuning());
    const race = await maxRearSlip({ ...defaultTuning(), turbo: 'race', ecu: 'stage2' });
    expect(race).toBeGreaterThan(stock);
    expect(race).toBeGreaterThan(0.5);
  });
});

describe('frenagem', () => {
  it('100 → 0 km/h com ABS em distância realista', async () => {
    const sim = await makeSim();
    sim.car.setForwardSpeed(100 * KMH, 4);
    sim.run(0.5, () => ({}));
    const z0 = sim.pos().z;
    sim.run(8, () => ({ brake: 1 }), () => (sim.car.speed < 0.3 ? false : undefined));
    const dist = Math.abs(sim.pos().z - z0);
    expect(finiteState(sim)).toBe(true);
    expect(dist).toBeGreaterThan(30);
    expect(dist).toBeLessThan(50);
    expect(Math.abs(sim.pos().x)).toBeLessThan(1);
  });

  it('freios de competição freiam em menos distância que os originais, ou igual (limite de aderência)', async () => {
    const brakeDist = async (t: TuningState) => {
      const sim = await makeSim(t);
      sim.car.setForwardSpeed(100 * KMH, 4);
      const z0 = sim.pos().z;
      sim.run(8, () => ({ brake: 1 }), () => (sim.car.speed < 0.3 ? false : undefined));
      return Math.abs(sim.pos().z - z0);
    };
    const stock = await brakeDist(defaultTuning());
    const race = await brakeDist({ ...defaultTuning(), brakes: 'race', brakeBias: 0.62 });
    expect(race).toBeLessThanOrEqual(stock + 1.5);
  });

  it('pneus mais aderentes freiam em menos distância', async () => {
    const brakeDist = async (t: TuningState) => {
      const sim = await makeSim(t);
      sim.car.setForwardSpeed(100 * KMH, 4);
      const z0 = sim.pos().z;
      sim.run(8, () => ({ brake: 1 }), () => (sim.car.speed < 0.3 ? false : undefined));
      return Math.abs(sim.pos().z - z0);
    };
    const street = await brakeDist({ ...defaultTuning(), brakes: 'race' });
    const slick = await brakeDist({ ...defaultTuning(), brakes: 'race', tireFront: 'slick', tireRear: 'slick' });
    expect(slick).toBeLessThan(street);
  });
});

describe('curvas', () => {
  /** Mede o pico de aceleração lateral (g) subindo o esterço devagar a velocidade constante. */
  async function skidpad(tuning: TuningState, speedKmh = 70): Promise<{ maxG: number; sim: Awaited<ReturnType<typeof makeSim>> }> {
    const sim = await makeSim(tuning);
    const v = speedKmh * KMH;
    sim.car.setForwardSpeed(v, 4);
    sim.run(1, () => ({ throttle: 0.25 }));
    let maxG = 0;
    sim.run(10, (t) => {
      const s = Math.min(1, (t - 1) / 8);
      const thr = sim.car.speed < v ? 0.6 : 0.0;
      return { steer: s * 0.7, steerIsAbsolute: true, throttle: thr, brake: 0 };
    }, () => { maxG = Math.max(maxG, Math.abs(sim.car.gLat)); });
    return { maxG, sim };
  }

  it('aderência lateral de pico perto de 1 g com pneus de rua', async () => {
    const { maxG, sim } = await skidpad(defaultTuning());
    expect(finiteState(sim)).toBe(true);
    expect(maxG).toBeGreaterThan(0.8);
    expect(maxG).toBeLessThan(1.25);
  });

  it('semi-slick segura mais que pneu de rua, e o composto de drift menos', async () => {
    const street = (await skidpad(defaultTuning())).maxG;
    const slick = (await skidpad({ ...defaultTuning(), tireFront: 'slick', tireRear: 'slick' })).maxG;
    const drift = (await skidpad({ ...defaultTuning(), tireFront: 'drift', tireRear: 'drift' })).maxG;
    expect(slick).toBeGreaterThan(street + 0.1);
    expect(drift).toBeLessThan(street);
  });

  it('barras estabilizadoras mais rígidas reduzem a rolagem em curva estável', async () => {
    const rollAt = async (arb: number) => {
      const sim = await makeSim({ ...defaultTuning(), arbFront: arb, arbRear: arb });
      const v = 60 * KMH;
      sim.car.setForwardSpeed(v, 4);
      let roll = 0;
      sim.run(6, (t) => ({ steer: Math.min(1, t / 1.5) * 0.18, steerIsAbsolute: true, throttle: sim.car.speed < v ? 0.5 : 0 }), (t) => {
        if (t > 4) roll = Math.max(roll, Math.abs(sim.rollAngle()));
      });
      return roll;
    };
    const soft = await rollAt(0.3);
    const stiff = await rollAt(2.5);
    expect(soft).toBeGreaterThan(0.01);
    expect(stiff).toBeLessThan(soft);
  });

  it('asa traseira gera pressão aerodinâmica e aumenta a carga total em alta velocidade', async () => {
    const loadAt = async (spoiler: TuningState['spoiler']) => {
      const sim = await makeSim({ ...defaultTuning(), spoiler });
      sim.car.setForwardSpeed(60, 5);
      sim.run(1.5, () => ({ throttle: 0.4 }));
      return sim.totalLoad() / sim.car.params.mass;
    };
    const none = await loadAt('none');
    const wing = await loadAt('wing');
    expect(wing).toBeGreaterThan(none);
  });
});

describe('drift', () => {
  it('freio de mão em curva a 70 km/h põe o carro de lado e ele não gera NaN', async () => {
    const sim = await makeSim(driftTuning());
    sim.car.setForwardSpeed(70 * KMH, 3);
    let maxDrift = 0;
    sim.run(5, (t) => {
      if (t < 0.6) return { throttle: 0.7, steer: 0.5, steerIsAbsolute: true };
      if (t < 1.4) return { throttle: 0.7, steer: 0.5, steerIsAbsolute: true, handbrake: 1 };
      return { throttle: 0.9, steer: -0.35, steerIsAbsolute: true };
    }, () => { maxDrift = Math.max(maxDrift, Math.abs(sim.car.driftAngle)); });
    expect(finiteState(sim)).toBe(true);
    expect(maxDrift).toBeGreaterThan(0.35); // > 20°
  });

  it('potência no meio da curva com diferencial travado causa sobresterço (derrapa o eixo traseiro)', async () => {
    const maxDriftFor = async (diff: TuningState['diff']) => {
      const sim = await makeSim({ ...driftTuning(), diff, tireRear: 'drift' });
      sim.car.setForwardSpeed(60 * KMH, 3);
      let maxDrift = 0;
      sim.run(6, (t) => {
        if (t < 1) return { throttle: 0.5, steer: 0.0, steerIsAbsolute: true };
        return { throttle: 1, steer: 0.45, steerIsAbsolute: true };
      }, () => { maxDrift = Math.max(maxDrift, Math.abs(sim.car.driftAngle)); });
      return maxDrift;
    };
    const locked = await maxDriftFor('locked');
    expect(locked).toBeGreaterThan(0.25);
  });
});

describe('robustez', () => {
  it('entradas caóticas por 30 s mantêm todos os valores finitos e dentro de limites', async () => {
    const sim = await makeSim(driftTuning());
    let seed = 1234567;
    const rnd = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    let th = 0, br = 0, st = 0, hb = 0;
    let bad = '';
    sim.run(30, (t) => {
      if (Math.floor(t * 4) !== Math.floor((t - 1 / 120) * 4)) {
        th = rnd() < 0.5 ? 1 : 0;
        br = rnd() < 0.2 ? 1 : 0;
        st = (rnd() * 2 - 1) * (rnd() < 0.3 ? 1 : 0.4);
        hb = rnd() < 0.15 ? 1 : 0;
      }
      return { throttle: th, brake: br, steer: st, handbrake: hb, steerIsAbsolute: true, shiftUp: rnd() < 0.01, shiftDown: rnd() < 0.01 };
    }, () => {
      if (!finiteState(sim)) { bad = `não finito em t=${sim.t}`; return false; }
      const c = sim.car;
      if (c.rpm < 300 || c.rpm > 9600) { bad = `rpm ${c.rpm} em t=${sim.t}`; return false; }
      if (c.speedKmh > 400) { bad = `velocidade ${c.speedKmh}`; return false; }
      if (sim.pos().y > 3 || sim.pos().y < 0.1) { bad = `altura ${sim.pos().y} em t=${sim.t}`; return false; }
      if (c.wheels.some((w) => w.load < 0)) { bad = 'carga negativa'; return false; }
    });
    expect(bad).toBe('');
  });

  it('em superfície molhada o carro freia pior e converge ao mesmo comportamento sem NaN', async () => {
    const dist = async (surface: 'asphalt' | 'wet') => {
      const sim = await makeSim(defaultTuning(), { surface });
      sim.car.setForwardSpeed(100 * KMH, 4);
      const z0 = sim.pos().z;
      sim.run(10, () => ({ brake: 1 }), () => (sim.car.speed < 0.3 ? false : undefined));
      expect(finiteState(sim)).toBe(true);
      return Math.abs(sim.pos().z - z0);
    };
    expect(await dist('wet')).toBeGreaterThan(await dist('asphalt'));
  });
});

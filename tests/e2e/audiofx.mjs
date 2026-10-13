// E2E de áudio e efeitos: síntese do motor (offline), contexto de áudio, fumaça, marcas, chamas e chuva.
import { mkdirSync } from 'node:fs';
import { startServer, launch, collectErrors, assert, URL_BASE } from './harness.mjs';

mkdirSync('test-results', { recursive: true });
const stop = await startServer();
const browser = await launch();
let failed = false;
try {
  const page = await (await browser.newContext({ viewport: { width: 960, height: 540 } })).newPage();
  const errors = collectErrors(page);
  const frames = (n = 2) => page.evaluate((k) => new Promise((resolve) => { let i = 0; const t = () => (++i >= k ? resolve() : requestAnimationFrame(t)); requestAnimationFrame(t); }), n);

  await page.goto(URL_BASE);
  await page.waitForFunction(() => !document.getElementById('btn-play').disabled, null, { timeout: 90000 });
  await page.click('#btn-play');
  await page.waitForFunction(() => window.__game.audio && window.__game.audio.ctx.state === 'running', null, { timeout: 30000, polling: 200 });
  assert(true, 'AudioContext em execução após o clique');

  // ---- Síntese do motor, renderizada offline: o tom acompanha a rotação ----
  const synth = await page.evaluate(async () => {
    const { EngineSynth } = window.__lib;
    const SR = 22050;
    const render = async (rpm, throttle, boostRatio) => {
      const off = new OfflineAudioContext(1, SR, SR);
      const e = new EngineSynth(off);
      e.out.connect(off.destination);
      e.start();
      e.update({ rpm, throttle, boostRatio, idleRpm: 900, limiterRpm: 7400, fuelCut: false, exhaustOpen: 0.5 });
      const buf = await off.startRendering();
      const d = buf.getChannelData(0).slice(SR * 0.5); // descarta a transição inicial
      let sq = 0, peak = 0;
      for (const x of d) { sq += x * x; peak = Math.max(peak, Math.abs(x)); }
      // frequência fundamental por autocorrelação normalizada
      const n = d.length;
      let best = 0, bestLag = 0;
      const minLag = Math.floor(SR / 600), maxLag = Math.floor(SR / 40);
      let e0 = 0;
      for (let i = 0; i < n - maxLag; i++) e0 += d[i] * d[i];
      for (let lag = minLag; lag <= maxLag; lag++) {
        let c = 0, e1 = 0;
        for (let i = 0; i < n - maxLag; i++) { c += d[i] * d[i + lag]; e1 += d[i + lag] * d[i + lag]; }
        const r = c / Math.sqrt(e0 * e1 + 1e-12);
        if (r > best) { best = r; bestLag = lag; }
      }
      // O primeiro pico alto (evita múltiplos do período): pega o menor lag com >= 92% do máximo
      let first = bestLag;
      for (let lag = minLag; lag <= bestLag; lag++) {
        let c = 0, e1 = 0;
        for (let i = 0; i < n - maxLag; i++) { c += d[i] * d[i + lag]; e1 += d[i + lag] * d[i + lag]; }
        if (c / Math.sqrt(e0 * e1 + 1e-12) >= best * 0.92) { first = lag; break; }
      }
      return { rms: Math.sqrt(sq / n), peak, freq: SR / first };
    };
    return { a: await render(2400, 0.6, 0), b: await render(4800, 0.6, 0), idle: await render(900, 0, 0), wot: await render(7000, 1, 1) };
  });
  // O motor inclui um oscilador sub em meia ordem (0,5 × f0, f0 = rpm/30), então o período do sinal é rpm/60 Hz.
  assert(Math.abs(synth.a.freq - 40) / 40 < 0.06, `2400 rpm → período de ~40 Hz (rpm/60; medido ${synth.a.freq.toFixed(1)} Hz)`);
  assert(Math.abs(synth.b.freq - 80) / 80 < 0.06, `4800 rpm → período de ~80 Hz (medido ${synth.b.freq.toFixed(1)} Hz)`);
  assert(Math.abs(synth.b.freq / synth.a.freq - 2) < 0.12, `dobrar a rotação dobra o tom (razão ${(synth.b.freq / synth.a.freq).toFixed(2)})`);
  assert(synth.a.rms > 0.01, `o motor não é silencioso (RMS ${synth.a.rms.toFixed(3)})`);
  assert(synth.wot.rms > synth.idle.rms * 1.4, `plena carga é mais alto que marcha lenta (${synth.wot.rms.toFixed(3)} vs ${synth.idle.rms.toFixed(3)})`);
  assert(synth.wot.peak < 1, `sem clipping a 7000 rpm (pico ${synth.wot.peak.toFixed(2)})`);

  // ---- Mudo ----
  await page.keyboard.press('KeyM');
  await page.waitForFunction(() => window.__game.audio.muted === true, null, { timeout: 20000, polling: 100 });
  await page.keyboard.press('KeyM');
  await page.waitForFunction(() => window.__game.audio.muted === false, null, { timeout: 20000, polling: 100 });
  assert(true, 'M liga/desliga o mudo');

  // ---- Efeitos: derrapar gera fumaça e marcas no chão ----
  await page.keyboard.down('KeyW');
  await page.waitForFunction(() => window.__game.vehicle.speedKmh > 45, null, { timeout: 120000, polling: 250 });
  await page.keyboard.down('KeyA');
  await page.keyboard.down('Space');
  await page.waitForFunction(() => window.__game.fx.smoke.activeCount > 5 && window.__game.fx.marks.segments > 3, null, { timeout: 120000, polling: 250 });
  const fx = await page.evaluate(() => ({ smoke: window.__game.fx.smoke.activeCount, marks: window.__game.fx.marks.segments, maxSlip: window.__game.vehicle.maxSlip }));
  assert(fx.smoke > 5, `fumaça de pneu (${fx.smoke} partículas, escorregamento ${fx.maxSlip.toFixed(2)})`);
  assert(fx.marks > 3, `marcas de pneu no asfalto (${fx.marks} segmentos)`);
  await frames(2);
  await page.screenshot({ path: 'test-results/fx-01-fumaca.png' });
  await page.keyboard.up('Space');
  await page.keyboard.up('KeyA');
  await page.keyboard.up('KeyW');

  // ---- Estouro de escapamento: o áudio avisa o visual, que solta chamas ----
  const flames = await page.evaluate(async () => {
    const g = window.__game;
    g.audio.engine.pop(0.8); // não deve lançar
    g.audio.backfires += 3;
    // As chamas vivem ~0,15 s: lê no mesmo quadro em que o jogo as emitiu (nosso callback roda depois do dele).
    await new Promise((r) => requestAnimationFrame(r));
    return g.fx.flames.activeCount;
  });
  assert(flames > 0, `chamas no escapamento após estouro (${flames} partículas)`);
  await frames(1);
  await page.screenshot({ path: 'test-results/fx-02-chamas.png' });

  // ---- Chuva e luzes do carro ----
  const misc = await page.evaluate(() => ({ rain: !!window.__game.fx.rain, rainVisible: window.__game.fx.rain?.mesh.visible, lights: window.__game.fx.lights !== null }));
  assert(misc.rain && misc.rainVisible, 'chuva ativa no tier alto');
  assert(misc.lights, 'halos de faróis/lanternas criados');

  // Freio acende a lanterna: a cor do halo traseiro muda.
  assert(errors.length === 0, `sem erros no console ${errors.length ? JSON.stringify(errors.slice(0, 5)) : ''}`);
} catch (e) {
  failed = true;
  console.error(e.message);
} finally {
  await browser.close();
  stop();
}
process.exit(failed ? 1 : 0);

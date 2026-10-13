import { mkdirSync } from 'node:fs';
import { startServer, launch, collectErrors, assert, URL_BASE } from './harness.mjs';

mkdirSync('test-results', { recursive: true });
const stop = await startServer();
const browser = await launch();
let failed = false;
try {
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
  const errors = collectErrors(page);
  await page.goto(URL_BASE);
  await page.waitForFunction(() => !document.getElementById('btn-play').disabled, null, { timeout: 60000 });
  await page.click('#btn-play');
  await page.waitForTimeout(1500);

  // 1) Canvas não está em branco: renderiza e lê uma grade de pixels.
  const variance = await page.evaluate(() => {
    const g = window.__game;
    const r = g.ctx.renderer;
    r.render(g.ctx.scene, g.ctx.camera);
    const gl = r.getContext();
    const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
    const px = new Uint8Array(4);
    const vals = [];
    for (let i = 0; i < 24; i++) for (let j = 0; j < 14; j++) {
      gl.readPixels(Math.floor((i + 0.5) * w / 24), Math.floor((j + 0.5) * h / 14), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      vals.push((px[0] + px[1] + px[2]) / 3);
    }
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    return Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length);
  });
  assert(variance > 3, `canvas não está em branco (desvio ${variance.toFixed(1)})`);
  await page.screenshot({ path: 'test-results/01-parado.png' });

  // 2) Acelerar com W: a velocidade do HUD sobe.
  await page.keyboard.down('KeyW');
  await page.waitForFunction(() => window.__game.vehicle.speedKmh > 60, null, { timeout: 90000, polling: 250 });
  const kmh = await page.evaluate(() => window.__game.vehicle.speedKmh);
  assert(kmh > 60, `acelerou até ${kmh.toFixed(0)} km/h`);
  await page.screenshot({ path: 'test-results/02-chase.png' });
  const hud = await page.textContent('#spd');
  assert(Number(hud) > 0, `HUD mostra a velocidade (${hud})`);

  // 3) Curva com A e freio de mão: derrapa, câmera de perseguição acompanha.
  await page.keyboard.down('KeyA');
  await page.waitForTimeout(1200);
  await page.keyboard.down('Space');
  await page.waitForTimeout(900);
  await page.screenshot({ path: 'test-results/03-drift.png' });
  await page.keyboard.up('Space');
  await page.keyboard.up('KeyA');
  await page.keyboard.up('KeyW');

  // 4) Trocar de câmera (C) e ver o cockpit.
  await page.keyboard.press('KeyC'); // far
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'test-results/04-far.png' });
  await page.keyboard.press('KeyC'); // hood
  await page.waitForTimeout(400);
  const modeHood = await page.evaluate(() => window.__game.cameras.mode);
  assert(modeHood === 'hood', `C alterna a câmera (${modeHood})`);
  await page.keyboard.press('KeyC'); // cockpit
  await page.waitForTimeout(400);
  const modeCockpit = await page.evaluate(() => window.__game.cameras.mode);
  assert(modeCockpit === 'cockpit', `C chega ao cockpit (${modeCockpit})`);
  await page.screenshot({ path: 'test-results/05-cockpit.png' });

  // 5) Close-ups da câmera orbital (a mesma que a garagem vai usar).
  for (const [name, az, el] of [['06-orbit-34', 0.7, 0.2], ['07-orbit-lado', 1.57, 0.05], ['08-orbit-traseira', 3.0, 0.15]]) {
    await page.evaluate(([a, e]) => {
      const g = window.__game;
      g.resetCar();
      g.cameras.mode = 'orbit';
      g.cameras.orbit = { azimuth: a, elevation: e, distance: 6.5 };
    }, [az, el]);
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `test-results/${name}.png` });
  }

  const info = await page.evaluate(() => {
    const r = window.__game.ctx.renderer.info;
    return { calls: r.render.calls, tris: r.render.triangles };
  });
  console.log(`info: ${info.calls} draw calls, ${info.tris} triângulos`);
  assert(errors.length === 0, `sem erros no console ${errors.length ? JSON.stringify(errors.slice(0, 5)) : ''}`);
} catch (e) {
  failed = true;
  console.error(e.message);
} finally {
  await browser.close();
  stop();
}
process.exit(failed ? 1 : 0);

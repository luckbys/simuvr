import { mkdirSync } from 'node:fs';
import { startServer, launch, collectErrors, assert, URL_BASE } from './harness.mjs';

mkdirSync('test-results', { recursive: true });
const stop = await startServer();
const browser = await launch();
let failed = false;
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = collectErrors(page);
  await page.goto(URL_BASE);
  await page.waitForFunction(() => !document.getElementById('btn-play').disabled, null, { timeout: 30000 });
  await page.click('#btn-play');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'test-results/smoke.png' });

  const stats = await page.evaluate(() => {
    const g = window.__game;
    const c = g.ctx.renderer.domElement;
    return { w: c.width, h: c.height, calls: g.ctx.renderer.info.render.calls };
  });
  assert(stats.w > 0 && stats.h > 0, `canvas com tamanho (${stats.w}x${stats.h})`);
  assert(stats.calls > 0, `draw calls > 0 (${stats.calls})`);
  assert(errors.length === 0, `sem erros no console ${errors.length ? JSON.stringify(errors) : ''}`);
} catch (e) {
  failed = true;
  console.error(e.message);
} finally {
  await browser.close();
  stop();
}
process.exit(failed ? 1 : 0);

// E2E dos tiers de qualidade: o tier baixo (Quest) precisa ser mais leve e sem recursos caros.
import { mkdirSync } from 'node:fs';
import { startServer, launch, collectErrors, assert, URL_BASE } from './harness.mjs';

mkdirSync('test-results', { recursive: true });
const stop = await startServer();
const browser = await launch();
let failed = false;
try {
  const measure = async (q) => {
    const page = await (await browser.newContext({ viewport: { width: 960, height: 540 } })).newPage();
    const errors = collectErrors(page);
    await page.goto(`${URL_BASE}?q=${q}`);
    await page.waitForFunction(() => !document.getElementById('btn-play').disabled, null, { timeout: 90000 });
    await page.click('#btn-play');
    await page.waitForFunction(() => window.__game.debug.summary && window.__game.ctx.renderer.info.render.calls > 0, null, { timeout: 60000, polling: 250 });
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    const r = await page.evaluate(() => {
      const g = window.__game;
      let spots = 0, physical = 0, lights = 0;
      g.ctx.scene.traverse((o) => {
        if (o.isSpotLight) spots++;
        if (o.isLight) lights++;
        if (o.material && o.material.isMeshPhysicalMaterial) physical++;
      });
      // render isolado para medir o quadro mono (sem retrovisor)
      const rr = g.ctx.renderer;
      rr.info.reset();
      rr.render(g.ctx.scene, g.ctx.camera);
      return {
        name: g.quality.name, calls: rr.info.render.calls, tris: rr.info.render.triangles, spots, lights, physical,
        mirror: !!g.cockpit.mirror, rain: !!g.fx.rain, smokeMax: g.fx.smoke.mesh.count,
        geometries: rr.info.memory.geometries, textures: rr.info.memory.textures,
      };
    });
    await page.close();
    return { r, errors };
  };

  const low = await measure('low');
  const high = await measure('high');
  console.log(`baixo: ${JSON.stringify(low.r)}`);
  console.log(`alto : ${JSON.stringify(high.r)}`);

  assert(low.r.name === 'low' && high.r.name === 'high', 'os dois tiers carregam');
  assert(low.r.spots === 0 && high.r.spots === 2, `faróis reais só no alto (baixo ${low.r.spots}, alto ${high.r.spots})`);
  assert(low.r.lights < high.r.lights, `menos luzes no baixo (${low.r.lights} vs ${high.r.lights})`);
  assert(low.r.physical === 0 && high.r.physical > 0, `verniz (material físico) só no alto (${low.r.physical} vs ${high.r.physical})`);
  assert(!low.r.mirror && high.r.mirror, 'retrovisor só no alto');
  assert(!low.r.rain && high.r.rain, 'chuva só no alto');
  assert(low.r.smokeMax < high.r.smokeMax, `menos fumaça no baixo (${low.r.smokeMax} vs ${high.r.smokeMax})`);
  assert(low.r.tris < high.r.tris, `menos triângulos no baixo (${low.r.tris} vs ${high.r.tris})`);

  // Orçamento do Quest (tier baixo, quadro mono): metas do plano.
  assert(low.r.calls <= 90, `tier baixo ≤ 90 draw calls (${low.r.calls})`);
  assert(low.r.tris <= 350000, `tier baixo ≤ 350 mil triângulos (${low.r.tris})`);
  assert(high.r.calls <= 130, `tier alto ≤ 130 draw calls (${high.r.calls})`);
  assert(low.errors.length === 0 && high.errors.length === 0, `sem erros no console ${JSON.stringify([...low.errors, ...high.errors].slice(0, 4))}`);
} catch (e) {
  failed = true;
  console.error(e.message);
} finally {
  await browser.close();
  stop();
}
process.exit(failed ? 1 : 0);

// E2E da garagem de tuning (PC): abre, aplica predefinição, altera controles, persiste.
import { mkdirSync } from 'node:fs';
import { startServer, launch, collectErrors, assert, URL_BASE } from './harness.mjs';

mkdirSync('test-results', { recursive: true });
const stop = await startServer();
const browser = await launch();
let failed = false;
try {
  const context = await browser.newContext({ viewport: { width: 1100, height: 640 } });
  const page = await context.newPage();
  const errors = collectErrors(page);
  const start = async () => {
    await page.goto(URL_BASE);
    await page.waitForFunction(() => !document.getElementById('btn-play').disabled, null, { timeout: 90000 });
    await page.click('#btn-play');
  };
  const frames = (n = 2) => page.evaluate((k) => new Promise((resolve) => { let i = 0; const t = () => (++i >= k ? resolve() : requestAnimationFrame(t)); requestAnimationFrame(t); }), n);

  await start();
  await page.keyboard.press('KeyG');
  await page.waitForFunction(() => window.__game.garage.open, null, { timeout: 30000, polling: 100 });
  assert(true, 'G abre a garagem');
  assert(await page.isVisible('#garage'), 'painel da garagem visível');
  await page.waitForFunction(() => window.__game.cameras.mode === 'orbit', null, { timeout: 30000, polling: 100 });
  assert(true, 'câmera passa para o modo orbital');
  await frames(3);
  await page.screenshot({ path: 'test-results/garage-01-aberta.png' });

  // Predefinição Drift: muda tuning e visual e reaplica a física.
  const before = await page.evaluate(() => ({ mass: window.__game.vehicle.params.mass, diff: window.__game.vehicle.params.diffType }));
  await page.click('#garage .chip:has-text("Drift")');
  await page.waitForFunction(() => window.__game.vehicle.params.diffType === 'locked', null, { timeout: 30000, polling: 100 });
  const after = await page.evaluate(() => {
    const g = window.__game;
    return { mass: g.vehicle.params.mass, diff: g.vehicle.params.diffType, paint: g.carView.look.paint, spoiler: g.carView.look.spoiler, boost: g.vehicle.params.engine.turbo.maxBoost };
  });
  assert(before.diff === 'open' && after.diff === 'locked', `predefinição Drift trava o diferencial (${before.diff} → ${after.diff})`);
  assert(after.mass < before.mass, `redução de peso aplicada (${before.mass} → ${after.mass} kg)`);
  assert(after.paint === '#7a5cff' && after.spoiler === 'gt', 'visual da predefinição aplicado (pintura e aerofólio)');
  assert(after.boost > 0.85, `turbo mais forte (${after.boost.toFixed(2)} bar)`);

  // Aba Motor → turbo de competição.
  await page.click('#garage .tab:has-text("Motor")');
  await page.click('#garage .seg button:has-text("Competição")');
  await page.waitForFunction(() => window.__game.vehicle.params.engine.turbo.maxBoost > 1.5, null, { timeout: 30000, polling: 100 });
  assert(true, 'turbo de competição aplicado ao vivo');
  const hp = await page.evaluate(() => window.__game.garage.stats().peakPowerHp);
  assert(hp > 300, `estatísticas atualizam (${hp.toFixed(0)} cv)`);
  assert((await page.textContent('#garage .stats')).includes('cv'), 'painel de estatísticas mostra a potência');

  // Aba Altura → slider de rebaixamento move a altura do carro.
  await page.click('#garage .tab:has-text("Altura")');
  const h0 = await page.evaluate(() => window.__game.vehicle.params.comHeightStatic);
  await page.evaluate(() => {
    const input = document.querySelector('#garage .ctl input[type=range]');
    input.value = '0.07';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForFunction((h) => window.__game.vehicle.params.comHeightStatic < h - 0.02, h0, { timeout: 30000, polling: 100 });
  assert(true, 'slider de rebaixamento abaixa o carro');
  await page.click('#garage .tab:has-text("Visual")');
  await page.click('#garage .controls .ctl:first-child .sw:nth-child(3)');
  await page.waitForFunction(() => window.__game.carView.look.paint === '#ffb02f', null, { timeout: 30000, polling: 100 });
  assert(true, 'amostra de cor muda a pintura');
  await frames(3);
  await page.screenshot({ path: 'test-results/garage-02-tuning.png' });

  // Com a garagem aberta, W não move o carro.
  await page.keyboard.down('KeyW');
  await frames(6);
  const thr = await page.evaluate(() => window.__game.vehicle.throttle);
  await page.keyboard.up('KeyW');
  assert(thr === 0, 'carro fica parado com a garagem aberta');

  // G fecha (mesmo com o teclado desligado).
  await page.keyboard.press('KeyG');
  await page.waitForFunction(() => !window.__game.garage.open, null, { timeout: 30000, polling: 100 });
  assert(true, 'G fecha a garagem');

  // Persistência: recarrega a página e confere o estado salvo.
  const saved = await page.evaluate(() => window.__game.garage.state);
  await start();
  const restored = await page.evaluate(() => ({ tuning: window.__game.garage.state.tuning, paint: window.__game.carView.look.paint, boost: window.__game.vehicle.params.engine.turbo.maxBoost }));
  assert(restored.tuning.turbo === saved.tuning.turbo && restored.tuning.turbo === 'race', 'tuning restaurado após recarregar');
  assert(restored.paint === '#ffb02f', 'pintura restaurada após recarregar');
  assert(restored.boost > 1.5, 'a física usa o tuning restaurado');
  await frames(3);
  await page.screenshot({ path: 'test-results/garage-03-restaurado.png' });
  assert(errors.length === 0, `sem erros no console ${errors.length ? JSON.stringify(errors.slice(0, 5)) : ''}`);
} catch (e) {
  failed = true;
  console.error(e.message);
} finally {
  await browser.close();
  stop();
}
process.exit(failed ? 1 : 0);

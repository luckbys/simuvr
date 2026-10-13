// E2E de VR: emula um Meta Quest 3 (IWER) no Chromium headless e dirige com controles virtuais.
import { mkdirSync } from 'node:fs';
import { startServer, launch, collectErrors, assert, URL_BASE } from './harness.mjs';

mkdirSync('test-results', { recursive: true });
const stop = await startServer();
const browser = await launch();
let failed = false;
try {
  const ctx = await browser.newContext({ viewport: { width: 960, height: 540 } });
  const page = await ctx.newPage();
  const errors = collectErrors(page);
  await page.addInitScript({ path: 'node_modules/iwer/build/iwer.js' });
  await page.addInitScript(() => {
    const { XRDevice, metaQuest3 } = window.IWER;
    const dev = new XRDevice(metaQuest3);
    dev.installRuntime({ forceInstall: true });
    dev.position.set(0, 1.1, 0); // sentado
    window.__xr = dev;
  });

  await page.goto(URL_BASE);
  await page.waitForFunction(() => !document.getElementById('btn-vr').disabled, null, { timeout: 90000 });
  assert(true, 'WebXR emulado detectado (botão "Entrar em VR" habilitado)');

  await page.click('#btn-vr');
  await page.waitForFunction(() => window.__game.ctx.renderer.xr.isPresenting === true && window.__game.vr, null, { timeout: 60000 });
  assert(true, 'sessão immersive-vr ativa');
  await page.waitForFunction(() => window.__game.vr.seated, null, { timeout: 60000, polling: 200 });
  assert(true, 'banco do motorista calibrado (recentrar automático)');

  // A cabeça está nos olhos do motorista.
  const eyeErr = await page.evaluate(() => {
    const g = window.__game;
    const cam = g.ctx.camera;
    const w = cam.getWorldPosition(cam.position.clone());
    const eye = g.carView.driverEye.clone();
    g.carView.root.updateMatrixWorld(true);
    g.carView.root.localToWorld(eye);
    return w.distanceTo(eye);
  });
  assert(eyeErr < 0.08, `cabeça nos olhos do motorista (erro ${(eyeErr * 100).toFixed(1)} cm)`);

  // ---- Gatilho direito = acelerador ----
  await page.evaluate(() => window.__xr.controllers.right.updateButtonValue('trigger', 1));
  await page.waitForFunction(() => window.__game.vehicle.throttle > 0.9, null, { timeout: 30000, polling: 100 });
  assert(true, 'gatilho direito → acelerador');
  await page.waitForFunction(() => window.__game.vehicle.speedKmh > 15, null, { timeout: 90000, polling: 250 });
  assert(true, 'o carro acelera em VR');
  await page.evaluate(() => window.__xr.controllers.right.updateButtonValue('trigger', 0));

  // ---- Volante: mão direita agarra o aro e gira 60° ----
  const wheelAngleDeg = await page.evaluate(async () => {
    const g = window.__game, vr = g.vr, dev = window.__xr;
    const f = g.carView.wheelFrame;
    const THREE_V = g.carView.root.position.constructor; // THREE.Vector3
    const rim = (deg) => {
      const a = (deg * Math.PI) / 180;
      const p = new THREE_V().copy(f.center)
        .addScaledVector(f.right, Math.sin(a) * f.radius)
        .addScaledVector(f.up, Math.cos(a) * f.radius);
      return vr.carLocalToRef(p, new THREE_V());
    };
    const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const waitFrames = async (n) => { for (let i = 0; i < n; i++) await frame(); };
    // O IWER desloca o espaço "grip" do ponto do controle; compensa para que a MÃO (grip) fique no aro.
    const off = new THREE_V();
    const setHand = (deg) => { const p = rim(deg).sub(off); dev.controllers.right.position.set(p.x, p.y, p.z); };
    setHand(0);
    await waitFrames(3);
    const grip = new THREE_V();
    vr.gripRef('right', grip);
    const p0 = dev.controllers.right.position;
    off.set(grip.x - p0.x, grip.y - p0.y, grip.z - p0.z);
    setHand(0);
    await waitFrames(3);
    dev.controllers.right.updateButtonValue('squeeze', 1);
    await waitFrames(3);
    if (!vr.wheel.heldBy('right')) return { held: false };
    for (let d = 10; d <= 60; d += 10) { setHand(d); await waitFrames(2); }
    await waitFrames(3);
    return { held: true, angle: (vr.wheel.angle * 180) / Math.PI, steer: g.vehicle.steerNorm };
  });
  assert(wheelAngleDeg.held, 'grip perto do aro agarra o volante');
  assert(Math.abs(wheelAngleDeg.angle - 60) < 5, `girar a mão 60° no aro gira o volante (${wheelAngleDeg.angle.toFixed(1)}°)`);
  assert(wheelAngleDeg.steer > 0.2, `o esterço do carro acompanha o volante (${wheelAngleDeg.steer.toFixed(2)})`);
  await page.screenshot({ path: 'test-results/vr-01-volante.png' });

  // Soltar o grip: o volante solta e volta ao centro com o carro em movimento.
  await page.evaluate(() => window.__xr.controllers.right.updateButtonValue('squeeze', 0));
  await page.waitForFunction(() => !window.__game.vr.wheel.heldBy('right'), null, { timeout: 20000, polling: 100 });
  assert(true, 'soltar o grip solta o volante');

  // ---- Menu: Y abre; apontar e apertar o gatilho em "Manual" troca o câmbio ----
  // Quadros lentos (software): mantém o botão apertado por alguns quadros para ser amostrado.
  const holdFrames = (fn, n) => page.evaluate(async ([name, k]) => {
    const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    window.__xr.controllers.left.updateButtonValue(name, 1);
    for (let i = 0; i < k; i++) await frame();
    window.__xr.controllers.left.updateButtonValue(name, 0);
    for (let i = 0; i < 3; i++) await frame();
  }, [fn, n]);
  await holdFrames('y-button', 1);
  await page.waitForFunction(() => window.__game.vr.menuOpen, null, { timeout: 20000, polling: 100 });
  assert(true, 'Y (toque) abre o menu');

  // Auxiliar: aponta o raio do controle direito para um item de painel e aperta o gatilho.
  await page.evaluate(() => {
    window.__aimClick = async (panelKey, row, item) => {
      const g = window.__game, vr = g.vr, dev = window.__xr;
      const panel = vr[panelKey];
      const V = g.carView.root.position.constructor;
      const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const target = new V();
      panel.mesh.updateMatrixWorld(true);
      if (!panel.worldPointOfItem(row, item, target)) return { ok: false, why: `sem item ${row}/${item}` };
      // origem a 0,5 m na frente do painel (normal local +Z); o raio aponta para o item
      const normal = new V(0, 0, 1).transformDirection(panel.mesh.matrixWorld);
      const origin = target.clone().addScaledVector(normal, 0.5);
      const dir = target.clone().sub(origin).normalize();
      const from = new V(0, 0, -1);
      const axis = from.clone().cross(dir);
      const angle = Math.acos(Math.max(-1, Math.min(1, from.dot(dir))));
      const q = { x: 0, y: 0, z: 0, w: 1 };
      if (axis.length() > 1e-6) {
        axis.normalize();
        const s2 = Math.sin(angle / 2);
        q.x = axis.x * s2; q.y = axis.y * s2; q.z = axis.z * s2; q.w = Math.cos(angle / 2);
      }
      const dolly = vr.dolly;
      dolly.updateMatrixWorld(true);
      const pRef = origin.clone().applyMatrix4(dolly.matrixWorld.clone().invert());
      dev.controllers.right.position.set(pRef.x, pRef.y, pRef.z);
      const dq = dolly.getWorldQuaternion(dolly.quaternion.clone()).invert();
      const qRef = new dolly.quaternion.constructor(q.x, q.y, q.z, q.w).premultiply(dq);
      dev.controllers.right.quaternion.set(qRef.x, qRef.y, qRef.z, qRef.w);
      for (let i = 0; i < 3; i++) await frame();
      dev.controllers.right.updateButtonValue('trigger', 1);
      for (let i = 0; i < 3; i++) await frame();
      dev.controllers.right.updateButtonValue('trigger', 0);
      for (let i = 0; i < 3; i++) await frame();
      return { ok: true };
    };
  });
  const aim = (panel, row, item) => page.evaluate(([p, r, i]) => window.__aimClick(p, r, i), [panel, row, item]);
  const rowOf = (panel, type, text) => page.evaluate(([p, t, x]) => window.__game.vr[p].findRow(t, x), [panel, type, text]);

  const manualRow = await rowOf('menu', 'segments', 'Manual');
  const clicked = await aim('menu', manualRow, 1);
  assert(clicked.ok, 'raio do controle acerta o botão do menu');
  assert(await page.evaluate(() => window.__game.vehicle.options.autoGear === false), 'clique no menu troca o câmbio para manual');
  await page.screenshot({ path: 'test-results/vr-02-menu.png' });

  // ---- Garagem em VR: abre pelo menu, aplica a predefinição Drift e altera um slider ----
  const garageRow = await rowOf('menu', 'button', 'Garagem de tuning');
  const g1 = await aim('menu', garageRow, 0);
  assert(g1.ok, 'raio acerta "Garagem de tuning"');
  await page.waitForFunction(() => window.__game.garage.open && window.__game.vr.garagePanelOpen && window.__game.vr.garagePanel.mesh.visible, null, { timeout: 30000, polling: 100 });
  assert(true, 'garagem abre em VR (painel visível)');
  assert(await page.evaluate(() => !window.__game.vr.menuOpen), 'o menu fecha ao abrir a garagem');

  const driftRow = await rowOf('garagePanel', 'segments', 'Drift');
  const dr = await aim('garagePanel', driftRow, 1);
  assert(dr.ok, 'raio acerta a predefinição Drift');
  await page.waitForFunction(() => window.__game.vehicle.params.diffType === 'locked', null, { timeout: 30000, polling: 100 });
  assert(true, 'predefinição Drift em VR trava o diferencial');
  assert(await page.evaluate(() => window.__game.carView.look.paint === '#7a5cff'), 'visual da predefinição aplicado em VR');

  // Aba Motor e turbo de competição.
  const motorRow = await rowOf('garagePanel', 'segments', 'Motor');
  const motorItem = await page.evaluate((r) => window.__game.vr.garagePanel.rows[r].items.findIndex((i) => (typeof i.text === 'function' ? i.text() : i.text) === 'Motor'), motorRow);
  await aim('garagePanel', motorRow, motorItem);
  await page.waitForFunction(() => window.__game.garage.tab === 4, null, { timeout: 30000, polling: 100 });
  const raceRow = await rowOf('garagePanel', 'segments', 'Competição');
  const raceItem = await page.evaluate((r) => window.__game.vr.garagePanel.rows[r].items.findIndex((i) => (typeof i.text === 'function' ? i.text() : i.text) === 'Competição'), raceRow);
  await aim('garagePanel', raceRow, raceItem);
  await page.waitForFunction(() => window.__game.vehicle.params.engine.turbo.maxBoost > 1.5, null, { timeout: 30000, polling: 100 });
  assert(true, 'turbo de competição em VR');
  await page.screenshot({ path: 'test-results/vr-03-garagem.png' });

  // Y fecha a garagem.
  await holdFrames('y-button', 1);
  await page.waitForFunction(() => !window.__game.garage.open && !window.__game.vr.garagePanelOpen, null, { timeout: 30000, polling: 100 });
  assert(true, 'Y fecha a garagem');

  assert(errors.length === 0, `sem erros no console ${errors.length ? JSON.stringify(errors.slice(0, 5)) : ''}`);
} catch (e) {
  failed = true;
  console.error(e.message);
} finally {
  await browser.close();
  stop();
}
process.exit(failed ? 1 : 0);

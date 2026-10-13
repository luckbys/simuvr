// E2E de VR a pé: sair do carro, giro em passos, andar suave, teleporte em arco e entrar de novo.
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
    dev.position.set(0, 1.1, 0);
    window.__xr = dev;
  });

  await page.goto(URL_BASE + '?q=low');
  await page.waitForFunction(() => !document.getElementById('btn-vr').disabled, null, { timeout: 90000 });
  await page.click('#btn-vr');
  await page.waitForFunction(() => window.__game.vr?.seated, null, { timeout: 90000, polling: 200 });
  assert(true, 'sentado no carro em VR (tier baixo)');

  const frames = (n = 2) => page.evaluate(async (k) => {
    for (let i = 0; i < k; i++) await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  }, n);

  // ---- Sair do carro: segurar Y ----
  const carStart = await page.evaluate(() => { const p = window.__game.carView.root.position; return { x: p.x, z: p.z }; });
  await page.evaluate(() => window.__xr.controllers.left.updateButtonValue('y-button', 1));
  await page.waitForFunction(() => window.__game.vr.state === 'walking', null, { timeout: 120000, polling: 250 });
  await page.evaluate(() => window.__xr.controllers.left.updateButtonValue('y-button', 0));
  await frames(3);
  assert(true, 'segurar Y por 1 s sai do carro');
  const afterExit = await page.evaluate(() => {
    const g = window.__game;
    const head = g.ctx.camera.getWorldPosition(g.ctx.camera.position.clone());
    const car = g.carView.root.position;
    return { dist: Math.hypot(head.x - car.x, head.z - car.z), headY: head.y, menu: g.vr.menuOpen, handbrake: g.vehicle.speedKmh };
  });
  assert(afterExit.dist > 1.2 && afterExit.dist < 3.2, `fica ao lado da porta (${afterExit.dist.toFixed(2)} m do carro)`);
  assert(afterExit.headY > 0.8 && afterExit.headY < 1.6, `a cabeça está na altura certa (${afterExit.headY.toFixed(2)} m)`);
  assert(!afterExit.menu, 'o menu não abre ao segurar Y (só no toque curto)');
  await page.screenshot({ path: 'test-results/vrwalk-01-fora.png' });

  // ---- Giro em passos: stick direito para o lado ----
  const yaw0 = await page.evaluate(() => window.__game.vr.walkYaw);
  await page.evaluate(() => window.__xr.controllers.right.updateAxes('thumbstick', 1, 0));
  await page.waitForFunction((y0) => Math.abs(window.__game.vr.walkYaw - y0) > 0.3, yaw0, { timeout: 60000, polling: 200 });
  await page.evaluate(() => window.__xr.controllers.right.updateAxes('thumbstick', 0, 0));
  await frames(2);
  const yaw1 = await page.evaluate(() => window.__game.vr.walkYaw);
  const turned = ((yaw1 - yaw0) * 180) / Math.PI;
  assert(Math.abs(Math.abs(turned) - 30) < 2, `giro em passos de 30° (${turned.toFixed(1)}°)`);

  // ---- Andar suave: stick esquerdo para trás (afastando-se do carro, que bloqueia a frente) ----
  const w0 = await page.evaluate(() => ({ x: window.__game.vr.walkPos.x, z: window.__game.vr.walkPos.z }));
  await page.evaluate(() => window.__xr.controllers.left.updateAxes('thumbstick', 0, 1));
  await page.waitForFunction((p0) => Math.hypot(window.__game.vr.walkPos.x - p0.x, window.__game.vr.walkPos.z - p0.z) > 0.5, w0, { timeout: 90000, polling: 250 });
  await page.evaluate(() => window.__xr.controllers.left.updateAxes('thumbstick', 0, 0));
  assert(true, 'stick esquerdo anda (para trás, afastando-se do carro)');

  // ---- O carro é um obstáculo: andar para a frente (em direção a ele) para antes de entrar nele ----
  const blocked = await page.evaluate(async () => {
    const g = window.__game, vr = g.vr, dev = window.__xr;
    const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const car = g.carView.root.position;
    // vira de frente para o carro: yaw do dolly aponta o -Z para o carro (a cabeça física está de frente)
    const dx = car.x - vr.walkPos.x, dz = car.z - vr.walkPos.z;
    vr.walkYaw = Math.atan2(-dx, -dz);
    dev.controllers.left.updateAxes('thumbstick', 0, -1);
    for (let i = 0; i < 40; i++) await frame();
    dev.controllers.left.updateAxes('thumbstick', 0, 0);
    return Math.hypot(vr.walkPos.x - car.x, vr.walkPos.z - car.z);
  });
  assert(blocked > 1.35, `o carro é obstáculo (parou a ${blocked.toFixed(2)} m do centro)`);

  // ---- Teleporte: aponta o controle direito para o chão à frente e empurra o stick ----
  const tp = await page.evaluate(async () => {
    const g = window.__game, vr = g.vr, dev = window.__xr;
    const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    // Aponta para longe do carro (o alvo a menos de 1,6 m do carro é inválido, e ao sair o jogador olha para ele),
    // ~6° para baixo. A orientação é montada em coordenadas do mundo e trazida ao espaço de referência do headset.
    const Q = g.carView.root.quaternion.constructor;
    const E = g.ctx.camera.rotation.constructor;
    const V = g.carView.root.position.constructor;
    const head0 = g.ctx.camera.getWorldPosition(new V());
    const away = head0.clone().sub(g.carView.root.position);
    away.y = 0;
    away.normalize();
    const yawW = Math.atan2(-away.x, -away.z);
    const qWorld = new Q().setFromEuler(new E(-0.1, yawW, 0, 'YXZ'));
    const qRef = vr.dolly.getWorldQuaternion(new Q()).invert().multiply(qWorld);
    dev.controllers.right.position.set(0.2, 1.0, -0.2);
    dev.controllers.right.quaternion.set(qRef.x, qRef.y, qRef.z, qRef.w);
    const before = g.ctx.camera.getWorldPosition(g.ctx.camera.position.clone());
    dev.controllers.right.updateAxes('thumbstick', 0, -1);
    for (let i = 0; i < 4; i++) await frame();
    const arcVisible = vr.arc.visible;
    const valid = vr.teleportValid;
    const target = vr.teleportTarget ? { x: vr.teleportTarget.x, z: vr.teleportTarget.z } : null;
    dev.controllers.right.updateAxes('thumbstick', 0, 0);
    for (let i = 0; i < 4; i++) await frame();
    const after = g.ctx.camera.getWorldPosition(g.ctx.camera.position.clone());
    return { arcVisible, valid, target, moved: Math.hypot(after.x - before.x, after.z - before.z), after: { x: after.x, z: after.z } };
  });
  assert(tp.arcVisible, 'o arco do teleporte aparece ao empurrar o stick');
  assert(tp.valid && tp.target, 'o alvo do teleporte é válido (chão livre)');
  assert(tp.moved > 2.5, `soltar o stick teleporta (${tp.moved.toFixed(1)} m)`);
  assert(Math.hypot(tp.after.x - tp.target.x, tp.after.z - tp.target.z) < 0.6, 'a cabeça cai sobre o alvo do arco');
  await page.screenshot({ path: 'test-results/vrwalk-02-teleporte.png' });

  // ---- Perto do carro: dica e entrar com A ----
  await page.evaluate(() => {
    const g = window.__game, vr = g.vr, root = g.carView.root;
    // posiciona a cabeça junto da porta esquerda (como se tivesse caminhado até lá)
    const door = new root.position.constructor(-1.6, 0, 0.1).applyQuaternion(root.quaternion).add(root.position);
    const head = g.ctx.camera.getWorldPosition(g.ctx.camera.position.clone());
    vr.walkPos.x += door.x - head.x;
    vr.walkPos.z += door.z - head.z;
  });
  await frames(3);
  assert(await page.evaluate(() => window.__game.vr.hint.mesh.visible), 'a dica "A · entrar no carro" aparece junto da porta');
  await page.evaluate(() => window.__xr.controllers.right.updateButtonValue('a-button', 1));
  await page.waitForFunction(() => window.__game.vr.state === 'driving', null, { timeout: 60000, polling: 200 });
  await page.evaluate(() => window.__xr.controllers.right.updateButtonValue('a-button', 0));
  await frames(3);
  assert(true, 'A perto da porta entra no carro');
  const seat = await page.evaluate(() => {
    const g = window.__game;
    const cam = g.ctx.camera;
    const w = cam.getWorldPosition(cam.position.clone());
    const eye = g.carView.driverEye.clone();
    g.carView.root.updateMatrixWorld(true);
    g.carView.root.localToWorld(eye);
    return w.distanceTo(eye);
  });
  assert(seat < 0.1, `ao entrar o banco é recalibrado nos olhos do motorista (erro ${(seat * 100).toFixed(1)} cm)`);
  await page.screenshot({ path: 'test-results/vrwalk-03-dentro.png' });

  assert(errors.length === 0, `sem erros no console ${errors.length ? JSON.stringify(errors.slice(0, 5)) : ''}`);
} catch (e) {
  failed = true;
  console.error(e.message);
} finally {
  await browser.close();
  stop();
}
process.exit(failed ? 1 : 0);

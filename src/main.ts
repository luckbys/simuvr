import { Game } from './game';
import { saveQuality, storedQuality } from './core/quality';
import { GarageUi } from './ui/garageUi';
import { EngineSynth } from './audio/engineSynth';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

async function boot(): Promise<void> {
  const status = $('status');
  const play = $<HTMLButtonElement>('btn-play');
  const vr = $<HTMLButtonElement>('btn-vr');
  const start = $('start');

  // Seletor de qualidade: grava a escolha e recarrega (o tier define geometria, luzes e materiais).
  const qsel = $<HTMLSelectElement>('quality');
  qsel.value = storedQuality() ?? 'auto';
  qsel.addEventListener('change', () => {
    saveQuality(qsel.value === 'auto' ? null : (qsel.value as 'low' | 'high'));
    location.href = location.pathname; // sem ?q= para valer a escolha salva
  });

  // A construção da cidade ocupa a thread por ~1 s: avisa e cede um quadro para a mensagem aparecer.
  status.textContent = 'Construindo a cidade…';
  await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
  const game = await Game.create($('app'));
  (window as unknown as { __game: Game }).__game = game;
  new GarageUi(game);
  // Ganchos para os testes E2E (renderização offline do motor).
  (window as unknown as { __lib: unknown }).__lib = { EngineSynth };

  const xrState = await game.xr.detect();
  vr.disabled = xrState !== 'available';
  vr.title = xrState === 'available' ? '' : 'WebXR não disponível neste navegador';
  play.disabled = false;
  status.textContent = xrState === 'available' ? 'Pronto. Headset VR detectado.' : 'Pronto. VR indisponível aqui — jogue no PC.';

  const begin = () => {
    start.style.display = 'none';
    $('hud').classList.add('on');
    game.start();
    // O clique é o gesto que a política de autoplay exige para o áudio.
    void game.enableAudio();
  };

  play.addEventListener('click', begin);
  vr.addEventListener('click', async () => {
    try {
      begin();
      await game.xr.enter();
    } catch (err) {
      status.textContent = `Não foi possível iniciar o VR: ${(err as Error).message}`;
      start.style.display = '';
    }
  });
}

boot().catch((e) => {
  console.error(e);
  const s = document.getElementById('status');
  if (s) s.textContent = `Erro ao iniciar: ${(e as Error).message}`;
});

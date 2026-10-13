import { Game } from './game';
import { GarageUi } from './ui/garageUi';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

async function boot(): Promise<void> {
  const status = $('status');
  const play = $<HTMLButtonElement>('btn-play');
  const vr = $<HTMLButtonElement>('btn-vr');
  const start = $('start');

  const game = await Game.create($('app'));
  (window as unknown as { __game: Game }).__game = game;
  new GarageUi(game);

  const xrState = await game.xr.detect();
  vr.disabled = xrState !== 'available';
  vr.title = xrState === 'available' ? '' : 'WebXR não disponível neste navegador';
  play.disabled = false;
  status.textContent = xrState === 'available' ? 'Pronto. Headset VR detectado.' : 'Pronto. VR indisponível aqui — jogue no PC.';

  const begin = () => {
    start.style.display = 'none';
    $('hud').classList.add('on');
    game.start();
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

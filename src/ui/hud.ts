import type { Vehicle } from '../physics/vehicle/vehicle';

/** HUD de desktop: velocidade, marcha, rotação e turbo. Atualiza o DOM a ~20 Hz. */
export class Hud {
  private readonly spd = document.getElementById('spd')!;
  private readonly gear = document.getElementById('gear')!;
  private readonly bar = document.getElementById('rpmbar') as HTMLElement;
  private readonly boost = document.getElementById('boost')!;
  private acc = 0;

  update(dt: number, v: Vehicle): void {
    this.acc += dt;
    if (this.acc < 0.05) return;
    this.acc = 0;
    this.spd.textContent = String(Math.round(v.speedKmh));
    const g = v.gearbox.gear;
    this.gear.textContent = g < 0 ? 'R' : g === 0 ? 'N' : String(g);
    const redline = v.params.engine.redlineRpm;
    this.bar.style.width = `${Math.min(100, (v.rpm / redline) * 100).toFixed(0)}%`;
    const maxBoost = v.params.engine.turbo.maxBoost;
    this.boost.textContent = maxBoost > 0 ? `Turbo ${v.turbo.boost.toFixed(2)} bar` : 'Aspirado';
  }
}

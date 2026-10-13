import type { Vehicle } from '../physics/vehicle/vehicle';
import { EngineSynth } from './engineSynth';
import { EnvironmentSound } from './environment';
import { MeetMusic } from './meetMusic';
import { cabinCutoff } from './soundParams';

export interface AudioFrame {
  listenerPos: { x: number; y: number; z: number };
  listenerFwd: { x: number; y: number; z: number };
  listenerUp: { x: number; y: number; z: number };
  insideCar: boolean;
  rain: boolean;
  windowTint: number;
}

/**
 * Todo o áudio do jogo: motor, pneus/vento/ambiente, música do encontro (espacializada) e eventos
 * (blow-off, estouros, batidas). Procedural: nenhum arquivo de áudio licenciado.
 */
export class AudioSystem {
  readonly ctx: AudioContext;
  readonly engine: EngineSynth;
  readonly env: EnvironmentSound;
  readonly music: MeetMusic | null;
  muted = false;
  /** Estouros agendados neste quadro, consumidos pelos efeitos visuais (chamas no escapamento). */
  backfires = 0;

  private readonly master: GainNode;
  private readonly cabin: BiquadFilterNode;
  private prevThrottle = 0;
  private impactCooldown = 0;
  private musicAbsorbT = 0;
  private readonly stage: { x: number; y: number; z: number } | null;

  constructor(stage: { x: number; y: number; z: number } | null) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new AC({ latencyHint: 'interactive' });
    this.stage = stage;

    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.85;
    this.master.connect(comp).connect(this.ctx.destination);

    this.cabin = this.ctx.createBiquadFilter();
    this.cabin.type = 'lowpass';
    this.cabin.frequency.value = 18000;
    this.cabin.connect(this.master);

    this.engine = new EngineSynth(this.ctx);
    this.engine.out.connect(this.master);
    this.env = new EnvironmentSound(this.ctx);
    this.env.out.connect(this.cabin);
    this.music = stage ? new MeetMusic(this.ctx, stage) : null;
    this.music?.connect(this.cabin);
  }

  /** Inicia os geradores (chamar dentro de um gesto do usuário). */
  async start(): Promise<void> {
    if (this.ctx.state === 'suspended') await this.ctx.resume().catch(() => {});
    this.engine.start();
    this.env.start();
    this.music?.start();
  }

  setMuted(m: boolean): void {
    this.muted = m;
    this.master.gain.setTargetAtTime(m ? 0 : 0.85, this.ctx.currentTime, 0.05);
  }

  toggleMute(): boolean {
    this.setMuted(!this.muted);
    return this.muted;
  }

  update(dt: number, v: Vehicle, f: AudioFrame): void {
    const now = this.ctx.currentTime;
    const L = this.ctx.listener;
    if (L.positionX) {
      L.positionX.setValueAtTime(f.listenerPos.x, now);
      L.positionY.setValueAtTime(f.listenerPos.y, now);
      L.positionZ.setValueAtTime(f.listenerPos.z, now);
      L.forwardX.setValueAtTime(f.listenerFwd.x, now);
      L.forwardY.setValueAtTime(f.listenerFwd.y, now);
      L.forwardZ.setValueAtTime(f.listenerFwd.z, now);
      L.upX.setValueAtTime(f.listenerUp.x, now);
      L.upY.setValueAtTime(f.listenerUp.y, now);
      L.upZ.setValueAtTime(f.listenerUp.z, now);
    }

    this.cabin.frequency.setTargetAtTime(cabinCutoff(f.insideCar, f.windowTint), now, 0.15);

    const maxBoost = v.params.engine.turbo.maxBoost;
    this.engine.update({
      rpm: v.rpm,
      throttle: v.throttle,
      boostRatio: maxBoost > 0 ? v.turbo.boost / maxBoost : 0,
      idleRpm: v.params.engine.idleRpm,
      limiterRpm: v.params.engine.limiterRpm,
      fuelCut: v.engine.fuelCut,
      exhaustOpen: v.params.exhaustOpenness,
    });

    const w = v.wheels;
    this.env.update({
      speedKmh: v.speedKmh,
      slipFront: Math.max(w[0]!.contact ? w[0]!.slip : 0, w[1]!.contact ? w[1]!.slip : 0),
      slipRear: Math.max(w[2]!.contact ? w[2]!.slip : 0, w[3]!.contact ? w[3]!.slip : 0),
      onGround: !v.airborne,
      wet: true,
      insideCar: f.insideCar,
      rain: f.rain,
      surfaceRough: 0,
    });

    // Eventos do motor.
    if (v.eventBlowOff) this.engine.blowOff(Math.min(1, 0.4 + v.turbo.ratio));
    const lift = this.prevThrottle > 0.55 && v.throttle < 0.12 && v.rpm > 4500 && v.params.exhaustOpenness > 0.45 && !v.engine.fuelCut;
    if (lift) {
      const n = 2 + Math.floor(Math.random() * 3);
      for (let i = 0; i < n; i++) {
        window.setTimeout(() => {
          this.engine.pop(0.45 + Math.random() * 0.5);
          this.backfires++;
        }, 60 + i * (70 + Math.random() * 90));
      }
    }
    if (v.eventRevLimiter && Math.random() < 0.6) {
      this.engine.pop(0.35);
      this.backfires++;
    }
    this.prevThrottle = v.throttle;

    // Batidas.
    this.impactCooldown = Math.max(0, this.impactCooldown - dt);
    const g = Math.hypot(v.gLat, v.gLong);
    if (g > 2.6 && this.impactCooldown <= 0 && !v.airborne) {
      this.engine.thump((g - 2) / 2);
      this.impactCooldown = 0.35;
    }

    // Música: absorção do ar pela distância ao palco.
    this.musicAbsorbT += dt;
    if (this.music && this.stage && this.musicAbsorbT > 0.4) {
      this.musicAbsorbT = 0;
      this.music.setAirAbsorption(Math.hypot(f.listenerPos.x - this.stage.x, f.listenerPos.z - this.stage.z));
    }
  }

  consumeBackfires(): number {
    const n = this.backfires;
    this.backfires = 0;
    return n;
  }

  dispose(): void {
    this.engine.stop();
    this.env.stop();
    this.music?.stop();
    void this.ctx.close();
  }
}

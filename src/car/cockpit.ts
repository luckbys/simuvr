import * as THREE from 'three';
import type { CarView } from './carView';
import type { Vehicle } from '../physics/vehicle/vehicle';

/** Retrovisor central: render target pequeno atualizado a cada N quadros. Desligado no tier baixo. */
export class RearMirror {
  readonly mesh: THREE.Mesh;
  private readonly cam = new THREE.PerspectiveCamera(42, 3.4, 0.4, 400);
  private readonly rt: THREE.WebGLRenderTarget;
  private frame = 0;

  constructor(carRoot: THREE.Object3D, private readonly every = 2) {
    this.rt = new THREE.WebGLRenderTarget(320, 96, { depthBuffer: true, samples: 0 });
    this.rt.texture.colorSpace = THREE.SRGBColorSpace;
    this.mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ map: this.rt.texture, toneMapped: false, side: THREE.DoubleSide }),
    );
    // Espelho: o plano é invertido em X para a imagem sair espelhada.
    this.mesh.scale.set(-0.3, 0.088, 1);
    this.mesh.position.set(0, 0.74, -0.18);
    this.mesh.rotation.x = 0.18;
    carRoot.add(this.mesh);
    // Câmera logo atrás da tampa do porta-malas, olhando para trás (+Z do chassi).
    this.cam.position.set(0, 0.62, 1.7);
    this.cam.rotation.y = Math.PI;
    carRoot.add(this.cam);
  }

  render(renderer: THREE.WebGLRenderer, scene: THREE.Scene): void {
    if (this.frame++ % this.every !== 0) return;
    const wasXr = renderer.xr.enabled;
    const prev = renderer.getRenderTarget();
    renderer.xr.enabled = false;
    this.mesh.visible = false;
    renderer.setRenderTarget(this.rt);
    renderer.render(scene, this.cam);
    renderer.setRenderTarget(prev);
    this.mesh.visible = true;
    renderer.xr.enabled = wasXr;
  }

  dispose(): void {
    this.rt.dispose();
  }
}

/**
 * Painel de instrumentos: conta-giros em arco, velocímetro digital, marcha e pressão do turbo,
 * desenhado em canvas e atualizado a ~30 Hz. Serve ao cockpit do PC e ao VR.
 */
export class Cockpit {
  readonly gauge: THREE.Mesh;
  readonly mirror: RearMirror | null;
  /** Desligado pelo governador de desempenho quando o headset não aguenta. */
  mirrorEnabled = true;
  private readonly canvas = document.createElement('canvas');
  private readonly g = this.canvas.getContext('2d')!;
  private readonly tex: THREE.CanvasTexture;
  private acc = 0;
  private lastSig = '';

  constructor(car: CarView, withMirror: boolean) {
    this.canvas.width = 768;
    this.canvas.height = 384;
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.anisotropy = 4;
    const mat = new THREE.MeshBasicMaterial({ map: this.tex, toneMapped: false });
    mat.color.setScalar(1.25);
    this.gauge = new THREE.Mesh(new THREE.PlaneGeometry(0.46, 0.23), mat);
    // Acima do aro do volante, voltado para os olhos do motorista.
    this.gauge.position.set(-0.36, car.driverEye.y - 0.15, -0.58);
    this.gauge.lookAt(car.driverEye);
    car.root.add(this.gauge);
    this.mirror = withMirror ? new RearMirror(car.root) : null;
    this.draw(0, 900, 1, 0, 0, 0.85, 7200);
  }

  update(dt: number, v: Vehicle): void {
    this.acc += dt;
    if (this.acc < 1 / 30) return;
    this.acc = 0;
    const kmh = Math.round(v.speedKmh);
    const rpm = Math.round(v.rpm / 25) * 25;
    const sig = `${kmh}|${rpm}|${v.gearbox.gear}|${(v.turbo.boost * 20) | 0}|${v.options.autoGear}`;
    if (sig === this.lastSig) return;
    this.lastSig = sig;
    this.draw(kmh, rpm, v.gearbox.gear, v.turbo.boost, v.gLong, v.params.engine.turbo.maxBoost, v.params.engine.redlineRpm, v.options.autoGear);
  }

  private draw(kmh: number, rpm: number, gear: number, boost: number, _gLong: number, maxBoost: number, redline: number, auto = true): void {
    const g = this.g;
    const W = this.canvas.width, H = this.canvas.height;
    g.clearRect(0, 0, W, H);
    g.fillStyle = '#05040c';
    g.beginPath();
    g.roundRect(0, 0, W, H, 36);
    g.fill();

    // Conta-giros: arco de 270°, de 135° a 405°.
    const cx = 250, cy = 200, r = 160;
    const maxRpm = 9000;
    const a0 = (135 * Math.PI) / 180, sweep = (270 * Math.PI) / 180;
    const ang = (v: number) => a0 + (Math.min(v, maxRpm) / maxRpm) * sweep;
    g.lineWidth = 16;
    g.lineCap = 'butt';
    g.strokeStyle = 'rgba(255,255,255,0.12)';
    g.beginPath();
    g.arc(cx, cy, r, a0, a0 + sweep);
    g.stroke();
    // progresso (ciano → magenta) e faixa vermelha
    const grad = g.createLinearGradient(cx - r, cy, cx + r, cy);
    grad.addColorStop(0, '#27e8ff');
    grad.addColorStop(1, '#ff2fb3');
    g.strokeStyle = grad;
    g.beginPath();
    g.arc(cx, cy, r, a0, ang(rpm));
    g.stroke();
    g.strokeStyle = '#ff2030';
    g.beginPath();
    g.arc(cx, cy, r + 14, ang(redline), a0 + sweep);
    g.stroke();
    // marcas e números
    g.fillStyle = '#d9dcff';
    g.font = '600 24px ui-sans-serif, "Segoe UI", Arial, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineWidth = 3;
    for (let k = 0; k <= 9; k++) {
      const a = ang(k * 1000);
      g.strokeStyle = k * 1000 >= redline ? '#ff2030' : '#9ea2d0';
      g.beginPath();
      g.moveTo(cx + Math.cos(a) * (r - 28), cy + Math.sin(a) * (r - 28));
      g.lineTo(cx + Math.cos(a) * (r - 12), cy + Math.sin(a) * (r - 12));
      g.stroke();
      g.fillText(String(k), cx + Math.cos(a) * (r - 52), cy + Math.sin(a) * (r - 52));
    }
    // ponteiro
    const a = ang(rpm);
    g.strokeStyle = '#ffffff';
    g.lineWidth = 7;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(cx + Math.cos(a) * 30, cy + Math.sin(a) * 30);
    g.lineTo(cx + Math.cos(a) * (r - 20), cy + Math.sin(a) * (r - 20));
    g.stroke();
    g.fillStyle = '#ff2fb3';
    g.beginPath();
    g.arc(cx, cy, 14, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#9ea2d0';
    g.font = '500 22px ui-sans-serif, "Segoe UI", Arial, sans-serif';
    g.fillText('x1000 rpm', cx, cy + 66);

    // Marcha
    g.fillStyle = '#27e8ff';
    g.font = '800 120px ui-sans-serif, "Segoe UI", Arial, sans-serif';
    g.shadowColor = '#27e8ff';
    g.shadowBlur = 18;
    g.fillText(gear < 0 ? 'R' : gear === 0 ? 'N' : String(gear), 250, 205);
    g.shadowBlur = 0;

    // Velocidade
    g.textAlign = 'right';
    g.fillStyle = '#ffffff';
    g.font = '800 130px ui-sans-serif, "Segoe UI", Arial, sans-serif';
    g.shadowColor = '#ff2fb3';
    g.shadowBlur = 20;
    g.fillText(String(kmh), 735, 150);
    g.shadowBlur = 0;
    g.fillStyle = '#9ea2d0';
    g.font = '600 32px ui-sans-serif, "Segoe UI", Arial, sans-serif';
    g.fillText('km/h', 735, 215);

    // Turbo
    g.textAlign = 'left';
    g.font = '600 26px ui-sans-serif, "Segoe UI", Arial, sans-serif';
    g.fillStyle = '#9ea2d0';
    g.fillText(maxBoost > 0 ? `TURBO  ${boost.toFixed(2)} bar` : 'ASPIRADO', 440, 290);
    g.fillStyle = 'rgba(255,255,255,0.14)';
    g.beginPath();
    g.roundRect(440, 308, 295, 18, 9);
    g.fill();
    if (maxBoost > 0) {
      const f = Math.max(0.02, Math.min(1, boost / maxBoost));
      const bg = g.createLinearGradient(440, 0, 735, 0);
      bg.addColorStop(0, '#27e8ff');
      bg.addColorStop(1, '#ff2fb3');
      g.fillStyle = bg;
      g.beginPath();
      g.roundRect(440, 308, 295 * f, 18, 9);
      g.fill();
    }
    g.fillStyle = auto ? '#3dff9a' : '#ffb02f';
    g.font = '700 24px ui-sans-serif, "Segoe UI", Arial, sans-serif';
    g.fillText(auto ? 'AUTO' : 'MANUAL', 440, 352);
    this.tex.needsUpdate = true;
  }

  /** Atualiza o retrovisor (se ativo). Chamar uma vez por quadro, antes do render principal. */
  renderMirror(renderer: THREE.WebGLRenderer, scene: THREE.Scene): void {
    if (this.mirrorEnabled) this.mirror?.render(renderer, scene);
  }

  dispose(): void {
    this.tex.dispose();
    this.mirror?.dispose();
  }
}

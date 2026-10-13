import type * as THREE from 'three';

/** Painel de diagnóstico: FPS, draw calls e triângulos (orçamento do Quest). */
export class DebugHud {
  private el = document.getElementById('debug') as HTMLDivElement;
  private frames = 0;
  private acc = 0;
  private fps = 0;
  private worst = 0;
  private extra = '';

  constructor(private readonly renderer: THREE.WebGLRenderer) {}

  toggle(): void {
    this.el.classList.toggle('on');
  }

  get visible(): boolean {
    return this.el.classList.contains('on');
  }

  setExtra(text: string): void {
    this.extra = text;
  }

  /** Texto atual, útil para HUD em VR e testes. */
  get text(): string {
    const i = this.renderer.info;
    return (
      `${this.fps.toFixed(0)} fps (pior ${(this.worst * 1000).toFixed(1)} ms)\n` +
      `draw ${i.render.calls}  tris ${(i.render.triangles / 1000).toFixed(0)}k\n` +
      `geo ${i.memory.geometries}  tex ${i.memory.textures}` +
      (this.extra ? `\n${this.extra}` : '')
    );
  }

  tick(frameDt: number): void {
    this.frames++;
    this.acc += frameDt;
    this.worst = Math.max(this.worst, frameDt);
    if (this.acc >= 0.5) {
      this.fps = this.frames / this.acc;
      this.frames = 0;
      this.acc = 0;
      if (this.visible) this.el.textContent = this.text;
      this.worst = 0;
    }
  }
}

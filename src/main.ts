import { WebGPURenderer } from './webgpu-renderer';
import { WebGLRenderer } from './webgl-renderer';

class ParticleDemo {
  private webgpuCanvas: HTMLCanvasElement;
  private webglCanvas: HTMLCanvasElement;
  private webgpuRenderer: WebGPURenderer | null = null;
  private webglRenderer: WebGLRenderer | null = null;
  private currentRenderer: 'webgpu' | 'webgl' = 'webgpu';
  private particleCount = 50000;
  private particleSize = 1.0;

  private lastTime = 0;
  private frameCount = 0;
  private fpsUpdateTime = 0;
  private currentFPS = 0;
  private frameTimeHistory: number[] = [];
  private fpsHistory: number[] = [];
  private maxHistoryLength = 60 * 60; // 60 seconds at 60fps

  private mouseX = 0;
  private mouseY = 0;
  private mouseActive = false;
  private animationFrameId: number | null = null;

  private errorMessageEl: HTMLElement;

  constructor() {
    this.webgpuCanvas = document.getElementById('webgpu-canvas') as HTMLCanvasElement;
    this.webglCanvas = document.getElementById('webgl-canvas') as HTMLCanvasElement;
    this.errorMessageEl = document.getElementById('error-message') as HTMLElement;

    this.resizeCanvases();
    window.addEventListener('resize', () => this.resizeCanvases());

    this.setupEventListeners();
  }

  private resizeCanvases(): void {
    const container = this.webgpuCanvas.parentElement!;
    const width = container.clientWidth;
    const height = container.clientHeight;
    const dpr = window.devicePixelRatio || 1;

    [this.webgpuCanvas, this.webglCanvas].forEach(canvas => {
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
    });
  }

  private setupEventListeners(): void {
    // Toggle controls
    const toggleBtn = document.getElementById('toggle-controls');
    const controlsDiv = document.querySelector('.controls');

    toggleBtn?.addEventListener('click', () => {
      controlsDiv?.classList.toggle('expanded');
    });

    // Renderer selection
    const rendererRadios = document.querySelectorAll<HTMLInputElement>('input[name="renderer"]');
    rendererRadios.forEach(radio => {
      radio.addEventListener('change', (e) => {
        const target = e.target as HTMLInputElement;
        this.switchRenderer(target.value as 'webgpu' | 'webgl');
      });
    });

    // Particle count
    const particleCountSlider = document.getElementById('particle-count') as HTMLInputElement;
    const particleCountDisplay = document.getElementById('particle-count-display') as HTMLElement;

    particleCountSlider.addEventListener('input', (e) => {
      const target = e.target as HTMLInputElement;
      const count = parseInt(target.value);
      particleCountDisplay.textContent = count.toLocaleString();
    });

    particleCountSlider.addEventListener('change', (e) => {
      const target = e.target as HTMLInputElement;
      this.updateParticleCount(parseInt(target.value));
    });

    // Particle size
    const particleSizeSlider = document.getElementById('particle-size') as HTMLInputElement;
    const particleSizeDisplay = document.getElementById('particle-size-display') as HTMLElement;

    particleSizeSlider.addEventListener('input', (e) => {
      const target = e.target as HTMLInputElement;
      const size = parseFloat(target.value);
      particleSizeDisplay.textContent = size.toFixed(1);
      this.particleSize = size;
    });

    // Reset button
    const resetBtn = document.getElementById('reset-btn');
    resetBtn?.addEventListener('click', () => this.reset());

    // Mouse interaction
    const canvas = this.webgpuCanvas.parentElement!;

    canvas.addEventListener('mouseenter', () => {
      this.mouseActive = true;
    });

    canvas.addEventListener('mouseleave', () => {
      this.mouseActive = false;
    });

    canvas.addEventListener('mousemove', (e) => {
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      // Convert to normalized device coordinates (-1 to 1)
      this.mouseX = (x / rect.width) * 2 - 1;
      this.mouseY = -((y / rect.height) * 2 - 1);
    });

    // Touch support
    canvas.addEventListener('touchstart', (e) => {
      e.preventDefault();
      this.mouseActive = true;
      this.updateTouchPosition(e, canvas);
    });

    canvas.addEventListener('touchend', () => {
      this.mouseActive = false;
    });

    canvas.addEventListener('touchmove', (e) => {
      e.preventDefault();
      this.updateTouchPosition(e, canvas);
    });
  }

  private updateTouchPosition(e: TouchEvent, canvas: HTMLElement): void {
    if (e.touches.length > 0) {
      const rect = canvas.getBoundingClientRect();
      const x = e.touches[0].clientX - rect.left;
      const y = e.touches[0].clientY - rect.top;

      this.mouseX = (x / rect.width) * 2 - 1;
      this.mouseY = -((y / rect.height) * 2 - 1);
    }
  }

  private async switchRenderer(renderer: 'webgpu' | 'webgl'): Promise<void> {
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }

    this.currentRenderer = renderer;
    this.webgpuCanvas.classList.remove('active');
    this.webglCanvas.classList.remove('active');
    this.errorMessageEl.classList.remove('show');

    // Reset statistics
    this.frameCount = 0;
    this.fpsUpdateTime = 0;
    this.frameTimeHistory = [];
    this.fpsHistory = [];
    this.currentFPS = 0;

    // Reset displayed stats
    document.getElementById('fps')!.textContent = '--';
    document.getElementById('frame-time')!.textContent = '--';
    document.getElementById('avg-fps')!.textContent = '--';

    try {
      if (renderer === 'webgpu') {
        if (!this.webgpuRenderer) {
          this.webgpuRenderer = new WebGPURenderer(this.webgpuCanvas, this.particleCount);
          await this.webgpuRenderer.init();
        }
        this.webgpuCanvas.classList.add('active');
        document.getElementById('current-renderer')!.textContent = 'WebGPU';
      } else {
        if (!this.webglRenderer) {
          this.webglRenderer = new WebGLRenderer(this.webglCanvas, this.particleCount);
          await this.webglRenderer.init();
        }
        this.webglCanvas.classList.add('active');
        document.getElementById('current-renderer')!.textContent = 'WebGL';
      }

      this.lastTime = performance.now();
      this.fpsUpdateTime = this.lastTime;
      this.animate(this.lastTime);
    } catch (error) {
      this.showError(error instanceof Error ? error.message : 'Unknown error occurred');
    }
  }

  private showError(message: string): void {
    this.errorMessageEl.textContent = message;
    this.errorMessageEl.classList.add('show');
  }

  private updateParticleCount(count: number): void {
    this.particleCount = count;

    if (this.webgpuRenderer) {
      this.webgpuRenderer.updateParticleCount(count);
    }
    if (this.webglRenderer) {
      this.webglRenderer.updateParticleCount(count);
    }

    document.getElementById('particle-count-stat')!.textContent = count.toLocaleString();

    // Reset statistics when particle count changes
    this.frameCount = 0;
    this.fpsUpdateTime = performance.now();
    this.frameTimeHistory = [];
    this.fpsHistory = [];
    this.currentFPS = 0;

    // Reset displayed stats
    document.getElementById('fps')!.textContent = '--';
    document.getElementById('frame-time')!.textContent = '--';
    document.getElementById('avg-fps')!.textContent = '--';
  }

  private reset(): void {
    this.webgpuRenderer?.destroy();
    this.webglRenderer?.destroy();
    this.webgpuRenderer = null;
    this.webglRenderer = null;

    this.frameTimeHistory = [];
    this.fpsHistory = [];

    this.switchRenderer(this.currentRenderer);
  }

  private animate(currentTime: number): void {
    const deltaTime = Math.min((currentTime - this.lastTime) / 1000, 0.1); // Cap at 100ms
    this.lastTime = currentTime;

    const time = currentTime / 1000;

    // Render
    try {
      if (this.currentRenderer === 'webgpu' && this.webgpuRenderer) {
        this.webgpuRenderer.render(deltaTime, time, this.mouseX, this.mouseY, this.mouseActive, this.particleSize);
      } else if (this.currentRenderer === 'webgl' && this.webglRenderer) {
        this.webglRenderer.render(deltaTime, time, this.mouseX, this.mouseY, this.mouseActive, this.particleSize);
      }
    } catch (error) {
      this.showError(error instanceof Error ? error.message : 'Rendering error occurred');
      return;
    }

    // Update statistics
    this.updateStats(deltaTime);

    this.animationFrameId = requestAnimationFrame((time) => this.animate(time));
  }

  private updateStats(deltaTime: number): void {
    this.frameCount++;
    const frameTime = deltaTime * 1000;
    this.frameTimeHistory.push(frameTime);

    if (this.frameTimeHistory.length > this.maxHistoryLength) {
      this.frameTimeHistory.shift();
    }

    const currentTime = performance.now();
    if (currentTime - this.fpsUpdateTime >= 200) {
      this.currentFPS = 1 / deltaTime;
      this.fpsHistory.push(this.currentFPS);

      if (this.fpsHistory.length > this.maxHistoryLength) {
        this.fpsHistory.shift();
      }

      // Update UI
      document.getElementById('fps')!.textContent = Math.round(this.currentFPS).toString();
      document.getElementById('frame-time')!.textContent = frameTime.toFixed(2) + ' ms';

      // Calculate average FPS
      if (this.fpsHistory.length > 0) {
        const avgFps = this.fpsHistory.reduce((a, b) => a + b, 0) / this.fpsHistory.length;
        document.getElementById('avg-fps')!.textContent = Math.round(avgFps).toString();
      }

      this.fpsUpdateTime = currentTime;
    }
  }

  async start(): Promise<void> {
    await this.switchRenderer('webgpu');
  }
}

// Initialize the demo
const demo = new ParticleDemo();
demo.start().catch(error => {
  console.error('Failed to start demo:', error);
});

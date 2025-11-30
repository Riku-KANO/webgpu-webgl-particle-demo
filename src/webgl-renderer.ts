export class WebGLRenderer {
  private gl!: WebGL2RenderingContext;
  private program!: WebGLProgram;
  private vao!: WebGLVertexArrayObject;
  private particleBuffer!: WebGLBuffer;
  private particles: Float32Array;
  private particleCount: number;
  private canvas: HTMLCanvasElement;

  private uniformLocations: {
    deltaTime?: WebGLUniformLocation | null;
    time?: WebGLUniformLocation | null;
    mousePos?: WebGLUniformLocation | null;
    mouseActive?: WebGLUniformLocation | null;
    particleSize?: WebGLUniformLocation | null;
  } = {};

  constructor(canvas: HTMLCanvasElement, particleCount: number) {
    this.canvas = canvas;
    this.particleCount = particleCount;
    this.particles = new Float32Array(particleCount * 8);
  }

  async init(): Promise<void> {
    const gl = this.canvas.getContext('webgl2');
    if (!gl) {
      throw new Error('WebGL2 is not supported in this browser');
    }
    this.gl = gl;

    this.initParticles();
    await this.createShaders();
    this.createBuffers();

    this.gl.enable(this.gl.BLEND);
    this.gl.blendFunc(this.gl.SRC_ALPHA, this.gl.ONE_MINUS_SRC_ALPHA);
  }

  private initParticles(): void {
    for (let i = 0; i < this.particleCount; i++) {
      const offset = i * 8;
      // position (x, y)
      this.particles[offset + 0] = (Math.random() - 0.5) * 2;
      this.particles[offset + 1] = (Math.random() - 0.5) * 2;
      // velocity (x, y)
      this.particles[offset + 2] = (Math.random() - 0.5) * 0.01;
      this.particles[offset + 3] = (Math.random() - 0.5) * 0.01;
      // color (r, g, b)
      this.particles[offset + 4] = Math.random();
      this.particles[offset + 5] = Math.random();
      this.particles[offset + 6] = Math.random();
      // life
      this.particles[offset + 7] = Math.random();
    }
  }

  private async createShaders(): Promise<void> {
    const vertexShaderSource = `#version 300 es
      precision highp float;

      layout(location = 0) in vec2 a_position;
      layout(location = 1) in vec2 a_velocity;
      layout(location = 2) in vec3 a_color;
      layout(location = 3) in float a_life;

      out vec4 v_color;

      uniform float u_particleSize;

      void main() {
        gl_Position = vec4(a_position, 0.0, 1.0);
        gl_PointSize = 3.0 * u_particleSize;
        float alpha = 1.0 - abs(a_life - 0.5) * 2.0;
        v_color = vec4(a_color, alpha);
      }
    `;

    const fragmentShaderSource = `#version 300 es
      precision highp float;

      in vec4 v_color;
      out vec4 fragColor;

      void main() {
        // Make circular points
        vec2 coord = gl_PointCoord - vec2(0.5);
        float dist = length(coord);
        if (dist > 0.5) {
          discard;
        }
        fragColor = v_color;
      }
    `;

    const vertexShader = this.compileShader(this.gl.VERTEX_SHADER, vertexShaderSource);
    const fragmentShader = this.compileShader(this.gl.FRAGMENT_SHADER, fragmentShaderSource);

    this.program = this.gl.createProgram()!;
    this.gl.attachShader(this.program, vertexShader);
    this.gl.attachShader(this.program, fragmentShader);
    this.gl.linkProgram(this.program);

    if (!this.gl.getProgramParameter(this.program, this.gl.LINK_STATUS)) {
      const info = this.gl.getProgramInfoLog(this.program);
      throw new Error('Failed to link program: ' + info);
    }

    this.uniformLocations.deltaTime = this.gl.getUniformLocation(this.program, 'u_deltaTime');
    this.uniformLocations.time = this.gl.getUniformLocation(this.program, 'u_time');
    this.uniformLocations.mousePos = this.gl.getUniformLocation(this.program, 'u_mousePos');
    this.uniformLocations.mouseActive = this.gl.getUniformLocation(this.program, 'u_mouseActive');
    this.uniformLocations.particleSize = this.gl.getUniformLocation(this.program, 'u_particleSize');

    this.gl.deleteShader(vertexShader);
    this.gl.deleteShader(fragmentShader);
  }

  private compileShader(type: number, source: string): WebGLShader {
    const shader = this.gl.createShader(type)!;
    this.gl.shaderSource(shader, source);
    this.gl.compileShader(shader);

    if (!this.gl.getShaderParameter(shader, this.gl.COMPILE_STATUS)) {
      const info = this.gl.getShaderInfoLog(shader);
      this.gl.deleteShader(shader);
      throw new Error('Failed to compile shader: ' + info);
    }

    return shader;
  }

  private createBuffers(): void {
    this.vao = this.gl.createVertexArray()!;
    this.gl.bindVertexArray(this.vao);

    this.particleBuffer = this.gl.createBuffer()!;
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.particleBuffer);
    this.gl.bufferData(this.gl.ARRAY_BUFFER, this.particles, this.gl.DYNAMIC_DRAW);

    const stride = 32; // 8 floats * 4 bytes

    // position
    this.gl.enableVertexAttribArray(0);
    this.gl.vertexAttribPointer(0, 2, this.gl.FLOAT, false, stride, 0);

    // velocity
    this.gl.enableVertexAttribArray(1);
    this.gl.vertexAttribPointer(1, 2, this.gl.FLOAT, false, stride, 8);

    // color
    this.gl.enableVertexAttribArray(2);
    this.gl.vertexAttribPointer(2, 3, this.gl.FLOAT, false, stride, 16);

    // life
    this.gl.enableVertexAttribArray(3);
    this.gl.vertexAttribPointer(3, 1, this.gl.FLOAT, false, stride, 28);

    this.gl.bindVertexArray(null);
  }

  private updateParticles(deltaTime: number, time: number, mouseX: number, mouseY: number, mouseActive: boolean): void {
    for (let i = 0; i < this.particleCount; i++) {
      const offset = i * 8;

      let posX = this.particles[offset + 0];
      let posY = this.particles[offset + 1];
      let velX = this.particles[offset + 2];
      let velY = this.particles[offset + 3];
      let life = this.particles[offset + 7];

      // Mouse interaction
      if (mouseActive) {
        const dx = mouseX - posX;
        const dy = mouseY - posY;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < 0.5 && dist > 0.001) {
          const force = (0.5 - dist) * 0.01;
          velX += (dx / dist) * force;
          velY += (dy / dist) * force;
        }
      }

      // Update position
      posX += velX * deltaTime * 60.0;
      posY += velY * deltaTime * 60.0;

      // Apply friction
      velX *= 0.98;
      velY *= 0.98;

      // Bounce off edges
      if (posX < -1.0 || posX > 1.0) {
        velX *= -0.8;
        posX = Math.max(-1.0, Math.min(1.0, posX));
      }
      if (posY < -1.0 || posY > 1.0) {
        velY *= -0.8;
        posY = Math.max(-1.0, Math.min(1.0, posY));
      }

      // Add some wave motion
      const wave = Math.sin(time + i * 0.01) * 0.0001;
      velY += wave;

      // Update life
      life = (life + deltaTime * 0.1) % 1.0;

      this.particles[offset + 0] = posX;
      this.particles[offset + 1] = posY;
      this.particles[offset + 2] = velX;
      this.particles[offset + 3] = velY;
      this.particles[offset + 7] = life;
    }
  }

  render(deltaTime: number, time: number, mouseX: number, mouseY: number, mouseActive: boolean, particleSize: number = 1.0): void {
    // Update particles on CPU
    this.updateParticles(deltaTime, time, mouseX, mouseY, mouseActive);

    // Update buffer
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.particleBuffer);
    this.gl.bufferSubData(this.gl.ARRAY_BUFFER, 0, this.particles);

    // Clear
    this.gl.clearColor(0.05, 0.05, 0.15, 1.0);
    this.gl.clear(this.gl.COLOR_BUFFER_BIT);

    // Render
    this.gl.useProgram(this.program);

    // Set uniforms
    if (this.uniformLocations.particleSize) {
      this.gl.uniform1f(this.uniformLocations.particleSize, particleSize);
    }

    this.gl.bindVertexArray(this.vao);
    this.gl.drawArrays(this.gl.POINTS, 0, this.particleCount);
    this.gl.bindVertexArray(null);
  }

  updateParticleCount(count: number): void {
    this.particleCount = count;
    this.particles = new Float32Array(count * 8);
    this.initParticles();
    this.createBuffers();
  }

  destroy(): void {
    this.gl.deleteBuffer(this.particleBuffer);
    this.gl.deleteVertexArray(this.vao);
    this.gl.deleteProgram(this.program);
  }
}

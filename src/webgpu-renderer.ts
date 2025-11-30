export class WebGPURenderer {
  private device!: GPUDevice;
  private context!: GPUCanvasContext;
  private pipeline!: GPURenderPipeline;
  private computePipeline!: GPUComputePipeline;
  private particleBuffer!: GPUBuffer;
  private uniformBuffer!: GPUBuffer;
  private computeBindGroup!: GPUBindGroup;
  private renderBindGroup!: GPUBindGroup;
  private particleCount: number;
  private canvas: HTMLCanvasElement;

  constructor(canvas: HTMLCanvasElement, particleCount: number) {
    this.canvas = canvas;
    this.particleCount = particleCount;
  }

  async init(): Promise<void> {
    if (!navigator.gpu) {
      throw new Error('WebGPU is not supported in this browser');
    }

    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) {
      throw new Error('Failed to get GPU adapter');
    }

    this.device = await adapter.requestDevice();
    this.context = this.canvas.getContext('webgpu') as GPUCanvasContext;

    const presentationFormat = navigator.gpu.getPreferredCanvasFormat();
    this.context.configure({
      device: this.device,
      format: presentationFormat,
      alphaMode: 'premultiplied',
    });

    await this.createBuffers();
    await this.createPipelines();
  }

  private async createBuffers(): Promise<void> {
    // Initialize particle data
    const particleData = new Float32Array(this.particleCount * 8);
    for (let i = 0; i < this.particleCount; i++) {
      const offset = i * 8;
      // position (x, y)
      particleData[offset + 0] = (Math.random() - 0.5) * 2;
      particleData[offset + 1] = (Math.random() - 0.5) * 2;
      // velocity (x, y)
      particleData[offset + 2] = (Math.random() - 0.5) * 0.01;
      particleData[offset + 3] = (Math.random() - 0.5) * 0.01;
      // color (r, g, b)
      particleData[offset + 4] = Math.random();
      particleData[offset + 5] = Math.random();
      particleData[offset + 6] = Math.random();
      // life
      particleData[offset + 7] = Math.random();
    }

    this.particleBuffer = this.device.createBuffer({
      size: particleData.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      mappedAtCreation: true,
    });
    new Float32Array(this.particleBuffer.getMappedRange()).set(particleData);
    this.particleBuffer.unmap();

    // Uniform buffer for time, mouse position, etc.
    // WGSL alignment: vec3f requires 16-byte alignment
    this.uniformBuffer = this.device.createBuffer({
      size: 48, // Aligned size for the Uniforms struct
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
  }

  private async createPipelines(): Promise<void> {
    // Compute shader for particle updates
    const computeShaderModule = this.device.createShaderModule({
      code: `
        struct Particle {
          pos: vec2f,
          vel: vec2f,
          color: vec3f,
          life: f32,
        }

        struct Uniforms {
          deltaTime: f32,
          time: f32,
          mouseX: f32,
          mouseY: f32,
          mouseActive: f32,
          particleSize: f32,
          padding: vec2f,
        }

        @group(0) @binding(0) var<storage, read_write> particles: array<Particle>;
        @group(0) @binding(1) var<uniform> uniforms: Uniforms;

        @compute @workgroup_size(64)
        fn main(@builtin(global_invocation_id) global_id: vec3u) {
          let index = global_id.x;
          if (index >= arrayLength(&particles)) {
            return;
          }

          var particle = particles[index];

          // Mouse interaction
          if (uniforms.mouseActive > 0.5) {
            let mousePos = vec2f(uniforms.mouseX, uniforms.mouseY);
            let toMouse = mousePos - particle.pos;
            let dist = length(toMouse);
            if (dist < 0.5 && dist > 0.001) {
              let force = normalize(toMouse) * (0.5 - dist) * 0.01;
              particle.vel += force;
            }
          }

          // Update position
          particle.pos += particle.vel * uniforms.deltaTime * 60.0;

          // Apply friction
          particle.vel *= 0.98;

          // Bounce off edges
          if (particle.pos.x < -1.0 || particle.pos.x > 1.0) {
            particle.vel.x *= -0.8;
            particle.pos.x = clamp(particle.pos.x, -1.0, 1.0);
          }
          if (particle.pos.y < -1.0 || particle.pos.y > 1.0) {
            particle.vel.y *= -0.8;
            particle.pos.y = clamp(particle.pos.y, -1.0, 1.0);
          }

          // Add some wave motion
          let wave = sin(uniforms.time + f32(index) * 0.01) * 0.0001;
          particle.vel.y += wave;

          // Update life
          particle.life = fract(particle.life + uniforms.deltaTime * 0.1);

          particles[index] = particle;
        }
      `,
    });

    // Render shader
    const renderShaderModule = this.device.createShaderModule({
      code: `
        struct Particle {
          pos: vec2f,
          vel: vec2f,
          color: vec3f,
          life: f32,
        }

        struct Uniforms {
          deltaTime: f32,
          time: f32,
          mouseX: f32,
          mouseY: f32,
          mouseActive: f32,
          particleSize: f32,
          padding: vec2f,
        }

        struct VertexOutput {
          @builtin(position) position: vec4f,
          @location(0) color: vec4f,
          @location(1) pointCoord: vec2f,
        }

        @group(0) @binding(1) var<uniform> renderUniforms: Uniforms;

        @vertex
        fn vs_main(
          @builtin(vertex_index) vertexIndex: u32,
          @builtin(instance_index) instanceIndex: u32,
          @location(0) pos: vec2f,
          @location(1) vel: vec2f,
          @location(2) color: vec3f,
          @location(3) life: f32
        ) -> VertexOutput {
          // Quad vertices for a point sprite
          var quadPos = array<vec2f, 6>(
            vec2f(-1.0, -1.0),
            vec2f(1.0, -1.0),
            vec2f(-1.0, 1.0),
            vec2f(-1.0, 1.0),
            vec2f(1.0, -1.0),
            vec2f(1.0, 1.0)
          );

          var quadUV = array<vec2f, 6>(
            vec2f(0.0, 0.0),
            vec2f(1.0, 0.0),
            vec2f(0.0, 1.0),
            vec2f(0.0, 1.0),
            vec2f(1.0, 0.0),
            vec2f(1.0, 1.0)
          );

          let baseSize = 0.004; // Base size in NDC space
          let pointSize = baseSize * renderUniforms.particleSize;
          let vertPos = quadPos[vertexIndex];
          let screenPos = pos + vertPos * pointSize;

          var output: VertexOutput;
          output.position = vec4f(screenPos, 0.0, 1.0);
          output.color = vec4f(color, 1.0 - abs(life - 0.5) * 2.0);
          output.pointCoord = quadUV[vertexIndex];
          return output;
        }

        @fragment
        fn fs_main(@location(0) color: vec4f, @location(1) pointCoord: vec2f) -> @location(0) vec4f {
          // Make circular points
          let coord = pointCoord - vec2f(0.5);
          let dist = length(coord);
          if (dist > 0.5) {
            discard;
          }
          return color;
        }
      `,
    });

    // Compute pipeline
    this.computePipeline = this.device.createComputePipeline({
      layout: 'auto',
      compute: {
        module: computeShaderModule,
        entryPoint: 'main',
      },
    });

    // Render pipeline
    this.pipeline = this.device.createRenderPipeline({
      layout: 'auto',
      vertex: {
        module: renderShaderModule,
        entryPoint: 'vs_main',
        buffers: [
          {
            arrayStride: 32,
            stepMode: 'instance',
            attributes: [
              { shaderLocation: 0, offset: 0, format: 'float32x2' },   // pos
              { shaderLocation: 1, offset: 8, format: 'float32x2' },   // vel
              { shaderLocation: 2, offset: 16, format: 'float32x3' },  // color
              { shaderLocation: 3, offset: 28, format: 'float32' },    // life
            ],
          },
        ],
      },
      fragment: {
        module: renderShaderModule,
        entryPoint: 'fs_main',
        targets: [
          {
            format: navigator.gpu.getPreferredCanvasFormat(),
            blend: {
              color: {
                srcFactor: 'src-alpha',
                dstFactor: 'one-minus-src-alpha',
              },
              alpha: {
                srcFactor: 'one',
                dstFactor: 'one-minus-src-alpha',
              },
            },
          },
        ],
      },
      primitive: {
        topology: 'triangle-list',
      },
    });

    // Create bind groups
    this.computeBindGroup = this.device.createBindGroup({
      layout: this.computePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.particleBuffer } },
        { binding: 1, resource: { buffer: this.uniformBuffer } },
      ],
    });

    this.renderBindGroup = this.device.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 1, resource: { buffer: this.uniformBuffer } },
      ],
    });
  }

  render(deltaTime: number, time: number, mouseX: number, mouseY: number, mouseActive: boolean, particleSize: number = 1.0): void {
    // Update uniforms
    // Struct layout with proper alignment:
    // deltaTime (f32, 4 bytes)
    // time (f32, 4 bytes)
    // mouseX (f32, 4 bytes)
    // mouseY (f32, 4 bytes)
    // mouseActive (f32, 4 bytes)
    // particleSize (f32, 4 bytes)
    // padding (vec2f, 8 bytes)
    const uniformData = new Float32Array(12); // 48 bytes total
    uniformData[0] = deltaTime;
    uniformData[1] = time;
    uniformData[2] = mouseX;
    uniformData[3] = mouseY;
    uniformData[4] = mouseActive ? 1.0 : 0.0;
    uniformData[5] = particleSize;
    // uniformData[6-7] are padding (automatically 0)
    this.device.queue.writeBuffer(this.uniformBuffer, 0, uniformData);

    const commandEncoder = this.device.createCommandEncoder();

    // Compute pass
    const computePass = commandEncoder.beginComputePass();
    computePass.setPipeline(this.computePipeline);
    computePass.setBindGroup(0, this.computeBindGroup);
    computePass.dispatchWorkgroups(Math.ceil(this.particleCount / 64));
    computePass.end();

    // Render pass
    const textureView = this.context.getCurrentTexture().createView();
    const renderPass = commandEncoder.beginRenderPass({
      colorAttachments: [
        {
          view: textureView,
          clearValue: { r: 0.05, g: 0.05, b: 0.15, a: 1.0 },
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
    });

    renderPass.setPipeline(this.pipeline);
    renderPass.setBindGroup(0, this.renderBindGroup);
    renderPass.setVertexBuffer(0, this.particleBuffer);
    renderPass.draw(6, this.particleCount); // 6 vertices per quad, instanced per particle
    renderPass.end();

    this.device.queue.submit([commandEncoder.finish()]);
  }

  updateParticleCount(count: number): void {
    this.particleCount = count;
    this.createBuffers().then(() => {
      this.createPipelines();
    });
  }

  destroy(): void {
    this.particleBuffer?.destroy();
    this.uniformBuffer?.destroy();
  }
}

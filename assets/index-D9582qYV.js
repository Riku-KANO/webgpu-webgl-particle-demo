(function(){const e=document.createElement("link").relList;if(e&&e.supports&&e.supports("modulepreload"))return;for(const r of document.querySelectorAll('link[rel="modulepreload"]'))i(r);new MutationObserver(r=>{for(const s of r)if(s.type==="childList")for(const l of s.addedNodes)l.tagName==="LINK"&&l.rel==="modulepreload"&&i(l)}).observe(document,{childList:!0,subtree:!0});function t(r){const s={};return r.integrity&&(s.integrity=r.integrity),r.referrerPolicy&&(s.referrerPolicy=r.referrerPolicy),r.crossOrigin==="use-credentials"?s.credentials="include":r.crossOrigin==="anonymous"?s.credentials="omit":s.credentials="same-origin",s}function i(r){if(r.ep)return;r.ep=!0;const s=t(r);fetch(r.href,s)}})();class y{constructor(e,t){this.canvas=e,this.particleCount=t}async init(){if(!navigator.gpu)throw new Error("WebGPU is not supported in this browser");const e=await navigator.gpu.requestAdapter();if(!e)throw new Error("Failed to get GPU adapter");this.device=await e.requestDevice(),this.context=this.canvas.getContext("webgpu");const t=navigator.gpu.getPreferredCanvasFormat();this.context.configure({device:this.device,format:t,alphaMode:"premultiplied"}),await this.createBuffers(),await this.createPipelines()}async createBuffers(){const e=new Float32Array(this.particleCount*8);for(let t=0;t<this.particleCount;t++){const i=t*8;e[i+0]=(Math.random()-.5)*2,e[i+1]=(Math.random()-.5)*2,e[i+2]=(Math.random()-.5)*.01,e[i+3]=(Math.random()-.5)*.01,e[i+4]=Math.random(),e[i+5]=Math.random(),e[i+6]=Math.random(),e[i+7]=Math.random()}this.particleBuffer=this.device.createBuffer({size:e.byteLength,usage:GPUBufferUsage.VERTEX|GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST,mappedAtCreation:!0}),new Float32Array(this.particleBuffer.getMappedRange()).set(e),this.particleBuffer.unmap(),this.uniformBuffer=this.device.createBuffer({size:48,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST})}async createPipelines(){const e=this.device.createShaderModule({code:`
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
      `}),t=this.device.createShaderModule({code:`
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
      `});this.computePipeline=this.device.createComputePipeline({layout:"auto",compute:{module:e,entryPoint:"main"}}),this.pipeline=this.device.createRenderPipeline({layout:"auto",vertex:{module:t,entryPoint:"vs_main",buffers:[{arrayStride:32,stepMode:"instance",attributes:[{shaderLocation:0,offset:0,format:"float32x2"},{shaderLocation:1,offset:8,format:"float32x2"},{shaderLocation:2,offset:16,format:"float32x3"},{shaderLocation:3,offset:28,format:"float32"}]}]},fragment:{module:t,entryPoint:"fs_main",targets:[{format:navigator.gpu.getPreferredCanvasFormat(),blend:{color:{srcFactor:"src-alpha",dstFactor:"one-minus-src-alpha"},alpha:{srcFactor:"one",dstFactor:"one-minus-src-alpha"}}}]},primitive:{topology:"triangle-list"}}),this.computeBindGroup=this.device.createBindGroup({layout:this.computePipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:this.particleBuffer}},{binding:1,resource:{buffer:this.uniformBuffer}}]}),this.renderBindGroup=this.device.createBindGroup({layout:this.pipeline.getBindGroupLayout(0),entries:[{binding:1,resource:{buffer:this.uniformBuffer}}]})}render(e,t,i,r,s,l=1){const c=new Float32Array(12);c[0]=e,c[1]=t,c[2]=i,c[3]=r,c[4]=s?1:0,c[5]=l,this.device.queue.writeBuffer(this.uniformBuffer,0,c);const h=this.device.createCommandEncoder(),n=h.beginComputePass();n.setPipeline(this.computePipeline),n.setBindGroup(0,this.computeBindGroup),n.dispatchWorkgroups(Math.ceil(this.particleCount/64)),n.end();const a=this.context.getCurrentTexture().createView(),o=h.beginRenderPass({colorAttachments:[{view:a,clearValue:{r:.05,g:.05,b:.15,a:1},loadOp:"clear",storeOp:"store"}]});o.setPipeline(this.pipeline),o.setBindGroup(0,this.renderBindGroup),o.setVertexBuffer(0,this.particleBuffer),o.draw(6,this.particleCount),o.end(),this.device.queue.submit([h.finish()])}updateParticleCount(e){this.particleCount=e,this.createBuffers().then(()=>{this.createPipelines()})}destroy(){var e,t;(e=this.particleBuffer)==null||e.destroy(),(t=this.uniformBuffer)==null||t.destroy()}}class b{constructor(e,t){this.uniformLocations={},this.canvas=e,this.particleCount=t,this.particles=new Float32Array(t*8)}async init(){const e=this.canvas.getContext("webgl2");if(!e)throw new Error("WebGL2 is not supported in this browser");this.gl=e,this.initParticles(),await this.createShaders(),this.createBuffers(),this.gl.enable(this.gl.BLEND),this.gl.blendFunc(this.gl.SRC_ALPHA,this.gl.ONE_MINUS_SRC_ALPHA)}initParticles(){for(let e=0;e<this.particleCount;e++){const t=e*8;this.particles[t+0]=(Math.random()-.5)*2,this.particles[t+1]=(Math.random()-.5)*2,this.particles[t+2]=(Math.random()-.5)*.01,this.particles[t+3]=(Math.random()-.5)*.01,this.particles[t+4]=Math.random(),this.particles[t+5]=Math.random(),this.particles[t+6]=Math.random(),this.particles[t+7]=Math.random()}}async createShaders(){const e=`#version 300 es
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
    `,t=`#version 300 es
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
    `,i=this.compileShader(this.gl.VERTEX_SHADER,e),r=this.compileShader(this.gl.FRAGMENT_SHADER,t);if(this.program=this.gl.createProgram(),this.gl.attachShader(this.program,i),this.gl.attachShader(this.program,r),this.gl.linkProgram(this.program),!this.gl.getProgramParameter(this.program,this.gl.LINK_STATUS)){const s=this.gl.getProgramInfoLog(this.program);throw new Error("Failed to link program: "+s)}this.uniformLocations.deltaTime=this.gl.getUniformLocation(this.program,"u_deltaTime"),this.uniformLocations.time=this.gl.getUniformLocation(this.program,"u_time"),this.uniformLocations.mousePos=this.gl.getUniformLocation(this.program,"u_mousePos"),this.uniformLocations.mouseActive=this.gl.getUniformLocation(this.program,"u_mouseActive"),this.uniformLocations.particleSize=this.gl.getUniformLocation(this.program,"u_particleSize"),this.gl.deleteShader(i),this.gl.deleteShader(r)}compileShader(e,t){const i=this.gl.createShader(e);if(this.gl.shaderSource(i,t),this.gl.compileShader(i),!this.gl.getShaderParameter(i,this.gl.COMPILE_STATUS)){const r=this.gl.getShaderInfoLog(i);throw this.gl.deleteShader(i),new Error("Failed to compile shader: "+r)}return i}createBuffers(){this.vao=this.gl.createVertexArray(),this.gl.bindVertexArray(this.vao),this.particleBuffer=this.gl.createBuffer(),this.gl.bindBuffer(this.gl.ARRAY_BUFFER,this.particleBuffer),this.gl.bufferData(this.gl.ARRAY_BUFFER,this.particles,this.gl.DYNAMIC_DRAW);const e=32;this.gl.enableVertexAttribArray(0),this.gl.vertexAttribPointer(0,2,this.gl.FLOAT,!1,e,0),this.gl.enableVertexAttribArray(1),this.gl.vertexAttribPointer(1,2,this.gl.FLOAT,!1,e,8),this.gl.enableVertexAttribArray(2),this.gl.vertexAttribPointer(2,3,this.gl.FLOAT,!1,e,16),this.gl.enableVertexAttribArray(3),this.gl.vertexAttribPointer(3,1,this.gl.FLOAT,!1,e,28),this.gl.bindVertexArray(null)}updateParticles(e,t,i,r,s){for(let l=0;l<this.particleCount;l++){const c=l*8;let h=this.particles[c+0],n=this.particles[c+1],a=this.particles[c+2],o=this.particles[c+3],u=this.particles[c+7];if(s){const m=i-h,g=r-n,f=Math.sqrt(m*m+g*g);if(f<.5&&f>.001){const v=(.5-f)*.01;a+=m/f*v,o+=g/f*v}}h+=a*e*60,n+=o*e*60,a*=.98,o*=.98,(h<-1||h>1)&&(a*=-.8,h=Math.max(-1,Math.min(1,h))),(n<-1||n>1)&&(o*=-.8,n=Math.max(-1,Math.min(1,n)));const p=Math.sin(t+l*.01)*1e-4;o+=p,u=(u+e*.1)%1,this.particles[c+0]=h,this.particles[c+1]=n,this.particles[c+2]=a,this.particles[c+3]=o,this.particles[c+7]=u}}render(e,t,i,r,s,l=1){this.updateParticles(e,t,i,r,s),this.gl.bindBuffer(this.gl.ARRAY_BUFFER,this.particleBuffer),this.gl.bufferSubData(this.gl.ARRAY_BUFFER,0,this.particles),this.gl.clearColor(.05,.05,.15,1),this.gl.clear(this.gl.COLOR_BUFFER_BIT),this.gl.useProgram(this.program),this.uniformLocations.particleSize&&this.gl.uniform1f(this.uniformLocations.particleSize,l),this.gl.bindVertexArray(this.vao),this.gl.drawArrays(this.gl.POINTS,0,this.particleCount),this.gl.bindVertexArray(null)}updateParticleCount(e){this.particleCount=e,this.particles=new Float32Array(e*8),this.initParticles(),this.createBuffers()}destroy(){this.gl.deleteBuffer(this.particleBuffer),this.gl.deleteVertexArray(this.vao),this.gl.deleteProgram(this.program)}}class w{constructor(){this.webgpuRenderer=null,this.webglRenderer=null,this.currentRenderer="webgpu",this.particleCount=5e4,this.particleSize=1,this.lastTime=0,this.frameCount=0,this.fpsUpdateTime=0,this.currentFPS=0,this.frameTimeHistory=[],this.fpsHistory=[],this.maxHistoryLength=60*60,this.mouseX=0,this.mouseY=0,this.mouseActive=!1,this.animationFrameId=null,this.webgpuCanvas=document.getElementById("webgpu-canvas"),this.webglCanvas=document.getElementById("webgl-canvas"),this.errorMessageEl=document.getElementById("error-message"),this.resizeCanvases(),window.addEventListener("resize",()=>this.resizeCanvases()),this.setupEventListeners()}resizeCanvases(){const e=this.webgpuCanvas.parentElement,t=e.clientWidth,i=e.clientHeight,r=window.devicePixelRatio||1;[this.webgpuCanvas,this.webglCanvas].forEach(s=>{s.width=t*r,s.height=i*r,s.style.width=`${t}px`,s.style.height=`${i}px`})}setupEventListeners(){const e=document.getElementById("toggle-controls"),t=document.querySelector(".controls");e==null||e.addEventListener("click",()=>{t==null||t.classList.toggle("expanded")}),document.querySelectorAll('input[name="renderer"]').forEach(a=>{a.addEventListener("change",o=>{const u=o.target;this.switchRenderer(u.value)})});const r=document.getElementById("particle-count"),s=document.getElementById("particle-count-display");r.addEventListener("input",a=>{const o=a.target,u=parseInt(o.value);s.textContent=u.toLocaleString()}),r.addEventListener("change",a=>{const o=a.target;this.updateParticleCount(parseInt(o.value))});const l=document.getElementById("particle-size"),c=document.getElementById("particle-size-display");l.addEventListener("input",a=>{const o=a.target,u=parseFloat(o.value);c.textContent=u.toFixed(1),this.particleSize=u});const h=document.getElementById("reset-btn");h==null||h.addEventListener("click",()=>this.reset());const n=this.webgpuCanvas.parentElement;n.addEventListener("mouseenter",()=>{this.mouseActive=!0}),n.addEventListener("mouseleave",()=>{this.mouseActive=!1}),n.addEventListener("mousemove",a=>{const o=n.getBoundingClientRect(),u=a.clientX-o.left,p=a.clientY-o.top;this.mouseX=u/o.width*2-1,this.mouseY=-(p/o.height*2-1)}),n.addEventListener("touchstart",a=>{a.preventDefault(),this.mouseActive=!0,this.updateTouchPosition(a,n)}),n.addEventListener("touchend",()=>{this.mouseActive=!1}),n.addEventListener("touchmove",a=>{a.preventDefault(),this.updateTouchPosition(a,n)})}updateTouchPosition(e,t){if(e.touches.length>0){const i=t.getBoundingClientRect(),r=e.touches[0].clientX-i.left,s=e.touches[0].clientY-i.top;this.mouseX=r/i.width*2-1,this.mouseY=-(s/i.height*2-1)}}async switchRenderer(e){this.animationFrameId!==null&&(cancelAnimationFrame(this.animationFrameId),this.animationFrameId=null),this.currentRenderer=e,this.webgpuCanvas.classList.remove("active"),this.webglCanvas.classList.remove("active"),this.errorMessageEl.classList.remove("show"),this.frameCount=0,this.fpsUpdateTime=0,this.frameTimeHistory=[],this.fpsHistory=[],this.currentFPS=0,document.getElementById("fps").textContent="--",document.getElementById("frame-time").textContent="--",document.getElementById("avg-fps").textContent="--";try{e==="webgpu"?(this.webgpuRenderer||(this.webgpuRenderer=new y(this.webgpuCanvas,this.particleCount),await this.webgpuRenderer.init()),this.webgpuCanvas.classList.add("active"),document.getElementById("current-renderer").textContent="WebGPU"):(this.webglRenderer||(this.webglRenderer=new b(this.webglCanvas,this.particleCount),await this.webglRenderer.init()),this.webglCanvas.classList.add("active"),document.getElementById("current-renderer").textContent="WebGL"),this.lastTime=performance.now(),this.fpsUpdateTime=this.lastTime,this.animate(this.lastTime)}catch(t){this.showError(t instanceof Error?t.message:"Unknown error occurred")}}showError(e){this.errorMessageEl.textContent=e,this.errorMessageEl.classList.add("show")}updateParticleCount(e){this.particleCount=e,this.webgpuRenderer&&this.webgpuRenderer.updateParticleCount(e),this.webglRenderer&&this.webglRenderer.updateParticleCount(e),document.getElementById("particle-count-stat").textContent=e.toLocaleString(),this.frameCount=0,this.fpsUpdateTime=performance.now(),this.frameTimeHistory=[],this.fpsHistory=[],this.currentFPS=0,document.getElementById("fps").textContent="--",document.getElementById("frame-time").textContent="--",document.getElementById("avg-fps").textContent="--"}reset(){var e,t;(e=this.webgpuRenderer)==null||e.destroy(),(t=this.webglRenderer)==null||t.destroy(),this.webgpuRenderer=null,this.webglRenderer=null,this.frameTimeHistory=[],this.fpsHistory=[],this.switchRenderer(this.currentRenderer)}animate(e){const t=Math.min((e-this.lastTime)/1e3,.1);this.lastTime=e;const i=e/1e3;try{this.currentRenderer==="webgpu"&&this.webgpuRenderer?this.webgpuRenderer.render(t,i,this.mouseX,this.mouseY,this.mouseActive,this.particleSize):this.currentRenderer==="webgl"&&this.webglRenderer&&this.webglRenderer.render(t,i,this.mouseX,this.mouseY,this.mouseActive,this.particleSize)}catch(r){this.showError(r instanceof Error?r.message:"Rendering error occurred");return}this.updateStats(t),this.animationFrameId=requestAnimationFrame(r=>this.animate(r))}updateStats(e){this.frameCount++;const t=e*1e3;this.frameTimeHistory.push(t),this.frameTimeHistory.length>this.maxHistoryLength&&this.frameTimeHistory.shift();const i=performance.now();if(i-this.fpsUpdateTime>=200){if(this.currentFPS=1/e,this.fpsHistory.push(this.currentFPS),this.fpsHistory.length>this.maxHistoryLength&&this.fpsHistory.shift(),document.getElementById("fps").textContent=Math.round(this.currentFPS).toString(),document.getElementById("frame-time").textContent=t.toFixed(2)+" ms",this.fpsHistory.length>0){const r=this.fpsHistory.reduce((s,l)=>s+l,0)/this.fpsHistory.length;document.getElementById("avg-fps").textContent=Math.round(r).toString()}this.fpsUpdateTime=i}}async start(){await this.switchRenderer("webgpu")}}const P=new w;P.start().catch(d=>{console.error("Failed to start demo:",d)});

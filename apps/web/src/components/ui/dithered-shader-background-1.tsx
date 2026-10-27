"use client";

import { useEffect, useRef } from "react";

const VERTEX_SHADER = `attribute vec2 a_position;
void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
}`;

const FRAGMENT_SHADER = `precision highp float;
uniform vec2 u_resolution;
uniform float u_time;
uniform float u_scale;

vec4 permute(vec4 x) {
  return mod(((x * 34.0) + 1.0) * x, 289.0);
}

vec4 taylorInvSqrt(vec4 r) {
  return 1.79284291400159 - 0.85373472095314 * r;
}

float snoise(vec3 v) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod(i, 289.0);

  vec4 p = permute(
    permute(
      permute(i.z + vec4(0.0, i1.z, i2.z, 1.0))
      + i.y + vec4(0.0, i1.y, i2.y, 1.0)
    )
    + i.x + vec4(0.0, i1.x, i2.x, 1.0)
  );
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(
    dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)
  ));
  p0 *= norm.x;
  p1 *= norm.y;
  p2 *= norm.z;
  p3 *= norm.w;
  vec4 m = max(0.6 - vec4(
    dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)
  ), 0.0);
  m *= m;
  return 42.0 * dot(m * m, vec4(
    dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)
  ));
}

float bayer2(vec2 a) {
  a = floor(a);
  return fract(a.x / 2.0 + a.y * a.y * 0.75);
}
#define BAYER4(a)  (bayer2(0.5 * (a)) * 0.25 + bayer2(a))
#define BAYER8(a)  (BAYER4(0.5 * (a)) * 0.25 + bayer2(a))
#define BAYER16(a) (BAYER8(0.5 * (a)) * 0.25 + bayer2(a))
#define BAYER32(a) (BAYER16(0.5 * (a)) * 0.25 + bayer2(a))

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  uv.x *= u_resolution.x / u_resolution.y;
  float t = u_time * 0.5;
  float n1 = snoise(vec3(uv, t));
  float n2 = snoise(vec3(uv + 5.0, t * 1.2));
  float gray = mix(n1, n2, 0.5) * 0.5 + 0.5;
  float d = step(BAYER32(gl_FragCoord.xy * u_scale), gray);
  gl_FragColor = vec4(vec3(d), 1.0);
}`;

type Props = {
  className?: string;
  scale?: number;
};

function compileShader(gl: WebGLRenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("Could not create shader.");

  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader) ?? "Unknown shader compilation error.";
    gl.deleteShader(shader);
    throw new Error(message);
  }
  return shader;
}

export default function DitheredShaderBackground({ className = "", scale = 0.5 }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const motionPreference = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (motionPreference.matches) return;

    const gl = canvas.getContext("webgl", {
      alpha: true,
      antialias: false,
      depth: false,
      powerPreference: "low-power",
      stencil: false,
    });
    if (!gl) {
      console.error("[Fleet Live shader background] WebGL is unavailable; keeping the first-paint texture.");
      return;
    }

    let program: WebGLProgram | null = null;
    let buffer: WebGLBuffer | null = null;
    let frameId = 0;
    let previousFrame = 0;
    let disposed = false;
    let resizeObserver: ResizeObserver | undefined;
    let vertex: WebGLShader | undefined;
    let fragment: WebGLShader | undefined;

    try {
      vertex = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
      fragment = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
      program = gl.createProgram();
      if (!program) throw new Error("Could not create shader program.");

      gl.attachShader(program, vertex);
      gl.attachShader(program, fragment);
      gl.linkProgram(program);
      gl.deleteShader(vertex);
      gl.deleteShader(fragment);
      vertex = undefined;
      fragment = undefined;
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        throw new Error(gl.getProgramInfoLog(program) ?? "Unknown shader link error.");
      }

      buffer = gl.createBuffer();
      if (!buffer) throw new Error("Could not create shader geometry.");
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(
        gl.ARRAY_BUFFER,
        new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
        gl.STATIC_DRAW,
      );

      const position = gl.getAttribLocation(program, "a_position");
      const resolution = gl.getUniformLocation(program, "u_resolution");
      const time = gl.getUniformLocation(program, "u_time");
      const shaderScale = gl.getUniformLocation(program, "u_scale");
      if (position < 0 || !resolution || !time || !shaderScale) {
        throw new Error("Could not resolve shader inputs.");
      }

      gl.useProgram(program);
      gl.enableVertexAttribArray(position);
      gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
      gl.disable(gl.BLEND);

      const resize = () => {
        const bounds = canvas.getBoundingClientRect();
        const pixelRatio = Math.min(window.devicePixelRatio || 1, 1);
        const width = Math.max(1, Math.round(bounds.width * pixelRatio));
        const height = Math.max(1, Math.round(bounds.height * pixelRatio));
        if (canvas.width !== width || canvas.height !== height) {
          canvas.width = width;
          canvas.height = height;
          gl.viewport(0, 0, width, height);
        }
      };

      resizeObserver = new ResizeObserver(resize);
      resizeObserver.observe(canvas);
      resize();

      const draw = (now: number) => {
        if (disposed) return;
        frameId = window.requestAnimationFrame(draw);
        if (now - previousFrame < 50) return;
        previousFrame = now;

        gl.useProgram(program);
        gl.uniform2f(resolution, canvas.width, canvas.height);
        gl.uniform1f(time, now / 1000);
        gl.uniform1f(shaderScale, scale);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        canvas.dataset.shaderState = "rendered";
      };

      const handleMotionChange = () => {
        if (motionPreference.matches) {
          window.cancelAnimationFrame(frameId);
          gl.clearColor(0, 0, 0, 0);
          gl.clear(gl.COLOR_BUFFER_BIT);
          canvas.dataset.shaderState = "reduced-motion";
        } else {
          previousFrame = 0;
          canvas.dataset.shaderState = "ready";
          frameId = window.requestAnimationFrame(draw);
        }
      };

      canvas.dataset.shaderState = "ready";
      frameId = window.requestAnimationFrame(draw);
      motionPreference.addEventListener("change", handleMotionChange);

      return () => {
        disposed = true;
        window.cancelAnimationFrame(frameId);
        resizeObserver?.disconnect();
        motionPreference.removeEventListener("change", handleMotionChange);
        if (buffer) gl.deleteBuffer(buffer);
        if (program) gl.deleteProgram(program);
      };
    } catch (error) {
      console.error("[Fleet Live shader background] WebGL setup failed; keeping the first-paint texture.", error);
      if (vertex) gl.deleteShader(vertex);
      if (fragment) gl.deleteShader(fragment);
      if (buffer) gl.deleteBuffer(buffer);
      if (program) gl.deleteProgram(program);
    }
  }, [scale]);

  return (
    <div
      className={`shader-background pointer-events-none absolute inset-0 overflow-hidden opacity-[0.08] mix-blend-screen ${className}`}
      aria-hidden="true"
      data-testid="dithered-shader-background"
    >
      <canvas ref={canvasRef} className="absolute inset-0 size-full" data-testid="dithered-shader-canvas" />
    </div>
  );
}

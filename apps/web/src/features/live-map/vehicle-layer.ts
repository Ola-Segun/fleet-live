import type { CustomLayerInterface, CustomRenderMethodInput, Map as MapLibreMap } from "maplibre-gl";
import { DEFAULT_STALENESS, TEXTURE_WIDTH, VEHICLE_FRAGMENT_SHADER, VEHICLE_VERTEX_SHADER, rtcMatrix } from "@fleet/gl";
import type { FleetGpuState } from "@/lib/gpu-state";

export interface VehicleLayerStats {
  /** Frames drawn. */
  frames: number;
  /** CPU time of the last `render()`, ms: upload + uniforms + one draw call. */
  renderMs: number;
  /** Full-texture uploads. At most one per frame, only when rows arrived. */
  uploads: number;
  contextRestores: number;
  /** Layers added: 1 at start, +1 after each restored context. */
  layersAdded: number;
  /** Frames skipped because the layer had nothing to draw yet (for diagnosing a blank layer). */
  skipped: number;
  /** Trucks drawn as alert diamonds in the last frame. */
  alerting: number;
}

/** Icon size in CSS pixels by zoom: dots when the whole metro is in view, arrows when zoomed in. */
function iconSize(zoom: number): number {
  if (zoom < 11.5) return 5;
  if (zoom < 14) return 14;
  return 20;
}

const UNIFORMS = [
  "u_samples",
  "u_alerts",
  "u_matrix",
  "u_time",
  "u_viewport",
  "u_size",
  "u_bearing",
  "u_extrapolate",
  "u_movingStale",
  "u_parkedStale",
  "u_detail",
  "u_modeMask",
  "u_selected",
  "u_pass",
  "u_dark",
] as const;

/**
 * The fleet as a MapLibre custom layer: one instanced draw call for every
 * truck, with interpolation on the GPU every frame.
 *
 * The CPU's work per frame is fixed and small: at most one texture upload
 * (only if rows arrived since the last frame), a dozen uniforms, and one draw.
 * The per-truck work (finding the two samples around the display time,
 * interpolating, choosing a shape) happens in the vertex shader, which mirrors
 * `gpuEstimate()` in @fleet/gl.
 *
 * **After a lost WebGL context, this layer is gone.** MapLibre 5 destroys the
 * style on context loss and does not restore custom layers, as its own console
 * warning says. The map's owner (LiveMap) adds a new VehicleLayer once the
 * style has reloaded. Because the data lives in FleetGpuState, the new layer
 * draws every truck on its first frame.
 */
export class VehicleLayer implements CustomLayerInterface {
  readonly id = "fleet-vehicles";
  readonly type = "custom" as const;
  readonly renderingMode = "2d" as const;


  private map: MapLibreMap | undefined;
  private gl: WebGL2RenderingContext | undefined;
  private program: WebGLProgram | undefined;
  private vao: WebGLVertexArrayObject | undefined;
  private buffer: WebGLBuffer | undefined;
  private texture: WebGLTexture | undefined;
  private alertTexture: WebGLTexture | undefined;
  private alertVersion = -1;
  private uniforms: Partial<Record<(typeof UNIFORMS)[number], WebGLUniformLocation | null>> = {};
  private uploadedHeight = 0;
  private readonly matrix = new Float32Array(16);
  private readonly reducedMotion = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  private lastReducedRepaint = 0;

  /**
   * `state` outlives the layer: see FleetGpuState. `stats` too, so counters keep
   * running when the layer is replaced after a lost WebGL context.
   */
  constructor(
    private readonly state: FleetGpuState,
    readonly stats: VehicleLayerStats,
  ) {}

  /** Called by the state after each update from the Worker. */
  private readonly onData = () => {
    if (!this.reducedMotion) {
      this.map?.triggerRepaint();
      return;
    }
    // Reduced motion: no continuous animation. The fleet steps every 2 s instead.
    const now = performance.now();
    if (now - this.lastReducedRepaint >= 2000) {
      this.lastReducedRepaint = now;
      this.map?.triggerRepaint();
    }
  };

  onAdd(map: MapLibreMap, gl: WebGLRenderingContext | WebGL2RenderingContext): void {
    this.map = map;
    this.gl = gl as WebGL2RenderingContext;
    this.state.onChange = this.onData;
    this.createResources();
  }

  onRemove(): void {
    if (this.state.onChange === this.onData) this.state.onChange = undefined;
    const gl = this.gl;
    if (gl) {
      gl.deleteProgram(this.program ?? null);
      gl.deleteVertexArray(this.vao ?? null);
      gl.deleteBuffer(this.buffer ?? null);
      gl.deleteTexture(this.texture ?? null);
      gl.deleteTexture(this.alertTexture ?? null);
    }
    this.program = undefined;
  }

  private createResources(): void {
    const gl = this.gl;
    if (!gl) return;
    this.program = link(gl, VEHICLE_VERTEX_SHADER, VEHICLE_FRAGMENT_SHADER);
    for (const name of UNIFORMS) this.uniforms[name] = gl.getUniformLocation(this.program, name);

    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    this.buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);

    this.texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    // texelFetch ignores filtering, but an incomplete texture samples as black, so set them.
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.uploadedHeight = 0;
    this.state.mirror.dirty = true;

    this.alertTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.alertTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.alertVersion = -1;
  }

  render(gl: WebGLRenderingContext | WebGL2RenderingContext, args: CustomRenderMethodInput): void {
    const g = gl as WebGL2RenderingContext;
    const map = this.map;
    const { mirror, clock, epoch } = this.state;
    if (!map || !this.program || epoch === undefined || mirror.count === 0) {
      this.stats.skipped++;
      return;
    }
    const start = performance.now();
    const display = clock.now(start);
    if (display === undefined) return;
    this.state.lastDisplay = display;

    g.activeTexture(g.TEXTURE0);
    g.bindTexture(g.TEXTURE_2D, this.texture ?? null);
    if (mirror.dirty) {
      // MapLibre sets these for its image uploads and can leave them on. With an
      // ArrayBufferView source they must be off, or the upload fails.
      g.pixelStorei(g.UNPACK_FLIP_Y_WEBGL, false);
      g.pixelStorei(g.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      g.pixelStorei(g.UNPACK_ALIGNMENT, 4);
      const height = mirror.height;
      if (height !== this.uploadedHeight) {
        g.texImage2D(g.TEXTURE_2D, 0, g.RGBA32F, TEXTURE_WIDTH, height, 0, g.RGBA, g.FLOAT, mirror.data);
        this.uploadedHeight = height;
      } else {
        g.texSubImage2D(g.TEXTURE_2D, 0, 0, 0, TEXTURE_WIDTH, height, g.RGBA, g.FLOAT, mirror.data);
      }
      mirror.dirty = false;
      this.stats.uploads++;
    }

    // The alert flags: a second, tiny texture (one byte per truck), uploaded only when alerts change.
    const alerts = this.state.alertTexture();
    g.activeTexture(g.TEXTURE1);
    g.bindTexture(g.TEXTURE_2D, this.alertTexture ?? null);
    if (alerts.version !== this.alertVersion) {
      g.pixelStorei(g.UNPACK_ALIGNMENT, 1);
      g.texImage2D(g.TEXTURE_2D, 0, g.R8, alerts.width, alerts.height, 0, g.RED, g.UNSIGNED_BYTE, alerts.data);
      g.pixelStorei(g.UNPACK_ALIGNMENT, 4);
      this.alertVersion = alerts.version;
    }
    g.activeTexture(g.TEXTURE0);

    const u = this.uniforms;
    g.useProgram(this.program);
    g.uniform1i(u.u_samples!, 0);
    g.uniform1i(u.u_alerts!, 1);
    g.uniformMatrix4fv(u.u_matrix!, false, rtcMatrix(args.defaultProjectionData.mainMatrix, this.matrix));
    g.uniform1f(u.u_time!, (display - epoch) / 1000);
    g.uniform2f(u.u_viewport!, g.drawingBufferWidth, g.drawingBufferHeight);
    const zoom = map.getZoom();
    g.uniform1f(u.u_size!, iconSize(zoom) * (window.devicePixelRatio || 1));
    g.uniform1f(u.u_bearing!, (map.getBearing() * Math.PI) / 180);
    g.uniform1f(u.u_extrapolate!, DEFAULT_STALENESS.extrapolateS);
    g.uniform1f(u.u_movingStale!, DEFAULT_STALENESS.movingStaleS);
    g.uniform1f(u.u_parkedStale!, DEFAULT_STALENESS.parkedStaleS);
    g.uniform1f(u.u_detail!, zoom >= 11.5 ? 1 : 0);
    g.uniform1i(u.u_modeMask!, this.state.mask);
    g.uniform1i(u.u_selected!, this.state.selectedSlot);
    g.uniform1f(u.u_dark!, this.state.dark ? 1 : 0);

    g.enable(g.BLEND);
    g.blendFunc(g.ONE, g.ONE_MINUS_SRC_ALPHA); // premultiplied alpha, as MapLibre blends
    g.disable(g.DEPTH_TEST);
    g.bindVertexArray(this.vao ?? null);
    // Up to three passes, so alerting trucks sit above the rest and the selected truck above
    // everything: WebGL2 has no base-instance draw, so each pass runs every instance and the
    // shader culls the ones that aren't its own immediately.
    g.uniform1i(u.u_pass!, 0);
    g.drawArraysInstanced(g.TRIANGLE_STRIP, 0, 4, mirror.count);
    if (this.state.alertCount > 0) {
      g.uniform1i(u.u_pass!, 1);
      g.drawArraysInstanced(g.TRIANGLE_STRIP, 0, 4, mirror.count);
    }
    if (this.state.selectedSlot >= 0) {
      g.uniform1i(u.u_pass!, 2);
      g.drawArraysInstanced(g.TRIANGLE_STRIP, 0, 4, mirror.count);
    }
    g.bindVertexArray(null);

    this.stats.frames++;
    this.stats.alerting = this.state.alertCount;
    this.stats.renderMs = performance.now() - start;
    // Keep animating: positions change every frame even when no new data arrives.
    if (!this.reducedMotion) map.triggerRepaint();
  }
}

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type)!;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`vehicle shader failed to compile: ${log}`);
  }
  return shader;
}

function link(gl: WebGL2RenderingContext, vertex: string, fragment: string): WebGLProgram {
  const program = gl.createProgram()!;
  const vs = compile(gl, gl.VERTEX_SHADER, vertex);
  const fs = compile(gl, gl.FRAGMENT_SHADER, fragment);
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.bindAttribLocation(program, 0, "a_corner");
  gl.linkProgram(program);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(`vehicle program failed to link: ${gl.getProgramInfoLog(program)}`);
  return program;
}

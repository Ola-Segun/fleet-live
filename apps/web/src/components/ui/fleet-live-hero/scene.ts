/**
 * Fleet Live hero — scene engine
 * ------------------------------------------------------------------
 * Framework-free Canvas2D renderer. One class, no dependencies.
 *
 * World model (right-handed, camera looks down +d):
 *   z = lateral position, y = height above ground, d = distance from camera.
 *   Perspective: screen = vanishing point + (z, height) * focal / d.
 *
 * Story: raw, jittery reports travel away from the viewer, pass through a
 * thick "signal dial" (a glass-and-metal slab with an engraved scale),
 * and come out the other side as smooth, orderly tracks. Every time a
 * signal touches the dial, that lane's index lights up and the nearby
 * ticks thicken and glow, then fade.
 *
 * Past the dial the lanes converge, brake into a bend and climb a vertical
 * launch channel (see ascent.ts), accelerating as they go.
 *
 * Tune the look from the CONFIG block below (and ASCENT in ascent.ts).
 */

import { Ascent, type AgentState, type AscentConfig, type AscentFrame } from './ascent';

export type Counters = [number, number, number];
export interface SceneAnchors {
  /** Y position (px, relative to the hero) of the horizon / vanishing point. */
  horizonY: number;
  dialCenterX: number;
  dialHalfWidth: number;
}
/** Measured page layout, used to compose the scene around the copy on small screens. */
export interface SceneLayout {
  /** Bottom edge (px, hero-local) of the headline/copy block. */
  topInset?: number;
  /** Space (px) to keep clear at the bottom, e.g. for the counters strip. */
  bottomInset?: number;
}
export interface SceneOptions {
  reducedMotion?: boolean;
  onCounters?: (v: Counters) => void;
  onAnchors?: (a: SceneAnchors) => void;
  /** Canvas factory for sprites/offscreen buffers. Override for tests or workers. */
  makeCanvas?: () => HTMLCanvasElement;
  /** Overrides for the launch channel (see ASCENT in ascent.ts). */
  ascent?: Partial<AscentConfig>;
}

/* ------------------------------ CONFIG ------------------------------ */
const CONFIG = {
  /** RGB triplets (no alpha) used throughout. */
  lime: '200,237,115',
  cool: '170,190,228',
  /** Depth range of the world and where the dial sits (front / back faces). */
  dMin: 2.4,
  dMax: 46,
  dialFront: 5.4,
  dialBack: 5.95,
  /** Dial height in world units. */
  dialHeight: 0.5,
  /** Seconds a lit lane takes to fall to ~18% brightness. */
  litDecay: 2.2,
  /** Seconds between rare amber alerts. */
  alertEvery: 8,
  /** Short text inside the alert pill. Use '' for an icon-only pill. */
  alertLabel: 'Zone exit',
  /** Channel numbers printed on the dial face. Off by default: the scene carries no text. */
  dialNumerals: false,
};
/* -------------------------------------------------------------------- */

const { lime: LIME, cool: COOL } = CONFIG;
const AMBER = '255,176,32';
const LIME_SOLID = 'rgba(200,237,115,1)';
const REPORT_SOLID = 'rgba(143,163,199,1)';
/** Alert choreography, in seconds from detection. */
const ALERT = { exit: 1.3, open: 1.5, openDur: 0.55, close: 3.9, closeDur: 0.5, end: 4.8, zoneHalfWidth: 0.9 } as const;
const DMIN = CONFIG.dMin;
const DMAX = CONFIG.dMax;
const DF = CONFIG.dialFront;
const DB = CONFIG.dialBack;
const MAX_DPR = 1.5;
const MAX_CANVAS_PIXELS = 12_000_000;
const LR = Math.log(DMAX / DMIN);
const UF = Math.log(DF / DMIN) / LR;

interface Lane {
  i: number;
  v: number;
  z0: number;
  lime: boolean;
  lit: number;
  litE: number;
}
interface Agent {
  lane: Lane;
  u: number;
  sp: number;
  seed: number;
  pf: number | null;
}
interface AlertState {
  agent: Agent;
  t0: number;
  /** Geofence centre depth, depth radius, and lateral position. */
  dC: number;
  Rd: number;
  zC: number;
  /** Smoothed pill position (px). NaN until first placed. */
  ax: number;
  ay: number;
}
interface Placed {
  a: Agent;
  u: number;
  d: number;
  /** True while the vehicle is on the vertical climb. */
  asc: boolean;
  /** Climb time fraction 0..1. */
  x: number;
  /** Stable index, for per-vehicle edge detection. */
  i: number;
}

function comparePlacedByDepth(a: Placed, b: Placed): number {
  return b.d - a.d;
}

const clamp = (v: number, a: number, b: number): number => Math.min(b, Math.max(a, v));
const ss = (a: number, b: number, x: number): number => {
  const k = clamp((x - a) / (b - a), 0, 1);
  return k * k * (3 - 2 * k);
};
const hash = (a: number, b: number): number => {
  const h = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return h - Math.floor(h);
};
const dOf = (u: number): number => DMIN * Math.exp(u * LR);
const inSlab = (d: number): boolean => d > DF - 0.02 && d < DB + 0.1;
const mixCol = (I: number, a: number): string =>
  `rgba(${Math.round(214 + (182 - 214) * I)},${Math.round(224 + (242 - 224) * I)},${Math.round(245 + (60 - 245) * I)},${a})`;

export function getCenteredDialGeometry(width: number, span: number): { laneHalfWidth: number; edgePadding: number } {
  const worldHalfWidth = (width * 0.47 * 1.6) / (span * 1.1);
  const edgePadding = Math.min(0.3, worldHalfWidth * 0.25);
  return { laneHalfWidth: worldHalfWidth - edgePadding, edgePadding };
}

function roundRect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const k = Math.min(r, w / 2, h / 2);
  c.beginPath();
  c.moveTo(x + k, y);
  c.lineTo(x + w - k, y);
  c.quadraticCurveTo(x + w, y, x + w, y + k);
  c.lineTo(x + w, y + h - k);
  c.quadraticCurveTo(x + w, y + h, x + w - k, y + h);
  c.lineTo(x + k, y + h);
  c.quadraticCurveTo(x, y + h, x, y + h - k);
  c.lineTo(x, y + k);
  c.quadraticCurveTo(x, y, x + k, y);
  c.closePath();
}

export class HeroScene {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly mk: () => HTMLCanvasElement;
  private readonly off: HTMLCanvasElement;
  private readonly octx: CanvasRenderingContext2D;
  private readonly gLime: HTMLCanvasElement;
  private readonly gCool: HTMLCanvasElement;
  private readonly gAmber: HTMLCanvasElement;
  private readonly beam: HTMLCanvasElement;
  private readonly curtain: HTMLCanvasElement;
  private readonly asc: Ascent;
  private phased = false;
  private readonly af: AscentFrame;
  private readonly ast: AgentState = { ascending: false, u: 0, x: 0 };
  private readonly onCounters?: (v: Counters) => void;
  private readonly onAnchors?: (a: SceneAnchors) => void;

  private rm: boolean;
  private W = 0;
  private H = 0;
  private dpr = 1;
  private small = false;
  private VX = 0;
  private VY = 0;
  private F = 0;
  private Fe = 0;
  private centerBlend = 0;
  private zc = 0;
  private zh = 0;
  private pad = 0;
  private hg = 0;
  private cz = 0;
  private ch = 1.6;
  private px = 0;
  private py = 0;
  private ps = 1;
  private atmosphereHorizon: CanvasGradient | null = null;
  private lanes: Lane[] = [];
  private agents: Agent[] = [];
  private placed: Placed[] = [];
  private readonly trailX = new Float32Array(18);
  private readonly trailY = new Float32Array(18);
  private readonly trailAlpha = new Float32Array(18);
  private readonly trailWidth = new Float32Array(18);
  private readonly trailVisible = new Uint8Array(18);
  private bokeh: { z: number; y: number; d: number; r: number; ph: number }[] = [];
  private alert: AlertState | null = null;
  private nextAlert: number | null = null;
  private ptr = { x: 0, y: 0, tx: 0, ty: 0, on: false, k: 0, touch: false };
  private scroll = 0;
  private cnt: Counters;
  private cntDirty = true;
  private T = 0;
  private el = 0;
  private IN = 1;
  private lastT = 0;
  private R = 140;
  private N = 14;

  constructor(canvas: HTMLCanvasElement, opts: SceneOptions = {}) {
    const ctx = canvas.getContext('2d', { desynchronized: true });
    if (!ctx) throw new Error('HeroScene: 2D canvas is unavailable');
    this.canvas = canvas;
    this.ctx = ctx;
    this.mk = opts.makeCanvas ?? (() => document.createElement('canvas'));
    this.off = this.mk();
    const o = this.off.getContext('2d', { desynchronized: true });
    if (!o) throw new Error('HeroScene: offscreen 2D canvas is unavailable');
    this.octx = o;
    this.rm = !!opts.reducedMotion;
    this.cnt = this.rm ? [42, 17, 9] : [0, 0, 0];
    this.onCounters = opts.onCounters;
    this.onAnchors = opts.onAnchors;
    this.gLime = this.radial(LIME);
    this.gCool = this.radial(COOL);
    this.gAmber = this.radial(AMBER);
    this.beam = this.makeBeam();
    this.curtain = this.makeCurtain();
    this.asc = new Ascent({ dMin: DMIN, dMax: DMAX, dialBack: DB, makeCanvas: this.mk, config: opts.ascent });
    this.af = {
      W: 0, H: 0, VX: 0, VY: 0, F: 0, Fe: 0, T: 0, IN: 1, dt: 0, small: false, scroll: 0, rm: this.rm, top: -30,
      proj: (z, y, d, o) => {
        const s = this.Fe / d;
        o.x = this.VX + (z - this.cz) * s;
        o.y = this.VY + (this.ch - y) * s;
        o.s = s;
      },
      laneZ: (l, d) => this.laneZ(l, d, this.T),
    };
  }

  /* ------------------------------ public API ------------------------------ */

  resize(w: number, h: number, dpr: number, layout?: SceneLayout): void {
    this.W = w;
    this.H = h;
    const pixelRatioLimit = Math.sqrt(MAX_CANVAS_PIXELS / Math.max(1, w * h));
    this.dpr = Math.min(dpr || 1, MAX_DPR, pixelRatioLimit);
    this.canvas.width = Math.max(2, Math.round(w * this.dpr));
    this.canvas.height = Math.max(2, Math.round(h * this.dpr));
    this.off.width = Math.max(2, Math.round(w * this.dpr));
    this.off.height = Math.max(2, Math.round(Math.max(170, h * 0.3) * this.dpr));
    this.small = w < 820;
    this.centerBlend = 1 - ss(960, 1200, w);
    if (this.small) {
      // Portrait composition: copy on top, horizon just below it, dial low on the screen.
      const top = layout?.topInset ?? h * 0.54;
      const bottom = layout?.bottomInset ?? 118;
      this.VX = w * 0.5;
      this.VY = clamp(top + 14, h * 0.38, h * 0.64);
      const span = Math.max(140, h - bottom - this.VY);
      this.F = (span * DF) / 1.6;
      this.zc = 0;
      const dial = getCenteredDialGeometry(w, span);
      this.pad = dial.edgePadding;
      this.hg = 1.35;
      this.zh = dial.laneHalfWidth;
    } else {
      this.F = Math.max(h * 1.05, Math.min(w * 0.66, h * 1.5));
      this.VX = w * (0.68 - 0.18 * this.centerBlend);
      this.VY = h * 0.36;
      this.zc = -0.8 * (1 - this.centerBlend);
      const span = (1.6 * this.F) / DF;
      const dial = getCenteredDialGeometry(w, span);
      this.pad = dial.edgePadding * this.centerBlend + 0.6 * (1 - this.centerBlend);
      this.zh = dial.laneHalfWidth * this.centerBlend + 2.3 * (1 - this.centerBlend);
      this.hg = 1.7;
    }
    const n = this.small ? 5 : 13;
    const per = 3;
    this.lanes = Array.from({ length: n }, (_, i) => {
      const v = (i / (n - 1)) * 2 - 1;
      return { i, v, z0: this.zc + v * this.zh, lime: i % 3 === 0, lit: 0, litE: 0 };
    });
    this.asc.setLanes(this.lanes, this.zh, this.pad);
    this.phased = false;
    this.agents = [];
    for (const lane of this.lanes) {
      for (let k = 0; k < per; k++) {
        this.agents.push({
          lane,
          u: (k + hash(lane.i, k)) / per,
          sp: 0.054, // one shared rate keeps launches evenly spread for as long as the page is open
          seed: lane.i * 31 + k * 7,
          pf: null,
        });
      }
    }
    this.bokeh = Array.from({ length: this.small ? 5 : 9 }, (_, i) => ({
      z: this.zc + (hash(i, 1) - 0.5) * 6,
      y: 0.2 + hash(i, 2) * 1.1,
      d: 1.3 + hash(i, 3) * 0.6,
      r: 0.1 + hash(i, 4) * 0.12,
      ph: hash(i, 5) * 6.28,
    }));
    this.atmosphereHorizon = this.ctx.createLinearGradient(this.VX - this.W * 0.35, 0, this.VX + this.W * 0.35, 0);
    this.atmosphereHorizon.addColorStop(0, `rgba(${COOL},0)`);
    this.atmosphereHorizon.addColorStop(0.5, `rgba(${COOL},.18)`);
    this.atmosphereHorizon.addColorStop(1, `rgba(${COOL},0)`);
    this.placed = this.agents.map((a, i) => ({ a, u: 0, d: 0, asc: false, x: 0, i }));
    this.onAnchors?.({
      horizonY: this.VY,
      dialCenterX: this.VX + (this.zc * this.F) / DF,
      dialHalfWidth: ((this.zh + this.pad) * this.F * 1.1) / DF,
    });
  }

  /**
   * Pointer position in hero-local CSS pixels. Ignored in reduced-motion mode.
   * Touch input lights the dial and clears noise under the finger but never moves the camera.
   */
  setPointer(x: number, y: number, on: boolean, touch = false): void {
    if (this.rm) return;
    const p = this.ptr;
    if (on) {
      if (!p.on) {
        p.x = x;
        p.y = y;
      }
      p.tx = x;
      p.ty = y;
      p.touch = touch;
    }
    p.on = on;
  }

  /** 0 at rest, 1 when the hero has scrolled ~75% out of view. */
  setScroll(p: number): void {
    this.scroll = this.rm ? 0 : clamp(p, 0, 1);
  }

  setReducedMotion(rm: boolean): void {
    this.rm = rm;
    this.cnt = rm ? [42, 17, 9] : [0, 0, 0];
    this.cntDirty = true;
    this.alert = null;
    this.nextAlert = null;
    if (rm) {
      this.ptr.on = false;
      this.ptr.k = 0;
      this.scroll = 0;
    }
  }

  destroy(): void {
    this.off.width = 0;
    this.off.height = 0;
    this.canvas.width = 0;
    this.canvas.height = 0;
    this.lanes.length = 0;
    this.agents.length = 0;
    this.placed.length = 0;
    this.bokeh.length = 0;
    this.alert = null;
  }

  /** Draw one frame. `el` is seconds since mount. */
  render(el: number): void {
    if (!this.W || !this.H) return;
    const { ctx } = this;
    const rm = this.rm;
    const t = rm ? 9 : el + 5;
    const dt = clamp(t - this.lastT, 0, 0.1);
    this.lastT = t;
    this.T = t;
    this.el = rm ? 9 : el;
    this.IN = rm ? 1 : ss(0, 1.5, this.el);
    this.Fe = this.F * (
      rm ? 1 : 1 + 0.1 * (1 - ss(0, 3, this.el)) + (this.small ? 0 : 0.35 * this.scroll * (1 - this.centerBlend))
    );

    const p = this.ptr;
    p.x += (p.tx - p.x) * 0.14;
    p.y += (p.ty - p.y) * 0.14;
    p.k += ((p.on ? 1 : 0) - p.k) * 0.08;
    const drift = rm ? 0 : 1;
    const push = p.touch ? 0 : 1; // pointer parallax is deliberately subtle; none for touch
    if (this.small) {
      this.cz = 0;
      this.ch = 1.6;
    } else {
      this.cz = (
        (p.x / this.W - 0.5) * 0.28 * p.k * push + Math.sin(t * 0.1) * 0.1 * drift
      ) * (1 - this.centerBlend);
      this.ch = 1.6 + (p.y / this.H - 0.5) * 0.07 * p.k * push + Math.sin(t * 0.07) * 0.04 * drift;
    }
    this.R = this.small ? 64 : 120;
    this.N = this.small ? 6 : 8;

    for (const l of this.lanes) {
      if (rm) l.lit = l.i === 3 || l.i === 7 ? 0.85 : 0;
      else l.lit *= Math.exp(-dt * CONFIG.litDecay);
    }

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.W, this.H);
    ctx.globalAlpha = this.IN;
    ctx.globalCompositeOperation = 'source-over';

    this.drawAtmosphere();
    const af = this.af;
    af.W = this.W; af.H = this.H; af.VX = this.VX; af.VY = this.VY; af.F = this.F; af.Fe = this.Fe;
    af.T = this.T; af.IN = this.IN; af.dt = rm ? 0 : dt; af.small = this.small; af.scroll = this.scroll; af.rm = rm;
    af.top = this.small ? Math.max(-30, this.VY - this.H * 0.24) : -30;
    this.asc.frame(af);
    if (!this.phased) {
      this.asc.stratify(this.agents);
      this.phased = true;
    }
    this.asc.drawBack(ctx, this.lanes);

    for (let i = 0; i < this.agents.length; i++) {
      const a = this.agents[i]!;
      const st = this.ast;
      this.asc.state(a.u, a.sp, t, st);
      const placed = this.placed[i]!;
      placed.a = a;
      placed.u = st.u;
      placed.asc = st.ascending;
      placed.x = st.x;
      placed.d = st.ascending ? 1e6 : dOf(st.u);
    }
    const list = this.placed;
    list.sort(comparePlacedByDepth);

    for (const o of list) {
      const a = o.a;
      if (!rm && this.el > 1.5 && a.pf !== null && a.pf < UF && o.u >= UF) this.touch(a);
      a.pf = o.u;
    }

    this.updateAlert(list);
    this.drawAlertGround();
    for (const o of list) if (o.d > DB) this.drawAgent(o);
    this.drawDial();
    for (const o of list) if (o.d <= DB) this.drawAgent(o);

    this.asc.drawFront(ctx);
    this.drawAlertOverlay();
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';

    if (this.cntDirty) {
      this.cntDirty = false;
      this.onCounters?.([this.cnt[0], this.cnt[1], this.cnt[2]]);
    }
  }

  /* ------------------------------ internals ------------------------------ */

  private proj(z: number, y: number, d: number): void {
    const s = this.Fe / d;
    this.px = this.VX + (z - this.cz) * s;
    this.py = this.VY + (this.ch - y) * s;
    this.ps = s;
  }

  private laneZ(l: { i: number; v: number }, d: number, t: number): number {
    const far = ss(DB, DMAX * 0.6, d);
    const wob = d < DF ? 1.5 * (1 - ss(DF - 1.6, DF, d)) : d < DB ? 0 : 0.3 * ss(DB, DB + 5, d);
    const w = Math.sin(d * 0.55 + l.i * 1.7 + t * 0.3) * 0.07 + Math.sin(d * 0.23 - l.i + t * 0.18) * 0.12;
    return this.zc + l.v * this.zh * (1 - 0.32 * far) + w * wob * (0.4 + 0.6 * ss(1.5, 8, d));
  }

  private touch(a: Agent): void {
    a.lane.lit = 1;
    this.cnt[0] += 1 + (Math.random() < 0.4 ? 1 : 0);
    this.cnt[1] += Math.random() < 0.6 ? 1 : 0;
    this.cnt[2] += Math.random() < 0.3 ? 1 : 0;
    this.cntDirty = true;
  }

  private radial(rgb: string): HTMLCanvasElement {
    const size = 64;
    const c = this.mk();
    c.width = c.height = size;
    const g = c.getContext('2d');
    if (!g) return c;
    const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    r.addColorStop(0, `rgba(${rgb},1)`);
    r.addColorStop(0.28, `rgba(${rgb},.4)`);
    r.addColorStop(1, `rgba(${rgb},0)`);
    g.fillStyle = r;
    g.fillRect(0, 0, size, size);
    return c;
  }

  /** Vertical light shaft: bright at the bottom, soft horizontal falloff. */
  private makeBeam(): HTMLCanvasElement {
    const w = 48;
    const h = 160;
    const c = this.mk();
    c.width = w;
    c.height = h;
    const g = c.getContext('2d');
    if (!g) return c;
    const v = g.createLinearGradient(0, 0, 0, h);
    v.addColorStop(0, `rgba(${LIME},0)`);
    v.addColorStop(0.5, `rgba(${LIME},.16)`);
    v.addColorStop(1, `rgba(${LIME},.85)`);
    g.fillStyle = v;
    g.fillRect(0, 0, w, h);
    g.globalCompositeOperation = 'destination-in';
    const hz = g.createLinearGradient(0, 0, w, 0);
    hz.addColorStop(0, 'rgba(0,0,0,0)');
    hz.addColorStop(0.5, 'rgba(0,0,0,1)');
    hz.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = hz;
    g.fillRect(0, 0, w, h);
    return c;
  }

  /** Very faint light curtain rising across the full dial. */
  private makeCurtain(): HTMLCanvasElement {
    const w = 256;
    const h = 128;
    const c = this.mk();
    c.width = w;
    c.height = h;
    const g = c.getContext('2d');
    if (!g) return c;
    const v = g.createLinearGradient(0, 0, 0, h);
    v.addColorStop(0, `rgba(${LIME},0)`);
    v.addColorStop(1, `rgba(${LIME},.16)`);
    g.fillStyle = v;
    g.fillRect(0, 0, w, h);
    g.globalCompositeOperation = 'destination-in';
    const hz = g.createLinearGradient(0, 0, w, 0);
    hz.addColorStop(0, 'rgba(0,0,0,0)');
    hz.addColorStop(0.2, 'rgba(0,0,0,1)');
    hz.addColorStop(0.8, 'rgba(0,0,0,1)');
    hz.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = hz;
    g.fillRect(0, 0, w, h);
    return c;
  }

  private drawAtmosphere(): void {
    const { ctx, VX, VY, W } = this;
    if (this.atmosphereHorizon) ctx.strokeStyle = this.atmosphereHorizon;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(VX - W * 0.35, VY);
    ctx.lineTo(VX + W * 0.35, VY);
    ctx.stroke();

    // Out-of-focus foreground discs: cheap, strong depth cue.
    ctx.globalCompositeOperation = 'lighter';
    for (const b of this.bokeh) {
      this.proj(b.z + Math.sin(this.T * 0.08 + b.ph) * 0.25, b.y + Math.cos(this.T * 0.06 + b.ph) * 0.1, b.d);
      const r = b.r * this.ps;
      ctx.globalAlpha = this.IN * 0.05;
      ctx.drawImage(this.gCool, this.px - r, this.py - r, r * 2, r * 2);
    }
    ctx.globalAlpha = this.IN;
    ctx.globalCompositeOperation = 'source-over';
  }

  /**
   * The signal dial: a thick glass-and-metal slab spanning every lane.
   * Drawn into an offscreen buffer so its ends can be darkened and faded
   * to transparent, then composited. Light spill is added afterwards.
   */
  private drawDial(): void {
    const { ctx, octx, dpr, lanes } = this;
    const el = this.el;
    const rm = this.rm;
    const s = this.Fe / DF;
    const zL = this.zc - this.zh - this.pad;
    const zR = this.zc + this.zh + this.pad;
    const DHe = CONFIG.dialHeight * (rm ? 1 : ss(0.3, 1.4, el));

    this.proj(zL, 0, DF);
    const x0 = this.px;
    const yB = this.py;
    this.proj(zR, 0, DF);
    const x1 = this.px;
    this.proj(zL, DHe, DF);
    const yT = this.py;
    this.proj(zL, DHe, DB);
    const bx0 = this.px;
    const byT = this.py;
    this.proj(zR, DHe, DB);
    const bx1 = this.px;
    const fw = x1 - x0;
    const fh = Math.max(1, yB - yT);

    // Contact shadow on the ground.
    ctx.save();
    ctx.translate((x0 + x1) / 2, yB + 3);
    ctx.scale(fw * 0.54, Math.max(6, s * 0.2));
    const sh = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    sh.addColorStop(0, 'rgba(0,0,0,.7)');
    sh.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = this.IN;
    ctx.fillStyle = sh;
    ctx.fillRect(-1, -1, 2, 2);
    ctx.restore();

    // Lighting inputs per lane.
    const dz = (2 * this.zh) / (lanes.length - 1);
    const sxOf = (z: number): number => this.VX + (z - this.cz) * s;
    const sigma = dz * s * 0.55;
    const ptr = this.ptr;
    const pf = ptr.k * ss(yT - 70, yT - 10, ptr.y) * (1 - ss(yB + 10, yB + 70, ptr.y));
    const boot = (x: number): number => {
      if (rm || el < 1 || el > 3) return 0;
      const bx = x0 + fw * (0.1 + 0.8 * ss(1, 2.6, el));
      const q = (x - bx) / (fw * 0.05);
      return Math.exp(-q * q) * (1 - ss(2.4, 3, el));
    };
    const hov = (x: number): number => {
      const q = (x - ptr.x) / (sigma * 1.1);
      return pf * 0.85 * Math.exp(-q * q);
    };
    for (const l of lanes) {
      const x = sxOf(l.z0);
      l.litE = clamp(l.lit + boot(x) + hov(x), 0, 1.25);
    }
    const litAt = (x: number): number => {
      let v = Math.max(boot(x), hov(x));
      for (const l of lanes) {
        const q = (x - sxOf(l.z0)) / sigma;
        v = Math.max(v, l.lit * Math.exp(-q * q));
      }
      return Math.min(v, 1.2);
    };

    // Offscreen buffer region (in main-canvas CSS px).
    const ox = Math.floor(x0 - 10);
    const oy = Math.floor(byT - 16);
    const ow = Math.min(Math.ceil(fw + 20), Math.floor(this.off.width / dpr));
    const oh = Math.min(Math.ceil(yB - byT + 34), Math.floor(this.off.height / dpr));
    octx.setTransform(1, 0, 0, 1, 0, 0);
    octx.clearRect(0, 0, this.off.width, this.off.height);
    octx.setTransform(dpr, 0, 0, dpr, -ox * dpr, -oy * dpr);
    octx.globalCompositeOperation = 'source-over';
    octx.globalAlpha = 1;

    // Front face: anodized metal.
    let g: CanvasGradient = octx.createLinearGradient(0, yT, 0, yB);
    g.addColorStop(0, 'rgba(46,58,86,.97)');
    g.addColorStop(0.12, 'rgba(27,36,58,.96)');
    g.addColorStop(0.7, 'rgba(13,19,34,.97)');
    g.addColorStop(1, 'rgba(7,10,20,.98)');
    octx.fillStyle = g;
    octx.fillRect(x0, yT, fw, fh);

    // Top face: brushed lip catching the key light.
    g = octx.createLinearGradient(0, byT, 0, yT);
    g.addColorStop(0, 'rgba(58,70,100,.95)');
    g.addColorStop(1, this.small ? 'rgba(82,96,128,.94)' : 'rgba(104,120,154,.92)');
    octx.fillStyle = g;
    octx.beginPath();
    octx.moveTo(x0, yT);
    octx.lineTo(x1, yT);
    octx.lineTo(bx1, byT);
    octx.lineTo(bx0, byT);
    octx.closePath();
    octx.fill();
    // Anisotropic sheen bands, like brushed metal under a soft box.
    g = octx.createLinearGradient(x0, 0, x1, 0);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    const sheen = this.small ? 0.55 : 1; // the lip is physically larger on phones; keep it from washing out
    g.addColorStop(0.28, `rgba(255,255,255,${0.16 * sheen})`);
    g.addColorStop(0.42, 'rgba(255,255,255,0)');
    g.addColorStop(0.66, `rgba(255,255,255,${0.1 * sheen})`);
    g.addColorStop(0.8, 'rgba(255,255,255,0)');
    octx.fillStyle = g;
    octx.fill();
    octx.strokeStyle = 'rgba(255,255,255,.42)';
    octx.lineWidth = 1;
    octx.beginPath();
    octx.moveTo(x0, yT + 0.5);
    octx.lineTo(x1, yT + 0.5);
    octx.stroke();
    octx.strokeStyle = 'rgba(0,0,0,.45)';
    octx.beginPath();
    octx.moveTo(bx0, byT);
    octx.lineTo(bx1, byT);
    octx.stroke();
    octx.strokeStyle = 'rgba(0,0,0,.7)';
    octx.beginPath();
    octx.moveTo(x0, yB - 0.5);
    octx.lineTo(x1, yB - 0.5);
    octx.stroke();

    // Frosted glass window.
    const wx0 = x0 + 12;
    const wy0 = yT + fh * 0.1;
    const ww = fw - 24;
    const wh = fh * 0.8;
    g = octx.createLinearGradient(0, wy0, 0, wy0 + wh);
    g.addColorStop(0, 'rgba(130,160,215,.13)');
    g.addColorStop(1, 'rgba(90,120,170,.03)');
    octx.fillStyle = g;
    roundRect(octx, wx0, wy0, ww, wh, 6);
    octx.fill();
    octx.strokeStyle = 'rgba(255,255,255,.09)';
    octx.stroke();
    g = octx.createLinearGradient(0, wy0, 0, wy0 + 12);
    g.addColorStop(0, 'rgba(0,0,0,.5)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    octx.fillStyle = g;
    octx.fillRect(wx0 + 1, wy0 + 1, ww - 2, 12);

    // Engraved scale.
    const n = lanes.length;
    const minor = this.small ? 3 : 4;
    const step = dz / (minor + 1);
    const yBase = wy0 + wh - 5;
    octx.strokeStyle = 'rgba(255,255,255,.12)';
    octx.lineWidth = 1;
    octx.beginPath();
    octx.moveTo(wx0 + 6, yBase + 1.5);
    octx.lineTo(wx0 + ww - 6, yBase + 1.5);
    octx.stroke();
    const jMin = -Math.floor(this.pad / step);
    for (let j = jMin; ; j++) {
      const z = this.zc - this.zh + j * step;
      if (z > zR - 0.02) break;
      const x = sxOf(z);
      const major = j >= 0 && j <= (n - 1) * (minor + 1) && j % (minor + 1) === 0;
      const I = clamp(litAt(x), 0, 1);
      const th = wh * (major ? 0.24 : 0.13) * (1 + 0.5 * I);
      const lw = (major ? 1.4 : 1) * (1 + 1.5 * I) * (this.small ? 0.8 : 1);
      octx.lineWidth = lw;
      octx.strokeStyle = 'rgba(0,0,0,.6)';
      octx.beginPath();
      octx.moveTo(x, yBase + 1);
      octx.lineTo(x, yBase + 1 - th);
      octx.stroke();
      octx.globalAlpha = (major ? 0.5 : 0.3) + 0.7 * I;
      octx.strokeStyle = 'rgba(214,224,245,1)';
      octx.beginPath();
      octx.moveTo(x, yBase);
      octx.lineTo(x, yBase - th);
      octx.stroke();
      octx.globalAlpha = 1;
      if (I > 0.2) {
        octx.globalCompositeOperation = 'lighter';
        octx.lineWidth = lw * 4;
        octx.globalAlpha = 0.16 * I;
        octx.strokeStyle = LIME_SOLID;
        octx.beginPath();
        octx.moveTo(x, yBase);
        octx.lineTo(x, yBase - th);
        octx.stroke();
        octx.globalAlpha = 1;
        octx.globalCompositeOperation = 'source-over';
      }
    }

    // Lane index slots and channel numerals.
    const cy = wy0 + wh * 0.45;
    const ph = wh * 0.3;
    const gp = octx.createLinearGradient(0, cy - ph / 2, 0, cy + ph / 2);
    gp.addColorStop(0, 'rgba(34,44,66,.95)');
    gp.addColorStop(1, 'rgba(16,22,38,.95)');
    octx.textAlign = 'center';
    octx.font = `500 ${clamp(s * 0.052, 8, 10)}px "JetBrains Mono", ui-monospace, Menlo, monospace`;
    for (const l of lanes) {
      const x = sxOf(l.z0);
      const Ic = Math.min(1, l.litE);
      const pw = Math.max(4.5, s * (this.small ? 0.075 : 0.05)) * (1 + 0.55 * Ic);
      octx.fillStyle = 'rgba(0,0,0,.55)';
      roundRect(octx, x - pw / 2 - 1.5, cy - ph / 2 - 1.5, pw + 3, ph + 3, 3);
      octx.fill();
      octx.fillStyle = gp;
      roundRect(octx, x - pw / 2, cy - ph / 2, pw, ph, 2.5);
      octx.fill();
      if (Ic > 0.02) {
        octx.fillStyle = `rgba(${LIME},${0.15 + 0.8 * Ic})`;
        roundRect(octx, x - pw / 2, cy - ph / 2, pw, ph, 2.5);
        octx.fill();
        octx.fillStyle = `rgba(245,255,210,${0.9 * Ic})`;
        octx.fillRect(x - 0.6, cy - ph / 2 + 2, 1.2, ph - 4);
        octx.globalCompositeOperation = 'lighter';
        octx.globalAlpha = Ic;
        const gw = ph * 2.6;
        octx.drawImage(this.gLime, x - gw / 2, cy - gw / 2, gw, gw);
        // light catching the brushed lip
        octx.save();
        octx.translate(x, yT - (yT - byT) * 0.45);
        octx.scale(1, 0.3);
        octx.drawImage(this.gLime, -pw * 2.4, -pw * 2.4, pw * 4.8, pw * 4.8);
        octx.restore();
        octx.globalAlpha = 1;
        octx.globalCompositeOperation = 'source-over';
      }
      if (CONFIG.dialNumerals && !this.small) {
        octx.fillStyle = mixCol(Ic, 0.38 + 0.55 * Ic);
        octx.fillText(String(l.i + 1).padStart(2, '0'), x, wy0 + wh * 0.2 + 3);
      }
    }

    // Darken, then fade both ends of the slab to transparent.
    octx.globalCompositeOperation = 'source-atop';
    g = octx.createLinearGradient(x0, 0, x1, 0);
    g.addColorStop(0, 'rgba(4,7,14,.75)');
    g.addColorStop(0.22, 'rgba(4,7,14,0)');
    g.addColorStop(0.78, 'rgba(4,7,14,0)');
    g.addColorStop(1, 'rgba(4,7,14,.75)');
    octx.fillStyle = g;
    octx.fillRect(ox, oy, ow, oh);
    octx.globalCompositeOperation = 'destination-in';
    g = octx.createLinearGradient(x0, 0, x1, 0);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(0.16, 'rgba(0,0,0,1)');
    g.addColorStop(0.84, 'rgba(0,0,0,1)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    octx.fillStyle = g;
    octx.fillRect(ox, oy, ow, oh);
    octx.globalCompositeOperation = 'source-over';

    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = this.IN;
    ctx.drawImage(this.off, 0, 0, ow * dpr, oh * dpr, ox, oy, ow, oh);

    // Light spill above and in front of the dial (additive).
    ctx.globalCompositeOperation = 'lighter';
    const chh = this.hg * s * 1.15;
    ctx.globalAlpha = this.IN * 0.5;
    ctx.drawImage(this.curtain, x0, yT - chh, fw, chh);
    for (const l of lanes) {
      const I = Math.min(1, l.litE);
      if (I < 0.03) continue;
      const x = sxOf(l.z0);
      const Ib = Math.pow(I, 1.5); // spill falls off faster than the slot light, so only fresh signals glow big
      const bw = Math.min(s * 0.28, 46);
      const bh = this.hg * s * (0.7 + 0.5 * I);
      ctx.globalAlpha = this.IN * Ib * 0.9;
      ctx.drawImage(this.beam, x - bw / 2, yT - bh + 2, bw, bh);
      ctx.save();
      ctx.translate(x, yB + 4);
      ctx.scale(1, 0.2);
      const pw = s * 0.55 * (0.6 + 0.4 * I);
      ctx.globalAlpha = this.IN * Ib * 0.7;
      ctx.drawImage(this.gLime, -pw, -pw, pw * 2, pw * 2);
      ctx.restore();
    }
    ctx.globalAlpha = this.IN;
    ctx.globalCompositeOperation = 'source-over';
  }

  /** Ground brightness: eases down with distance but stays readable all the way to the bend. */
  private groundVis(d: number): number {
    return 1 - 0.5 * ss(14, this.asc.bendDepth, d);
  }

  private drawAgent(o: Placed): void {
    const { ctx } = this;
    const a = o.a;
    const u = o.u;
    const d = o.d;
    const lane = a.lane;
    if (o.asc) {
      this.asc.drawHead(ctx, o.i, lane, o.x, this.groundVis(this.asc.bendDepth), this.gCool, this.gLime);
      return;
    }
    const vis = this.groundVis(d) * ss(DMIN, DMIN + 0.8, d);
    if (vis < 0.01) return;
    const z = this.laneZ(lane, d, this.T);
    this.proj(z, 0.05, d);
    const x = this.px;
    const y = this.py;
    const s = this.ps;
    const hidden = inSlab(d);
    const mb = this.small ? 1.3 : 1; // bolder marks on small screens
    const n = 1 - ss(DF - 1.3, DF - 0.05, d);
    const ptr = this.ptr;
    const lc = ptr.k > 0.01 ? 1 - ss(0, this.R, Math.hypot(x - ptr.x, y - ptr.y)) : 0;
    const nn = n * (1 - ptr.k * lc);

    ctx.globalCompositeOperation = 'lighter';
    if (nn > 0.03 && !hidden) {
      const st = Math.floor(this.T * 7 + a.seed * 0.37);
      const h1 = hash(st, a.seed);
      const h2 = hash(st, a.seed + 1);
      const h3 = hash(st, a.seed + 2);
      const h4 = hash(st, a.seed + 3);
      this.proj(z + (h1 - 0.5) * 0.46 * nn, 0.05 + (h2 - 0.5) * 0.2 * nn, Math.max(1.6, d + (h2 - 0.5) * 0.5 * nn));
      const nx = this.px;
      const ny = this.py;
      const rr = clamp(0.02 * s * mb, 0.7, 5.5 * mb);
      if (h3 > 0.2 * nn) {
        ctx.globalAlpha = this.IN * 0.65 * nn * vis;
        ctx.fillStyle = REPORT_SOLID;
        ctx.beginPath();
        ctx.arc(nx, ny, rr, 0, 6.2832);
        ctx.fill();
        ctx.globalAlpha = this.IN;
        if (s > 150) {
          ctx.globalAlpha = this.IN * 0.12 * nn * vis;
          ctx.drawImage(this.gCool, nx - rr * 4, ny - rr * 4, rr * 8, rr * 8);
          ctx.globalAlpha = this.IN;
        }
      }
      if (h4 < 0.38 * nn) {
        this.proj(z + (h1 - 0.5) * 0.5 * nn, 0.05, Math.max(1.6, d - 0.4 - h1 * 1.1));
        ctx.globalAlpha = this.IN * 0.28 * nn * vis;
        ctx.fillStyle = REPORT_SOLID;
        ctx.beginPath();
        ctx.arc(this.px, this.py, rr * 0.8, 0, 6.2832);
        ctx.fill();
        ctx.globalAlpha = this.IN;
      }
      // Echo of the previous report: reports arrive in bursts.
      const e1 = hash(st - 1, a.seed);
      const e2 = hash(st - 1, a.seed + 1);
      this.proj(z + (e1 - 0.5) * 0.46 * nn, 0.05 + (e2 - 0.5) * 0.2 * nn, Math.max(1.6, d + (e2 - 0.5) * 0.5 * nn));
      ctx.globalAlpha = this.IN * 0.3 * nn * vis;
      ctx.fillStyle = REPORT_SOLID;
      ctx.beginPath();
      ctx.arc(this.px, this.py, rr * 0.85, 0, 6.2832);
      ctx.fill();
      ctx.globalAlpha = this.IN;
    }

    // Trail behind the head, following the lane.
    let prevHidden = hidden;
    this.trailX[0] = x;
    this.trailY[0] = y;
    ctx.lineCap = 'round';
    for (let i = 1; i <= this.N; i++) {
      const di = dOf(Math.max(0, u - i * 0.013));
      this.proj(this.laneZ(lane, di, this.T), 0.05, di);
      const tx = this.px;
      const ty = this.py;
      const hid = inSlab(di);
      let c = ss(DF - 0.2, DF + 0.6, di);
      if (ptr.k > 0.01) c = Math.max(c, ptr.k * (1 - ss(0, this.R, Math.hypot(tx - ptr.x, ty - ptr.y))));
      const k = 1 - i / this.N;
      const al = Math.pow(k, 1.6) * c * 0.9 * vis;
      this.trailX[i] = tx;
      this.trailY[i] = ty;
      this.trailVisible[i] = al > 0.01 && !hid && !prevHidden ? 1 : 0;
      this.trailAlpha[i] = al;
      this.trailWidth[i] = clamp(0.035 * this.ps * k * mb + 0.5, 0.5, 3.2 * mb);
      prevHidden = hid;
    }
    for (let i = 1; i <= this.N;) {
      if (!this.trailVisible[i]) {
        i++;
        continue;
      }
      let end = i;
      let count = 1;
      let alpha = this.trailAlpha[i]!;
      let width = this.trailWidth[i]!;
      if (i < this.N && this.trailVisible[i + 1]) {
        end++;
        count++;
        alpha += this.trailAlpha[end]!;
        width += this.trailWidth[end]!;
      }
      alpha /= count;
      width /= count;
      ctx.beginPath();
      ctx.moveTo(this.trailX[i - 1]!, this.trailY[i - 1]!);
      for (let j = i; j <= end; j++) ctx.lineTo(this.trailX[j]!, this.trailY[j]!);
      if (lane.lime) {
        ctx.globalAlpha = this.IN * alpha * 0.2;
        ctx.strokeStyle = LIME_SOLID;
        ctx.lineWidth = width * 3.2;
        ctx.stroke();
      }
      ctx.globalAlpha = this.IN * alpha;
      ctx.strokeStyle = lane.lime ? LIME_SOLID : 'rgba(190,208,240,.8)';
      ctx.lineWidth = width;
      ctx.stroke();
      ctx.globalAlpha = this.IN;
      i = end + 1;
    }

    // Head: only once the signal is clean and not hidden by the slab.
    const ca = 1 - nn;
    if (ca > 0.03 && !hidden) {
      const gs = clamp(0.13 * s * mb, 6, 28 * mb);
      ctx.globalAlpha = this.IN * ca * vis;
      ctx.drawImage(lane.lime ? this.gLime : this.gCool, x - gs, y - gs, gs * 2, gs * 2);
      ctx.fillStyle = '#F2F6FF';
      ctx.beginPath();
      ctx.arc(x, y, clamp(0.022 * s * mb, 0.9, 3 * mb), 0, 6.2832);
      ctx.fill();
      ctx.globalAlpha = this.IN;
    }
    const dd = Math.abs(d - DF);
    if (dd < 0.55) {
      const fs = clamp(0.2 * s, 10, 40);
      ctx.globalAlpha = this.IN * (1 - dd / 0.55) * 0.8 * vis;
      ctx.drawImage(this.gLime, x - fs, y - fs, fs * 2, fs * 2);
      ctx.globalAlpha = this.IN;
    }
  }

  /* ------------------------------ alert system ------------------------------ */

  /** Log-depth of a vehicle at time t (ground only; clamps to the bend while climbing). */
  private stateU(a: Agent, t: number): number {
    const st: AgentState = { ascending: false, u: 0, x: 0 };
    this.asc.state(a.u, a.sp, t, st);
    return st.u;
  }

  private startAlert(a: Agent, t0: number): void {
    const dC = dOf(this.stateU(a, t0 + 0.35)); // the vehicle reaches the zone centre quickly...
    const Rd = dOf(this.stateU(a, t0 + ALERT.exit)) - dC; // ...and leaves its far boundary at ALERT.exit
    this.alert = {
      agent: a,
      t0,
      dC,
      Rd,
      zC: this.laneZ(a.lane, dC, t0),
      ax: Number.NaN,
      ay: 0,
    };
  }

  private updateAlert(list: Placed[]): void {
    if (this.rm) {
      // Static frame: show the alert in its settled "hold" state.
      const t0 = this.T - 2.6;
      if (!this.alert) {
        let count = 0;
        for (const o of list) {
          const d0 = dOf(this.stateU(o.a, t0));
          if (d0 > 9.4 && d0 < 10.8) count++;
        }
        if (count) {
          let target = Math.floor(count / 2);
          for (const o of list) {
            const d0 = dOf((o.a.u + t0 * o.a.sp) % 1);
            if (d0 > 9.4 && d0 < 10.8 && target-- === 0) {
              this.startAlert(o.a, t0);
              break;
            }
          }
        }
      }
      return;
    }
    if (this.nextAlert === null) this.nextAlert = this.T + 4.2;
    if (this.alert && this.T - this.alert.t0 > ALERT.end) this.alert = null;
    if (!this.alert && this.T > this.nextAlert) {
      let count = 0;
      for (const o of list) if (o.d > 9.4 && o.d < 10.8) count++;
      let target = Math.floor(Math.random() * count);
      for (const o of list) {
        if (o.d > 9.4 && o.d < 10.8 && target-- === 0) {
          this.startAlert(o.a, this.T);
          break;
        }
      }
      if (count) {
        this.nextAlert = this.T + CONFIG.alertEvery;
      }
    }
  }

  /**
   * Ground layer (drawn before the dial so it is occluded correctly):
   * a faint dashed geofence zone, a thin amber arc where the vehicle
   * crosses out, and a single ripple from the crossing point. No text.
   */
  private drawAlertGround(): void {
    const al = this.alert;
    if (!al) return;
    const { ctx } = this;
    const tt = this.T - al.t0;
    const za = ss(0, 0.6, tt) * (1 - ss(ALERT.close, ALERT.end, tt));
    if (za < 0.01) return;
    const grow = 0.7 + 0.3 * ss(0, 0.7, tt);
    const hot = ss(ALERT.exit - 0.05, ALERT.exit + 0.2, tt) * (1 - ss(3.4, 4.6, tt));
    const rz = ALERT.zoneHalfWidth * grow * (this.small ? 0.75 : 1);
    const rd = al.Rd * grow;
    const trace = (a0: number, a1: number, steps: number): void => {
      ctx.beginPath();
      for (let i = 0; i <= steps; i++) {
        const a = a0 + ((a1 - a0) * i) / steps;
        this.proj(al.zC + Math.cos(a) * rz, 0, al.dC + Math.sin(a) * rd);
        if (i) ctx.lineTo(this.px, this.py);
        else ctx.moveTo(this.px, this.py);
      }
    };

    ctx.globalCompositeOperation = 'source-over';
    trace(0, 6.2832, 56);
    ctx.closePath();
    ctx.fillStyle = `rgba(${COOL},${0.035 * za * (1 - hot * 0.6)})`;
    ctx.fill();
    if (hot > 0.01) {
      ctx.fillStyle = `rgba(${AMBER},${0.07 * za * hot})`;
      ctx.fill();
    }
    ctx.setLineDash([6, 6]);
    ctx.lineDashOffset = -this.T * 5;
    ctx.strokeStyle = `rgba(${COOL},${0.34 * za * (1 - hot * 0.5)})`;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.setLineDash([]);

    if (hot > 0.01) {
      ctx.lineCap = 'round';
      trace(Math.PI / 2 - 0.6, Math.PI / 2 + 0.6, 18);
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = `rgba(${AMBER},${0.1 * za * hot})`;
      ctx.lineWidth = 5;
      ctx.stroke();
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = `rgba(${AMBER},${0.9 * za * hot})`;
      ctx.lineWidth = 1.8;
      ctx.stroke();
    }

    const p = (tt - ALERT.exit) / 0.9;
    if (p > 0 && p < 1) {
      const r = 0.1 + 0.6 * (1 - Math.pow(1 - p, 3));
      ctx.strokeStyle = `rgba(${AMBER},${(1 - p) * 0.7})`;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      for (let i = 0; i <= 28; i++) {
        const a = (i / 28) * 6.2832;
        this.proj(al.zC + Math.cos(a) * r, 0, al.dC + rd + Math.sin(a) * r);
        if (i) ctx.lineTo(this.px, this.py);
        else ctx.moveTo(this.px, this.py);
      }
      ctx.stroke();
    }
  }

  /**
   * The alert itself: a dot on the vehicle that expands in width into a small
   * pill (pictogram + one short label). The pill's outline is the response
   * timer. Then it collapses back to a dot and fades.
   */
  private drawAlertOverlay(): void {
    const al = this.alert;
    if (!al) return;
    const tt = this.T - al.t0;
    if (tt < ALERT.exit - 0.1) return;
    const { ctx } = this;
    const a = al.agent;
    const d = dOf(this.stateU(a, this.T));
    this.proj(this.laneZ(a.lane, d, this.T), 0.05, d);
    const x = this.px;
    const y = this.py;
    const s = this.ps;
    const IN = this.IN;
    const out = 1 - ss(ALERT.close + ALERT.closeDur * 0.6, ALERT.end, tt);
    const hot = ss(ALERT.exit - 0.1, ALERT.exit + 0.15, tt) * out;
    const pulse = 0.8 + 0.2 * Math.sin(tt * 8);

    // Amber heat on the vehicle.
    ctx.globalCompositeOperation = 'lighter';
    const gs = clamp(0.16 * s, 8, 22);
    ctx.globalAlpha = IN * hot * pulse * 0.8;
    ctx.drawImage(this.gAmber, x - gs, y - gs, gs * 2, gs * 2);
    ctx.globalCompositeOperation = 'source-over';

    // Expansion amount: 0 = dot, 1 = full pill.
    const easeOut = (k: number): number => (k >= 1 ? 1 : 1 - Math.pow(2, -10 * k));
    const ko = easeOut(clamp((tt - ALERT.open) / ALERT.openDur, 0, 1));
    const kc = ss(0, 1, clamp((tt - ALERT.close) / ALERT.closeDur, 0, 1));
    const e = ko * (1 - kc);

    const h = this.small ? 20 : 22;
    const label = CONFIG.alertLabel;
    ctx.font = '500 10px "JetBrains Mono", ui-monospace, Menlo, monospace';
    const wFull = label ? 35 + ctx.measureText(label).width : h * 1.7;
    const ph = 6 + (h - 6) * ss(0, 0.35, e);
    const w = ph + (wFull - ph) * ss(0.25, 1, e);

    // Position: centred just above the vehicle, kept on screen, gently smoothed.
    const tx = clamp(x, w / 2 + 8, this.W - w / 2 - 8);
    const ty = y - 20;
    if (Number.isNaN(al.ax)) {
      al.ax = tx;
      al.ay = ty;
    }
    al.ax += (tx - al.ax) * 0.3;
    al.ay += (ty - al.ay) * 0.3;
    const cx = al.ax;
    const cy = al.ay;
    const x0 = cx - w / 2;
    const y0 = cy - ph / 2;

    ctx.globalAlpha = IN * out;
    // Soft amber bloom behind the pill.
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = IN * out * (0.1 + 0.1 * e);
    const bw = w * 2.2 + 16;
    ctx.drawImage(this.gAmber, cx - bw / 2, cy - ph * 1.6, bw, ph * 3.2);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = IN * out;

    // Body: amber dot that darkens into glass as it expands.
    ctx.fillStyle = `rgb(${AMBER})`;
    roundRect(ctx, x0, y0, w, ph, ph / 2);
    ctx.fill();
    const glass = ss(0, 0.4, e);
    if (glass > 0.01) {
      const g = ctx.createLinearGradient(0, y0, 0, y0 + ph);
      g.addColorStop(0, 'rgba(40,44,60,.96)');
      g.addColorStop(1, 'rgba(16,18,30,.97)');
      ctx.globalAlpha = IN * out * glass;
      ctx.fillStyle = g;
      roundRect(ctx, x0, y0, w, ph, ph / 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,.14)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // Outline timer: the amber arc unwinds over the response window.
    const ta = ss(0.85, 1, e);
    if (ta > 0.01) {
      const remain = 1 - clamp((tt - (ALERT.open + ALERT.openDur)) / (ALERT.close - ALERT.open - ALERT.openDur), 0, 1);
      const perimeter = 2 * (w - ph) + Math.PI * ph;
      ctx.globalAlpha = IN * out * ta;
      ctx.setLineDash([perimeter * remain, perimeter]);
      ctx.strokeStyle = `rgba(${AMBER},.95)`;
      ctx.lineWidth = 1.4;
      roundRect(ctx, x0, y0, w, ph, ph / 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Contents, clipped to the pill so they reveal as the width grows.
    if (e > 0.2) {
      ctx.save();
      roundRect(ctx, x0, y0, w, ph, ph / 2);
      ctx.clip();
      const gx = label ? x0 + 7 + 6 : cx;
      const ga = ss(0.25, 0.55, e);
      ctx.globalAlpha = IN * out * ga;
      ctx.strokeStyle = `rgb(${AMBER})`;
      ctx.lineWidth = 1.3;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      // Pictogram: an arrow leaving a zone.
      ctx.beginPath();
      ctx.arc(gx - 1, cy, 4.6, 0.55, 6.2832 - 0.55);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(gx + 1, cy);
      ctx.lineTo(gx + 7, cy);
      ctx.moveTo(gx + 4.6, cy - 2.4);
      ctx.lineTo(gx + 7, cy);
      ctx.lineTo(gx + 4.6, cy + 2.4);
      ctx.stroke();
      if (label) {
        ctx.globalAlpha = IN * out * ss(0.65, 0.95, e);
        ctx.fillStyle = '#F4F6FB';
        ctx.textAlign = 'left';
        ctx.fillText(label, x0 + 7 + 12 + 6, cy + 3.5);
      }
      ctx.restore();
    }
  }
}

/**
 * Fleet Live hero: the Ascent ("launch channel")
 * ------------------------------------------------------------------
 * Framework-free Canvas2D module. Companion to scene.ts.
 *
 * Story: once a signal is clean it does not fade into the horizon. The lanes
 * converge, brake into a bend, and the vehicles are fired up a vertical
 * channel, accelerating as they go. The channel is built from the same
 * material vocabulary as the dial:
 *
 *   - two machined guard rails with an inset light channel (anodized metal)
 *   - a frosted glass veil between them, visible only as edge light and sheen
 *   - hoops whose spacing grows with speed (a linear-accelerator read:
 *     equal TIME between hoops, so equal-looking pulses at rising speed)
 *   - a throat gate at the base of the climb with one index light per lane
 *   - an exit glow where the lights leave the top of the hero
 *
 * Kinematics are stateless and deterministic: given a time, every vehicle's
 * position is a pure function. See `state()`.
 *
 * Tune the look and the motion from ASCENT below.
 */

export interface RailLane {
  i: number;
  v: number;
  lime: boolean;
  lit: number;
}
export interface Pt {
  x: number;
  y: number;
  s: number;
}
export interface AscentFrame {
  W: number;
  H: number;
  VX: number;
  VY: number;
  F: number;
  Fe: number;
  T: number;
  IN: number;
  dt: number;
  small: boolean;
  scroll: number;
  rm: boolean;
  /** Hero-local y where the channel ends (negative = above the viewport). */
  top: number;
  proj(z: number, y: number, d: number, o: Pt): void;
  laneZ(l: RailLane, d: number): number;
}
export interface AgentState {
  ascending: boolean;
  /** Log-depth parameter on the ground (stays at the bend value while ascending). */
  u: number;
  /** Ascent time fraction 0..1 (0 while on the ground). */
  x: number;
}

/* ------------------------------ CONFIG ------------------------------ */
export const ASCENT = {
  /** World depth where the lanes leave the ground. Closer = bigger, lower bend. */
  bendDepth: 30,
  /** Pixels (at 1080p) the bend lifts before the climb is vertical. */
  bendRise: 84,
  /** Channel width relative to the bundle width at the bend. */
  taper: 0.5,
  /** Pixels between the outermost lane and each guard rail inside the channel. */
  guardGap: 12,
  /** Guard rail width in the channel, px at 1080p. */
  railWidth: 4.6,

  /** Speed at the top of the climb, px/s at 1080p. */
  topSpeed: 1150,
  /** Climb time law q(x) = c*x + (1-c)*x^p. Larger p = slower start, harder launch. */
  launchPower: 2.7,
  launchBase: 0.05,
  /** Ground speed multiplier in the far zone, so the approach reads as motion, not a crawl. */
  cruise: 3.0,
  /** Speed multiplier reached at the bend entry (1 = no braking). */
  brake: 0.36,
  /** How much of the ground path (in log-depth units) the braking spans. */
  brakeSpan: 0.17,

  /** Hoops along the vertical part. */
  rings: 8,
  /** Seconds a hoop stays lit after a vehicle passes. */
  ringDecay: 0.16,
  sparks: true,
  gate: true,
  /** `machined` = metal rails with an inset light. `glass` = translucent rods with refraction highlights. */
  railStyle: 'machined' as 'machined' | 'glass',
};
export type AscentConfig = typeof ASCENT;
/* -------------------------------------------------------------------- */

const LIME = '200,237,115';
const COOL = '170,190,228';
const NG = 14; // ground samples per strand
const NB = 16; // bend segments
const NV = 6; // vertical segments
const NA = 1 + NB + NV; // ascent samples per strand
const MAX_SPARKS = 48;

const clamp = (v: number, a: number, b: number): number => Math.min(b, Math.max(a, v));
const ss = (a: number, b: number, x: number): number => {
  const k = clamp((x - a) / (b - a), 0, 1);
  return k * k * (3 - 2 * k);
};
const hash = (a: number, b: number): number => {
  const h = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return h - Math.floor(h);
};

interface Strand {
  lane: RailLane;
  /** -1 left guard, 1 right guard, 0 lane. */
  guard: number;
  gx: Float32Array;
  gy: Float32Array;
  gw: Float32Array;
  ax: Float32Array;
  ay: Float32Array;
  aw: Float32Array;
  cum: Float32Array;
  Q: number;
  /** Arc length where the bend ends and the vertical part starts. */
  Qb: number;
}

export class Ascent {
  private readonly cfg: AscentConfig;
  private readonly mk: () => HTMLCanvasElement;
  private readonly dMin: number;
  private readonly dMax: number;
  private readonly dBack: number;
  private readonly lr: number;
  private readonly ub: number;
  /** Cumulative ground time (in sp-normalised units) and its inverse, sampled uniformly in u / g. */
  private readonly gOfU: Float32Array;
  private readonly uOfG: Float32Array;
  private readonly gMax: number;
  private readonly glow: HTMLCanvasElement;
  private readonly column: HTMLCanvasElement;

  private strands: Strand[] = [];
  private nLanes = 0;
  private f!: AscentFrame;
  private kk = 1;
  private Ta = 1.4;
  private taDirty = true;
  private cx = 0;
  private yBend = 0;
  private yVert = 0;
  private yDial = 0;
  private ringS: number[] = [];
  private ringY: number[] = [];
  private ringHalf = 0;
  private heat: number[] = [];
  private gate: number[] = [];
  private prevX: Float32Array = new Float32Array(0);
  private act = 0;
  private exitHeat = 0;
  private sparkN = 0;
  private readonly spX = new Float32Array(MAX_SPARKS);
  private readonly spY = new Float32Array(MAX_SPARKS);
  private readonly spVX = new Float32Array(MAX_SPARKS);
  private readonly spVY = new Float32Array(MAX_SPARKS);
  private readonly spL = new Float32Array(MAX_SPARKS);
  // Scratch buffers: allocated once, reused every frame (render must stay allocation-free).
  private readonly sPx = new Float32Array(NG + NA - 1);
  private readonly sPy = new Float32Array(NG + NA - 1);
  private readonly sPw = new Float32Array(NG + NA - 1);
  private readonly sLx = new Float32Array(NG + NA - 1);
  private readonly sLy = new Float32Array(NG + NA - 1);
  private readonly sRx = new Float32Array(NG + NA - 1);
  private readonly sRy = new Float32Array(NG + NA - 1);
  private readonly trX = new Float32Array(8);
  private readonly trY = new Float32Array(8);
  private readonly pt: Pt = { x: 0, y: 0, s: 1 };
  private readonly pt2: Pt = { x: 0, y: 0, s: 1 };
  private readonly out = { x: 0, y: 0 };

  constructor(opts: {
    dMin: number;
    dMax: number;
    dialBack: number;
    makeCanvas?: () => HTMLCanvasElement;
    config?: Partial<AscentConfig>;
  }) {
    this.cfg = { ...ASCENT, ...opts.config };
    this.mk = opts.makeCanvas ?? (() => document.createElement('canvas'));
    this.dMin = opts.dMin;
    this.dMax = opts.dMax;
    this.dBack = opts.dialBack;
    this.lr = Math.log(opts.dMax / opts.dMin);
    this.ub = Math.log(this.cfg.bendDepth / opts.dMin) / this.lr;

    // Ground time law: g(u) = integral of du / m(u). Built once, inverted by lookup.
    const N = 512;
    this.gOfU = new Float32Array(N + 1);
    let acc = 0;
    let prev = 1 / this.mult(0);
    for (let i = 1; i <= N; i++) {
      const u = (this.ub * i) / N;
      const cur = 1 / this.mult(u);
      acc += ((prev + cur) / 2) * (this.ub / N);
      this.gOfU[i] = acc;
      prev = cur;
    }
    this.gMax = acc;
    this.uOfG = new Float32Array(N + 1);
    let j = 0;
    for (let i = 0; i <= N; i++) {
      const g = (this.gMax * i) / N;
      while (j < N && this.gOfU[j + 1]! < g) j++;
      const g0 = this.gOfU[j]!;
      const g1 = this.gOfU[Math.min(N, j + 1)]!;
      const k = g1 > g0 ? (g - g0) / (g1 - g0) : 0;
      this.uOfG[i] = (this.ub * (j + k)) / N;
    }

    this.glow = this.radial(LIME);
    this.column = this.makeColumn();
  }

  /* ------------------------------ kinematics ------------------------------ */

  /** Ground speed multiplier at log-depth u (1 near the dial, boosted far away, braking into the bend). */
  private mult(u: number): number {
    const d = this.dMin * Math.exp(u * this.lr);
    const far = ss(20, 28, d);
    const boost = 1 + (this.cfg.cruise - 1) * far;
    const brake = 1 - (1 - this.cfg.brake) * ss(this.ub - this.cfg.brakeSpan, this.ub, u);
    return boost * brake;
  }

  /** Ascent shape: fraction of the climb covered at time fraction x. */
  shape(x: number): number {
    const c = this.cfg.launchBase;
    return c * x + (1 - c) * Math.pow(x, this.cfg.launchPower);
  }

  private shapeSlope(x: number): number {
    const c = this.cfg.launchBase;
    return c + (1 - c) * this.cfg.launchPower * Math.pow(x, this.cfg.launchPower - 1);
  }

  /** Where in its cycle a vehicle is at time t. `offset` is its 0..1 phase, `sp` its ground rate. */
  state(offset: number, sp: number, t: number, o: AgentState): void {
    const Pg = this.gMax / sp;
    const P = Pg + this.Ta;
    const tau = (((offset * P + t) % P) + P) % P;
    if (tau < Pg) {
      const g = (sp * tau) / this.gMax; // 0..1
      const f = clamp(g, 0, 1) * (this.uOfG.length - 1);
      const i = Math.min(this.uOfG.length - 2, Math.floor(f));
      o.u = this.uOfG[i]! + (this.uOfG[i + 1]! - this.uOfG[i]!) * (f - i);
      o.ascending = false;
      o.x = 0;
    } else {
      o.u = this.ub;
      o.ascending = true;
      o.x = clamp((tau - Pg) / this.Ta, 0, 1);
    }
  }

  /**
   * Re-phase vehicles so their launches are evenly spread in time (no empty column, no bunching).
   * Call once after the first frame() of a layout, when the climb time is known.
   */
  stratify(agents: { u: number; sp: number }[]): void {
    const N = agents.length;
    if (N === 0) return;
    // Deterministic shuffle so neighbouring launches come from different lanes.
    const order = agents.map((_, i) => i).sort((a, b) => hash(a, 3.1) - hash(b, 3.1));
    order.forEach((idx, j) => {
      const a = agents[idx]!;
      const Pg = this.gMax / a.sp;
      const P = Pg + this.Ta;
      const o = Pg / P - (j + 0.5 + (hash(idx, 7.7) - 0.5) * 0.7) / N; // jitter keeps it organic
      a.u = o - Math.floor(o);
    });
  }

  /** Log-depth of the bend, for callers that need to clamp ground state. */
  get bendU(): number {
    return this.ub;
  }

  /** World depth where the lanes leave the ground. */
  get bendDepth(): number {
    return this.cfg.bendDepth;
  }

  /** Screen speed (px/s) of a vehicle at ascent fraction x on the centre strand. For tests and tuning. */
  speedAt(x: number): number {
    const s = this.strands[Math.floor(this.nLanes / 2) + 1];
    return s ? (s.Q * this.shapeSlope(x)) / this.Ta : 0;
  }

  get climbSeconds(): number {
    return this.Ta;
  }

  /* ------------------------------ setup ------------------------------ */

  /** Call from resize(). `lanes` are the real lanes; guards are created here as virtual lanes. */
  setLanes(lanes: RailLane[], zh: number, pad: number): void {
    this.nLanes = lanes.length;
    const gv = 1 + (pad * 0.9 + 0.05) / Math.max(0.01, zh);
    const mkStrand = (lane: RailLane, guard: number): Strand => ({
      lane,
      guard,
      gx: new Float32Array(NG),
      gy: new Float32Array(NG),
      gw: new Float32Array(NG),
      ax: new Float32Array(NA),
      ay: new Float32Array(NA),
      aw: new Float32Array(NA),
      cum: new Float32Array(NA),
      Q: 1,
      Qb: 1,
    });
    this.strands = [
      mkStrand({ i: -1, v: -gv, lime: false, lit: 0 }, -1),
      ...lanes.map((l) => mkStrand(l, 0)),
      mkStrand({ i: lanes.length, v: gv, lime: false, lit: 0 }, 1),
    ];
    this.heat = new Array(this.cfg.rings).fill(0);
    this.gate = new Array(lanes.length).fill(0);
    this.prevX = new Float32Array(lanes.length * 8);
    this.taDirty = true;
  }

  /* ------------------------------ per-frame geometry ------------------------------ */

  frame(f: AscentFrame): void {
    this.f = f;
    const cfg = this.cfg;
    const kk = (this.kk = f.small ? 0.72 : 1) * clamp(f.H / 1080, 0.7, 1.25);
    const db = cfg.bendDepth;
    const { pt, pt2 } = this;
    const nS = this.strands.length;
    if (nS === 0) return;

    for (const st of this.strands) {
      for (let i = 0; i < NG; i++) {
        const d = this.dBack * Math.pow(db / this.dBack, i / (NG - 1));
        f.proj(f.laneZ(st.lane, d), 0.05, d, pt);
        st.gx[i] = pt.x;
        st.gy[i] = pt.y;
        st.gw[i] = clamp(pt.s * 0.05, 1.3, 7) * (f.small ? 0.8 : 1);
      }
    }
    const L = this.strands[1]!;
    const R = this.strands[nS - 2]!;
    this.cx = (L.gx[NG - 1]! + R.gx[NG - 1]!) / 2;
    const rise = cfg.bendRise * kk;
    const yTop = f.top;

    for (const st of this.strands) {
      const x0 = st.gx[NG - 1]!;
      const y0 = st.gy[NG - 1]!;
      // Forward direction on screen at the end of the ground: toward the vanishing point.
      f.proj(f.laneZ(st.lane, db * 0.92), 0.05, db * 0.92, pt2);
      let tx = x0 - pt2.x;
      let ty = y0 - pt2.y;
      const tl = Math.hypot(tx, ty) || 1;
      tx /= tl;
      ty /= tl;
      if (ty > -0.05) {
        ty = -0.05;
      }
      const xc = this.cx + (x0 - this.cx) * cfg.taper + st.guard * cfg.guardGap * kk;
      const yc = y0 - rise;
      const dist = Math.hypot(xc - x0, yc - y0);
      const Lc = dist * 0.4;
      const p1x = x0 + tx * Lc;
      const p1y = y0 + ty * Lc;
      const p2x = xc;
      const p2y = yc + Lc;
      const w0 = st.gw[NG - 1]!;
      const wA = st.guard !== 0 ? Math.max(w0 * 1.4, cfg.railWidth * kk) : 1;

      st.ax[0] = x0;
      st.ay[0] = y0;
      st.aw[0] = w0;
      for (let j = 1; j <= NB; j++) {
        const t = j / NB;
        const m = 1 - t;
        st.ax[j] = m * m * m * x0 + 3 * m * m * t * p1x + 3 * m * t * t * p2x + t * t * t * xc;
        st.ay[j] = m * m * m * y0 + 3 * m * m * t * p1y + 3 * m * t * t * p2y + t * t * t * yc;
        st.aw[j] = w0 + (wA - w0) * ss(0, 1, t);
      }
      for (let j = 1; j <= NV; j++) {
        const k = NB + j;
        st.ax[k] = xc;
        st.ay[k] = yc + ((yTop - yc) * j) / NV;
        st.aw[k] = wA;
      }
      st.cum[0] = 0;
      for (let k = 1; k < NA; k++) {
        st.cum[k] = st.cum[k - 1]! + Math.hypot(st.ax[k]! - st.ax[k - 1]!, st.ay[k]! - st.ay[k - 1]!);
      }
      st.Q = st.cum[NA - 1]!;
      st.Qb = st.cum[NB]!;
    }

    const mid = this.strands[Math.floor(this.nLanes / 2) + 1]!;
    this.yBend = mid.ay[0]!;
    this.yVert = mid.ay[NB]!;
    this.yDial = L.gy[0]!;

    if (this.taDirty) {
      this.taDirty = false;
      const vTop = cfg.topSpeed * clamp(f.H / 1080, 0.6, 1.25);
      this.Ta = (mid.Q * this.shapeSlope(1)) / vTop;
    }

    // Hoops: equal TIME apart, so their spacing grows with the climb speed.
    const K = f.small ? Math.max(5, Math.round(cfg.rings * 0.6)) : cfg.rings;
    const sA = (mid.Qb + 14 * kk) / mid.Q;
    let lo = 0;
    let hi = 1;
    for (let it = 0; it < 24; it++) {
      const m = (lo + hi) / 2;
      if (this.shape(m) < sA) lo = m;
      else hi = m;
    }
    const xA = lo;
    this.ringS.length = 0;
    this.ringY.length = 0;
    for (let k = 0; k < K; k++) {
      const x = xA + ((0.97 - xA) * k) / (K - 1);
      const s = this.shape(x);
      this.ringS.push(s);
      this.pointAt(mid, s * mid.Q, this.out);
      this.ringY.push(this.out.y);
    }
    while (this.heat.length < K) this.heat.push(0);
    const gl = this.strands[0]!;
    const gr = this.strands[nS - 1]!;
    this.ringHalf = (gr.ax[NA - 1]! - gl.ax[NA - 1]!) / 2 + 6 * kk;

    // Decay light state.
    const dt = f.dt;
    const hd = Math.exp((-dt * 1) / cfg.ringDecay);
    for (let k = 0; k < this.heat.length; k++) this.heat[k]! *= hd;
    for (let i = 0; i < this.gate.length; i++) this.gate[i]! *= Math.exp(-dt * 3.2);
    this.exitHeat *= Math.exp(-dt * 2.4);
    this.act *= Math.exp(-dt * 2.2);
    this.stepSparks(dt);
  }

  /** Position at arc length q along a strand's ascent polyline. */
  private pointAt(st: Strand, q: number, o: { x: number; y: number }): void {
    const qq = clamp(q, 0, st.Q);
    let lo = 0;
    let hi = NA - 1;
    while (hi - lo > 1) {
      const m = (lo + hi) >> 1;
      if (st.cum[m]! < qq) lo = m;
      else hi = m;
    }
    const seg = st.cum[hi]! - st.cum[lo]!;
    const k = seg > 0 ? (qq - st.cum[lo]!) / seg : 0;
    o.x = st.ax[lo]! + (st.ax[hi]! - st.ax[lo]!) * k;
    o.y = st.ay[lo]! + (st.ay[hi]! - st.ay[lo]!) * k;
  }

  /** Fade applied to the whole channel: dimmer on phones, eases off as the hero scrolls away. */
  private get gain(): number {
    return (this.f.small ? 0.8 : 1) * (1 - 0.5 * this.f.scroll);
  }

  /* ------------------------------ drawing: back layer ------------------------------ */

  /** Everything behind the vehicles: glow, veil, hoop backs, lane guides, guard rails, gate. */
  drawBack(ctx: CanvasRenderingContext2D, lanes: RailLane[]): void {
    const f = this.f;
    if (!f || this.strands.length === 0) return;
    const IN = f.IN * this.gain;
    const st0 = this.strands[0]!;
    const stN = this.strands[this.strands.length - 1]!;

    // 1. Column glow: a faint lime light inside the channel that swells with traffic.
    {
      const half = this.ringHalf * 2.6;
      const y0 = Math.max(f.top, 0) - 20;
      const y1 = this.yVert + 30;
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = IN * (0.1 + 0.45 * Math.min(1, this.act));
      ctx.drawImage(this.column, this.cx - half, y0, half * 2, y1 - y0);
      ctx.globalCompositeOperation = 'source-over';
    }

    // 2. Glass veil between the guard rails. Fades in beyond mid-distance, strongest in the climb.
    {
      ctx.beginPath();
      const i0 = 7;
      for (let i = i0; i < NG; i++) (i === i0 ? ctx.moveTo : ctx.lineTo).call(ctx, st0.gx[i]!, st0.gy[i]!);
      for (let k = 1; k < NA; k++) ctx.lineTo(st0.ax[k]!, st0.ay[k]!);
      for (let k = NA - 1; k >= 1; k--) ctx.lineTo(stN.ax[k]!, stN.ay[k]!);
      for (let i = NG - 1; i >= i0; i--) ctx.lineTo(stN.gx[i]!, stN.gy[i]!);
      ctx.closePath();
      const gy0 = st0.gy[i0]!;
      const g = ctx.createLinearGradient(0, gy0, 0, f.top);
      g.addColorStop(0, `rgba(${COOL},0)`);
      g.addColorStop(clamp((gy0 - this.yBend) / (gy0 - f.top), 0, 1), `rgba(${COOL},.05)`);
      g.addColorStop(clamp((gy0 - this.yVert) / (gy0 - f.top), 0, 1), `rgba(${COOL},.08)`);
      g.addColorStop(1, `rgba(${COOL},.012)`);
      ctx.globalAlpha = IN;
      ctx.fillStyle = g;
      ctx.fill();
      // Brushed sheen: two soft vertical highlights, like the dial's lip.
      for (const fr of [0.3, 0.7]) {
        ctx.beginPath();
        for (let k = 0; k < NA; k++) {
          const x = st0.ax[k]! + (stN.ax[k]! - st0.ax[k]!) * fr;
          if (k === 0) ctx.moveTo(x, st0.ay[k]!);
          else ctx.lineTo(x, st0.ay[k]!);
        }
        ctx.lineWidth = Math.max(5, (stN.ax[NA - 1]! - st0.ax[NA - 1]!) * 0.12);
        const sg = ctx.createLinearGradient(0, this.yBend, 0, f.top);
        sg.addColorStop(0, 'rgba(255,255,255,.0)');
        sg.addColorStop(0.35, `rgba(255,255,255,${fr < 0.5 ? 0.05 : 0.03})`);
        sg.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.strokeStyle = sg;
        ctx.stroke();
      }
    }

    // 3. Back halves of the hoops.
    this.drawRings(ctx, IN, false);

    // 4. Lane guides: hairlines from the dial, through the bend, up the channel.
    {
      const g = ctx.createLinearGradient(0, this.yDial, 0, f.top);
      const span = this.yDial - f.top;
      g.addColorStop(0, `rgba(${COOL},.5)`);
      g.addColorStop(clamp((this.yDial - this.yBend) / span, 0, 1), `rgba(${COOL},.3)`);
      g.addColorStop(clamp((this.yDial - this.yVert) / span, 0, 1), `rgba(${COOL},.42)`);
      g.addColorStop(1, `rgba(${COOL},.06)`);
      ctx.lineWidth = 1.2;
      ctx.lineJoin = 'round';
      for (let n = 0; n < lanes.length; n++) {
        const st = this.strands[n + 1]!;
        const lane = lanes[n]!;
        ctx.strokeStyle = g;
        ctx.globalAlpha = IN * clamp(0.55 + lane.lit * 0.9, 0, 1);
        this.tracePath(ctx, st);
        ctx.stroke();
      }
    }

    // 5. Guard rails.
    this.drawGuard(ctx, st0, IN);
    this.drawGuard(ctx, stN, IN);

    // 6. Throat gate at the base of the climb.
    if (this.cfg.gate) this.drawGate(ctx, IN);

    ctx.globalAlpha = f.IN;
    ctx.globalCompositeOperation = 'source-over';
  }

  private tracePath(ctx: CanvasRenderingContext2D, st: Strand): void {
    ctx.beginPath();
    ctx.moveTo(st.gx[0]!, st.gy[0]!);
    for (let i = 1; i < NG; i++) ctx.lineTo(st.gx[i]!, st.gy[i]!);
    for (let k = 1; k < NA; k++) ctx.lineTo(st.ax[k]!, st.ay[k]!);
  }

  /** A guard rail as a tapered ribbon: metal body, key-light edge, inset light channel, soft glow. */
  private drawGuard(ctx: CanvasRenderingContext2D, st: Strand, IN: number): void {
    const f = this.f;
    const N = NG + NA - 1;
    const px = this.sPx;
    const py = this.sPy;
    const pw = this.sPw;
    for (let i = 0; i < NG; i++) {
      px[i] = st.gx[i]!;
      py[i] = st.gy[i]!;
      pw[i] = st.gw[i]!;
    }
    for (let k = 1; k < NA; k++) {
      px[NG - 1 + k] = st.ax[k]!;
      py[NG - 1 + k] = st.ay[k]!;
      pw[NG - 1 + k] = st.aw[k]!;
    }
    const lx = this.sLx;
    const ly = this.sLy;
    const rx = this.sRx;
    const ry = this.sRy;
    for (let i = 0; i < N; i++) {
      const a = Math.max(0, i - 1);
      const b = Math.min(N - 1, i + 1);
      let dx = px[b]! - px[a]!;
      let dy = py[b]! - py[a]!;
      const l = Math.hypot(dx, dy) || 1;
      dx /= l;
      dy /= l;
      const w = pw[i]! / 2;
      lx[i] = px[i]! - dy * w;
      ly[i] = py[i]! + dx * w;
      rx[i] = px[i]! + dy * w;
      ry[i] = py[i]! - dx * w;
    }
    const ribbon = (scale: number): void => {
      ctx.beginPath();
      for (let i = 0; i < N; i++) {
        const x = px[i]! + (lx[i]! - px[i]!) * scale;
        const y = py[i]! + (ly[i]! - py[i]!) * scale;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      for (let i = N - 1; i >= 0; i--) ctx.lineTo(px[i]! + (rx[i]! - px[i]!) * scale, py[i]! + (ry[i]! - py[i]!) * scale);
      ctx.closePath();
    };
    const y0 = py[0]!;
    const span = y0 - f.top;
    const stopAt = (y: number): number => clamp((y0 - y) / span, 0, 1);
    const glass = this.cfg.railStyle === 'glass';

    // Soft halo first (additive), so the metal sits in its own light.
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(px[0]!, py[0]!);
    for (let i = 1; i < N; i++) ctx.lineTo(px[i]!, py[i]!);
    const halo = ctx.createLinearGradient(0, y0, 0, f.top);
    halo.addColorStop(0, `rgba(${LIME},0)`);
    halo.addColorStop(stopAt(this.yBend), `rgba(${LIME},.05)`);
    halo.addColorStop(stopAt(this.yVert), `rgba(${LIME},.11)`);
    halo.addColorStop(1, `rgba(${LIME},.03)`);
    ctx.strokeStyle = halo;
    ctx.lineWidth = pw[N - 1]! * 4.2;
    ctx.globalAlpha = IN;
    ctx.stroke();
    ctx.globalCompositeOperation = 'source-over';

    // Body.
    const body = ctx.createLinearGradient(0, y0, 0, f.top);
    if (glass) {
      body.addColorStop(0, 'rgba(150,185,235,.20)');
      body.addColorStop(stopAt(this.yVert), 'rgba(170,205,245,.34)');
      body.addColorStop(1, 'rgba(170,205,245,.06)');
    } else {
      body.addColorStop(0, 'rgba(24,34,56,.96)');
      body.addColorStop(stopAt(this.yBend), 'rgba(32,44,70,.96)');
      body.addColorStop(stopAt(this.yVert), 'rgba(46,60,92,.97)');
      body.addColorStop(1, 'rgba(30,42,68,.35)');
    }
    ctx.fillStyle = body;
    ctx.globalAlpha = IN;
    ribbon(1);
    ctx.fill();

    // Key-light edge (left side, like the dial's lip) and a dark seam on the other side.
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(lx[0]!, ly[0]!);
    for (let i = 1; i < N; i++) ctx.lineTo(lx[i]!, ly[i]!);
    const edge = ctx.createLinearGradient(0, y0, 0, f.top);
    edge.addColorStop(0, 'rgba(190,210,245,.28)');
    edge.addColorStop(stopAt(this.yVert), `rgba(214,228,252,${glass ? 0.7 : 0.55})`);
    edge.addColorStop(1, 'rgba(214,228,252,.05)');
    ctx.strokeStyle = edge;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(rx[0]!, ry[0]!);
    for (let i = 1; i < N; i++) ctx.lineTo(rx[i]!, ry[i]!);
    ctx.strokeStyle = 'rgba(0,0,0,.45)';
    ctx.stroke();

    // Inset light channel.
    ctx.globalCompositeOperation = 'lighter';
    const ch = ctx.createLinearGradient(0, y0, 0, f.top);
    ch.addColorStop(0, `rgba(${LIME},.28)`);
    ch.addColorStop(stopAt(this.yBend), `rgba(${LIME},.55)`);
    ch.addColorStop(stopAt(this.yVert), `rgba(${LIME},.85)`);
    ch.addColorStop(1, `rgba(${LIME},.12)`);
    ctx.fillStyle = ch;
    ctx.globalAlpha = IN;
    ribbon(0.34);
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
  }

  /** Hoops: back half behind the traffic, front half in front. Perspective is physical: flat at eye level. */
  private drawRings(ctx: CanvasRenderingContext2D, IN: number, front: boolean): void {
    const f = this.f;
    const kk = this.kk;
    const dB = this.cfg.bendDepth;
    for (let k = 0; k < this.ringY.length; k++) {
      const y = this.ringY[k]!;
      if (y < f.top + 4) continue;
      const rx = this.ringHalf;
      const ry = Math.abs(f.VY - y) * (0.55 / dB);
      const heat = clamp(this.heat[k] ?? 0, 0, 1);
      const above = y < f.VY; // above eye level we see the underside: the near arc is the upper one
      const nearIsUpper = above;
      const drawUpper = front ? nearIsUpper : !nearIsUpper;
      const fade = ss(f.top, f.top + 90, y);
      const a0 = IN * fade;

      ctx.beginPath();
      ctx.ellipse(this.cx, y, rx, Math.max(0.6, ry), 0, drawUpper ? Math.PI : 0, drawUpper ? Math.PI * 2 : Math.PI);
      ctx.lineCap = 'round';
      // Glass band.
      ctx.globalAlpha = a0 * (front ? 0.24 : 0.12);
      ctx.lineWidth = 2.2 * kk;
      ctx.strokeStyle = `rgba(${COOL},.26)`;
      ctx.stroke();
      // Specular line.
      ctx.globalAlpha = a0 * (front ? 0.36 : 0.16);
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(225,236,255,.55)';
      ctx.stroke();
      if (heat > 0.02) {
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = a0 * heat * (front ? 0.8 : 0.4);
        ctx.lineWidth = 1.4 * kk;
        ctx.strokeStyle = `rgba(${LIME},1)`;
        ctx.stroke();
        ctx.globalAlpha = a0 * heat * 0.08;
        ctx.lineWidth = 6 * kk;
        ctx.stroke();
        ctx.globalCompositeOperation = 'source-over';
      }
      if (front) {
        // Clamps where the hoop meets each guard rail.
        for (const sx of [-1, 1]) {
          const x = this.cx + sx * rx;
          const w = 5.5 * kk;
          const h = 3.6 * kk;
          ctx.globalAlpha = a0 * 0.95;
          const g = ctx.createLinearGradient(0, y - h / 2, 0, y + h / 2);
          g.addColorStop(0, 'rgba(84,100,138,.95)');
          g.addColorStop(1, 'rgba(22,30,50,.95)');
          ctx.fillStyle = g;
          ctx.fillRect(x - w / 2, y - h / 2, w, h);
          ctx.fillStyle = 'rgba(220,232,255,.5)';
          ctx.fillRect(x - w / 2, y - h / 2, w, 0.8);
          if (heat > 0.05) {
            ctx.globalCompositeOperation = 'lighter';
            ctx.globalAlpha = a0 * heat * 0.5;
            const gs = 10 * kk;
            ctx.drawImage(this.glow, x - gs, y - gs, gs * 2, gs * 2);
            ctx.globalCompositeOperation = 'source-over';
          }
        }
      }
    }
    ctx.globalAlpha = f.IN;
  }

  /** Throat gate: a machined collar at the base of the climb with one index light per lane. */
  private drawGate(ctx: CanvasRenderingContext2D, IN: number): void {
    const kk = this.kk;
    const mid = this.strands[Math.floor(this.nLanes / 2) + 1]!;
    const y = mid.ay[NB]!;
    const xl = this.strands[0]!.ax[NB]! - 9 * kk;
    const xr = this.strands[this.strands.length - 1]!.ax[NB]! + 9 * kk;
    const h = 8 * kk;
    const w = xr - xl;
    ctx.globalAlpha = IN * 0.95;
    const g = ctx.createLinearGradient(0, y - h / 2, 0, y + h / 2);
    g.addColorStop(0, 'rgba(70,86,122,.96)');
    g.addColorStop(0.15, 'rgba(34,46,74,.96)');
    g.addColorStop(1, 'rgba(10,15,28,.98)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.roundRect?.(xl, y - h / 2, w, h, 2.5 * kk);
    if (!ctx.roundRect) ctx.rect(xl, y - h / 2, w, h);
    ctx.fill();
    ctx.fillStyle = 'rgba(214,228,252,.5)';
    ctx.fillRect(xl + 1, y - h / 2, w - 2, 0.9);
    ctx.fillStyle = 'rgba(0,0,0,.6)';
    ctx.fillRect(xl, y + h / 2 - 0.9, w, 0.9);
    // Index slots.
    for (let n = 0; n < this.nLanes; n++) {
      const st = this.strands[n + 1]!;
      const x = st.ax[NB]!;
      const e = clamp(this.gate[n] ?? 0, 0, 1);
      const sw = Math.max(1.6, 2.2 * kk);
      ctx.globalAlpha = IN;
      ctx.fillStyle = e > 0.02 ? `rgba(${LIME},${0.2 + 0.8 * e})` : 'rgba(6,10,20,.8)';
      ctx.fillRect(x - sw / 2, y - h * 0.28, sw, h * 0.56);
      if (e > 0.05) {
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = IN * e;
        const gs = 15 * kk;
        ctx.drawImage(this.glow, x - gs, y - gs, gs * 2, gs * 2);
        ctx.globalCompositeOperation = 'source-over';
      }
    }
    ctx.globalAlpha = this.f.IN;
  }

  /* ------------------------------ drawing: traffic ------------------------------ */

  /**
   * Draw one vehicle that is on the climb. `idx` is a stable per-vehicle index (for edge detection).
   * `vis0` is the brightness the vehicle had on the ground at the bend, so the hand-off is seamless.
   */
  drawHead(ctx: CanvasRenderingContext2D, idx: number, lane: RailLane, x: number, vis0: number, gCool: HTMLCanvasElement, gLime: HTMLCanvasElement): void {
    const f = this.f;
    const st = this.strands[lane.i + 1];
    if (!st) return;
    const kk = this.kk;
    const IN = f.IN * this.gain;
    const s = this.shape(x);
    const q = s * st.Q;
    this.pointAt(st, q, this.out);
    const hx = this.out.x;
    const hy = this.out.y;
    if (hy < f.top - 40) return;
    const vTop = (st.Q * this.shapeSlope(1)) / this.Ta;
    const v = (st.Q * this.shapeSlope(x)) / this.Ta;
    const sp = clamp(v / vTop, 0, 1);

    // Edge events.
    const pxv = this.prevX[idx] ?? 0;
    if (!f.rm) {
      if (pxv < x) {
        if (q >= st.Qb && pxv * st.Q < st.Qb && lane.i >= 0 && lane.i < this.gate.length) this.gate[lane.i] = 1;
        if (pxv < 0.12 && x >= 0.12 && this.cfg.sparks && hash(idx, Math.floor(f.T)) < 0.7) this.spawn(hx, hy, st);
        if (pxv < 0.88 && x >= 0.88) this.exitHeat = Math.min(1, this.exitHeat + 0.4);
      }
      this.prevX[idx] = x;
    }
    this.act = Math.min(1.6, this.act + 0.02 + 0.05 * sp);

    // Hoop heat.
    const sig = 0.7 * Math.max(0.02, this.shape(Math.min(1, x + 0.08)) - s);
    for (let k = 0; k < this.ringS.length; k++) {
      const dq = (this.ringS[k]! - s) / Math.max(0.004, sig);
      const e = Math.exp(-dq * dq) * (0.6 + 0.4 * sp);
      if (e > this.heat[k]!) this.heat[k] = e;
    }

    // Brightness: continues from the ground value, then flares as the launch builds.
    const bright = (vis0 + (1 - vis0) * ss(0, 0.3, x)) * ss(0, 0.04, x + 0.04) * ss(f.top - 30, f.top + 60, hy);
    const colr = lane.lime ? LIME : '190,208,240';

    // Streak: length follows speed.
    const Ltr = clamp(v * 0.19, 10, 260) * kk;
    const NT = 7;
    const tx = this.trX;
    const ty = this.trY;
    for (let j = 0; j <= NT; j++) {
      this.pointAt(st, q - (Ltr * j) / NT, this.out);
      tx[j] = this.out.x;
      ty[j] = this.out.y;
    }
    if (Math.abs(ty[0]! - ty[NT]!) > 0.5 || Math.abs(tx[0]! - tx[NT]!) > 0.5) {
      const g = ctx.createLinearGradient(tx[0]!, ty[0]!, tx[NT]!, ty[NT]!);
      g.addColorStop(0, `rgba(${colr},${0.9 * bright})`);
      g.addColorStop(0.35, `rgba(${colr},${0.4 * bright})`);
      g.addColorStop(1, `rgba(${colr},0)`);
      ctx.globalCompositeOperation = 'lighter';
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(tx[0]!, ty[0]!);
      for (let j = 1; j <= NT; j++) ctx.lineTo(tx[j]!, ty[j]!);
      ctx.strokeStyle = g;
      ctx.globalAlpha = IN * 0.36;
      ctx.lineWidth = (4.6 + 3.4 * sp) * kk;
      ctx.stroke();
      ctx.globalAlpha = IN;
      ctx.lineWidth = (1.7 + 1.1 * sp) * kk;
      ctx.stroke();
    }

    // Head.
    const gs = (9 + 14 * sp) * kk;
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = IN * bright * (0.7 + 0.3 * sp);
    ctx.drawImage(lane.lime ? gLime : gCool, hx - gs, hy - gs, gs * 2, gs * 2);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = IN * bright;
    ctx.fillStyle = '#F4F8FF';
    ctx.beginPath();
    ctx.arc(hx, hy, (1.1 + 1.2 * sp) * kk, 0, 6.2832);
    ctx.fill();

    // Light spilling on the guard rails as the vehicle whips past.
    const l0 = this.strands[0]!;
    const r0 = this.strands[this.strands.length - 1]!;
    this.pointAt(l0, s * l0.Q, this.out);
    const lx = this.out.x;
    const ly = this.out.y;
    this.pointAt(r0, s * r0.Q, this.out);
    const rx = this.out.x;
    const ry = this.out.y;
    ctx.globalCompositeOperation = 'lighter';
    const spill = (14 + 10 * sp) * kk;
    ctx.globalAlpha = IN * bright * 0.2 * ss(0.12, 0.5, x);
    ctx.drawImage(this.glow, lx - spill, ly - spill, spill * 2, spill * 2);
    ctx.drawImage(this.glow, rx - spill, ry - spill, spill * 2, spill * 2);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = f.IN;
  }

  /** Front layer: front hoop arcs and clamps, exit glow, sparks. Call after all vehicles. */
  drawFront(ctx: CanvasRenderingContext2D): void {
    const f = this.f;
    if (!f || this.strands.length === 0) return;
    const IN = f.IN * this.gain;
    this.drawRings(ctx, IN, true);

    // Exit glow: where the lights leave the top of the hero.
    const e = 0.04 + 0.4 * this.exitHeat;
    const kk = this.kk;
    const rw = this.ringHalf * 3;
    const rh = 120 * kk;
    ctx.globalCompositeOperation = 'lighter';
    ctx.save();
    ctx.translate(this.cx, Math.max(f.top, 0) + 26 * kk);
    ctx.scale(1, rh / rw);
    ctx.globalAlpha = IN * e * 0.5;
    ctx.drawImage(this.glow, -rw, -rw, rw * 2, rw * 2);
    ctx.restore();

    // Sparks.
    if (this.sparkN > 0) {
      ctx.fillStyle = `rgb(${LIME})`;
      for (let i = 0; i < MAX_SPARKS; i++) {
        const l = this.spL[i]!;
        if (l <= 0) continue;
        ctx.globalAlpha = IN * clamp(l * 1.8, 0, 1) * 0.85;
        ctx.fillRect(this.spX[i]! - 0.7, this.spY[i]! - 0.7, 1.4, 1.4);
      }
    }
    ctx.globalAlpha = f.IN;
    ctx.globalCompositeOperation = 'source-over';
  }

  /* ------------------------------ sparks ------------------------------ */

  private spawn(x: number, y: number, st: Strand): void {
    const kk = this.kk;
    for (let n = 0; n < 2; n++) {
      let slot = -1;
      for (let i = 0; i < MAX_SPARKS; i++) {
        if (this.spL[i]! <= 0) {
          slot = i;
          break;
        }
      }
      if (slot < 0) return;
      const a = hash(this.sparkN + n, x) * 6.2832;
      const sp = (30 + 60 * hash(this.sparkN, y + n)) * kk;
      this.spX[slot] = x;
      this.spY[slot] = y;
      this.spVX[slot] = Math.cos(a) * sp * 0.6;
      this.spVY[slot] = -Math.abs(Math.sin(a)) * sp - 30 * kk;
      this.spL[slot] = 0.35 + 0.35 * hash(slot, x);
      this.sparkN++;
    }
    void st;
  }

  private stepSparks(dt: number): void {
    if (this.sparkN === 0) return;
    let alive = 0;
    for (let i = 0; i < MAX_SPARKS; i++) {
      if (this.spL[i]! <= 0) continue;
      this.spL[i]! -= dt;
      this.spX[i]! += this.spVX[i]! * dt;
      this.spY[i]! += this.spVY[i]! * dt;
      this.spVX[i]! *= Math.exp(-dt * 2.5);
      this.spVY[i]! *= Math.exp(-dt * 1.2);
      if (this.spL[i]! > 0) alive++;
    }
    if (alive === 0) this.sparkN = 0;
  }

  /* ------------------------------ sprites ------------------------------ */

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

  /** Soft vertical column of light: gaussian across, brighter toward the bottom. */
  private makeColumn(): HTMLCanvasElement {
    const w = 96;
    const h = 256;
    const c = this.mk();
    c.width = w;
    c.height = h;
    const g = c.getContext('2d');
    if (!g) return c;
    const v = g.createLinearGradient(0, 0, 0, h);
    v.addColorStop(0, `rgba(${LIME},.25)`);
    v.addColorStop(0.7, `rgba(${LIME},.12)`);
    v.addColorStop(1, `rgba(${LIME},0)`);
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
}

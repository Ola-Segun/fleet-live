"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/scene.ts
var scene_exports = {};
__export(scene_exports, {
  HeroScene: () => HeroScene,
  getCenteredDialGeometry: () => getCenteredDialGeometry
});
module.exports = __toCommonJS(scene_exports);

// src/ascent.ts
var ASCENT = {
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
  /** Fraction of the desktop approach before the guard rails are fully visible. */
  guardFadeEnd: 0.5,
  /** Mobile channel composition (fractions are relative to the viewport). */
  mobileChannelX: 0.3,
  mobileChannelWidth: 0.24,
  mobilePreAngleDeg: 25,
  mobileBendRadius: 0.09,
  mobilePreLength: 0.16,
  mobileTextGain: 0.55,
  /** Speed at the top of the climb, px/s at 1080p. */
  topSpeed: 1150,
  /** Climb time law q(x) = c*x + (1-c)*x^p. Larger p = slower start, harder launch. */
  launchPower: 2.7,
  launchBase: 0.05,
  /** Ground speed multiplier in the far zone, so the approach reads as motion, not a crawl. */
  cruise: 3,
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
  railStyle: "machined"
};
var LIME = "200,237,115";
var COOL = "170,190,228";
var NG = 14;
var NB = 16;
var NV = 6;
var NA = 1 + NB + NV;
var MAX_SPARKS = 48;
var clamp = (v, a, b) => Math.min(b, Math.max(a, v));
var ss = (a, b, x) => {
  const k = clamp((x - a) / (b - a), 0, 1);
  return k * k * (3 - 2 * k);
};
var hash = (a, b) => {
  const h = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return h - Math.floor(h);
};
var Ascent = class {
  constructor(opts) {
    this.mobileBackCanvas = null;
    this.mobileFrontCanvas = null;
    this.mobileBackCtx = null;
    this.mobileFrontCtx = null;
    this.mobileFrontMask = null;
    this.mobileLayerWidth = 0;
    this.mobileLayerHeight = 0;
    this.mobileLayerDpr = 0;
    this.mobileCopyTop = Number.NaN;
    this.mobileCopyBottom = Number.NaN;
    this.strands = [];
    this.nLanes = 0;
    this.kk = 1;
    this.Ta = 1.4;
    this.taDirty = true;
    this.cx = 0;
    this.yBend = 0;
    this.yVert = 0;
    this.yDial = 0;
    this.ringS = [];
    this.ringY = [];
    this.ringHalf = 0;
    this.heat = [];
    this.gate = [];
    this.prevX = new Float32Array(0);
    this.act = 0;
    this.exitHeat = 0;
    this.sparkN = 0;
    this.spX = new Float32Array(MAX_SPARKS);
    this.spY = new Float32Array(MAX_SPARKS);
    this.spVX = new Float32Array(MAX_SPARKS);
    this.spVY = new Float32Array(MAX_SPARKS);
    this.spL = new Float32Array(MAX_SPARKS);
    // Scratch buffers: allocated once, reused every frame (render must stay allocation-free).
    this.sPx = new Float32Array(NG + NA - 1);
    this.sPy = new Float32Array(NG + NA - 1);
    this.sPw = new Float32Array(NG + NA - 1);
    this.sLx = new Float32Array(NG + NA - 1);
    this.sLy = new Float32Array(NG + NA - 1);
    this.sRx = new Float32Array(NG + NA - 1);
    this.sRy = new Float32Array(NG + NA - 1);
    this.trX = new Float32Array(8);
    this.trY = new Float32Array(8);
    this.pt = { x: 0, y: 0, s: 1 };
    this.pt2 = { x: 0, y: 0, s: 1 };
    this.out = { x: 0, y: 0 };
    this.cfg = { ...ASCENT, ...opts.config };
    this.mk = opts.makeCanvas ?? (() => document.createElement("canvas"));
    this.dMin = opts.dMin;
    this.dMax = opts.dMax;
    this.dBack = opts.dialBack;
    this.lr = Math.log(opts.dMax / opts.dMin);
    this.ub = Math.log(this.cfg.bendDepth / opts.dMin) / this.lr;
    const N = 512;
    this.gOfU = new Float32Array(N + 1);
    let acc = 0;
    let prev = 1 / this.mult(0);
    for (let i = 1; i <= N; i++) {
      const u = this.ub * i / N;
      const cur = 1 / this.mult(u);
      acc += (prev + cur) / 2 * (this.ub / N);
      this.gOfU[i] = acc;
      prev = cur;
    }
    this.gMax = acc;
    this.uOfG = new Float32Array(N + 1);
    let j = 0;
    for (let i = 0; i <= N; i++) {
      const g = this.gMax * i / N;
      while (j < N && this.gOfU[j + 1] < g) j++;
      const g0 = this.gOfU[j];
      const g1 = this.gOfU[Math.min(N, j + 1)];
      const k = g1 > g0 ? (g - g0) / (g1 - g0) : 0;
      this.uOfG[i] = this.ub * (j + k) / N;
    }
    this.glow = this.radial(LIME);
    this.column = this.makeColumn();
  }
  /* ------------------------------ kinematics ------------------------------ */
  /** Ground speed multiplier at log-depth u (1 near the dial, boosted far away, braking into the bend). */
  mult(u) {
    const d = this.dMin * Math.exp(u * this.lr);
    const far = ss(20, 28, d);
    const boost = 1 + (this.cfg.cruise - 1) * far;
    const brake = 1 - (1 - this.cfg.brake) * ss(this.ub - this.cfg.brakeSpan, this.ub, u);
    return boost * brake;
  }
  /** Ascent shape: fraction of the climb covered at time fraction x. */
  shape(x) {
    const c = this.cfg.launchBase;
    return c * x + (1 - c) * Math.pow(x, this.cfg.launchPower);
  }
  shapeSlope(x) {
    const c = this.cfg.launchBase;
    return c + (1 - c) * this.cfg.launchPower * Math.pow(x, this.cfg.launchPower - 1);
  }
  /** Where in its cycle a vehicle is at time t. `offset` is its 0..1 phase, `sp` its ground rate. */
  state(offset, sp, t, o) {
    const Pg = this.gMax / sp;
    const P = Pg + this.Ta;
    const tau = ((offset * P + t) % P + P) % P;
    if (tau < Pg) {
      const g = sp * tau / this.gMax;
      const f = clamp(g, 0, 1) * (this.uOfG.length - 1);
      const i = Math.min(this.uOfG.length - 2, Math.floor(f));
      o.u = this.uOfG[i] + (this.uOfG[i + 1] - this.uOfG[i]) * (f - i);
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
  stratify(agents) {
    const N = agents.length;
    if (N === 0) return;
    const order = agents.map((_, i) => i).sort((a, b) => hash(a, 3.1) - hash(b, 3.1));
    order.forEach((idx, j) => {
      const a = agents[idx];
      const Pg = this.gMax / a.sp;
      const P = Pg + this.Ta;
      const o = Pg / P - (j + 0.5 + (hash(idx, 7.7) - 0.5) * 0.7) / N;
      a.u = o - Math.floor(o);
    });
  }
  /** Log-depth of the bend, for callers that need to clamp ground state. */
  get bendU() {
    return this.ub;
  }
  /** World depth where the lanes leave the ground. */
  get bendDepth() {
    return this.cfg.bendDepth;
  }
  /** Screen speed (px/s) of a vehicle at ascent fraction x on the centre strand. For tests and tuning. */
  speedAt(x) {
    const s = this.strands[Math.floor(this.nLanes / 2) + 1];
    return s ? s.Q * this.shapeSlope(x) / this.Ta : 0;
  }
  get climbSeconds() {
    return this.Ta;
  }
  /* ------------------------------ setup ------------------------------ */
  /** Call from resize(). `lanes` are the real lanes; guards are created here as virtual lanes. */
  setLanes(lanes, zh, pad) {
    this.nLanes = lanes.length;
    const gv = 1 + (pad * 0.9 + 0.05) / Math.max(0.01, zh);
    const mkStrand = (lane, guard) => ({
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
      Qb: 1
    });
    this.strands = [
      mkStrand({ i: -1, v: -gv, lime: false, lit: 0 }, -1),
      ...lanes.map((l) => mkStrand(l, 0)),
      mkStrand({ i: lanes.length, v: gv, lime: false, lit: 0 }, 1)
    ];
    this.heat = new Array(this.cfg.rings).fill(0);
    this.gate = new Array(lanes.length).fill(0);
    this.prevX = new Float32Array(lanes.length * 8);
    this.taDirty = true;
  }
  textMask(ctx, f) {
    const top = clamp(f.copyTop ?? f.H * 0.17, 0, f.H);
    const bottom = clamp(f.copyBottom ?? f.H * 0.52, top, f.H);
    const ramp = 40;
    const g = ctx.createLinearGradient(0, 0, 0, f.H);
    g.addColorStop(0, "rgba(0,0,0,1)");
    g.addColorStop(clamp((top - ramp) / f.H, 0, 1), "rgba(0,0,0,1)");
    g.addColorStop(clamp(top / f.H, 0, 1), `rgba(0,0,0,${this.cfg.mobileTextGain})`);
    g.addColorStop(clamp(bottom / f.H, 0, 1), `rgba(0,0,0,${this.cfg.mobileTextGain})`);
    g.addColorStop(clamp((bottom + ramp) / f.H, 0, 1), "rgba(0,0,0,1)");
    g.addColorStop(1, "rgba(0,0,0,1)");
    return g;
  }
  prepareMobileLayers(f) {
    if (!f.small) return;
    if (!this.mobileBackCanvas || !this.mobileFrontCanvas) {
      this.mobileBackCanvas = this.mk();
      this.mobileFrontCanvas = this.mk();
      const back = this.mobileBackCanvas.getContext("2d", { desynchronized: true });
      const front = this.mobileFrontCanvas.getContext("2d", { desynchronized: true });
      if (!back || !front) throw new Error("Ascent: mobile 2D layers are unavailable");
      this.mobileBackCtx = back;
      this.mobileFrontCtx = front;
      this.mobileLayerWidth = 0;
    }
    const dpr = f.dpr ?? 1;
    const width = Math.max(2, Math.round(f.W * dpr));
    const height = Math.max(2, Math.round(f.H * dpr));
    const copyTop = f.copyTop ?? f.H * 0.17;
    const copyBottom = f.copyBottom ?? f.H * 0.52;
    const resized = width !== this.mobileLayerWidth || height !== this.mobileLayerHeight || dpr !== this.mobileLayerDpr;
    const layoutChanged = copyTop !== this.mobileCopyTop || copyBottom !== this.mobileCopyBottom;
    if (resized) {
      this.mobileBackCanvas.width = width;
      this.mobileBackCanvas.height = height;
      this.mobileFrontCanvas.width = width;
      this.mobileFrontCanvas.height = height;
      this.mobileBackCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.mobileFrontCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.mobileLayerWidth = width;
      this.mobileLayerHeight = height;
      this.mobileLayerDpr = dpr;
    }
    if (resized || layoutChanged) {
      this.mobileFrontMask = this.textMask(this.mobileFrontCtx, f);
      this.mobileCopyTop = copyTop;
      this.mobileCopyBottom = copyBottom;
    }
    this.mobileBackCtx.clearRect(0, 0, f.W, f.H);
    this.mobileFrontCtx.clearRect(0, 0, f.W, f.H);
  }
  compositeMobileLayer(target, source, sourceCtx, mask) {
    sourceCtx.globalAlpha = 1;
    sourceCtx.globalCompositeOperation = "destination-in";
    sourceCtx.fillStyle = mask;
    sourceCtx.fillRect(0, 0, this.f.W, this.f.H);
    sourceCtx.globalCompositeOperation = "source-over";
    target.save();
    target.globalAlpha = 1;
    target.globalCompositeOperation = "source-over";
    target.drawImage(source, 0, 0, this.f.W, this.f.H);
    target.restore();
  }
  buildBendStrands(f) {
    const nS = this.strands.length;
    const cx = this.cx = this.cfg.mobileChannelX * f.W;
    const halfWidth = this.cfg.mobileChannelWidth * f.W * 0.5;
    const theta = this.cfg.mobilePreAngleDeg * Math.PI / 180;
    const radius = Math.max(1, this.cfg.mobileBendRadius * f.H);
    const yBend = f.H * 0.42;
    const yStart = yBend + this.cfg.mobilePreLength * f.H;
    const rise = yStart - yBend;
    const xEntry = cx - halfWidth - radius * (1 - Math.cos(theta));
    const circleX = xEntry - radius * Math.cos(theta);
    const circleY = yBend - radius * Math.sin(theta);
    const leftStart = xEntry - rise * Math.tan(theta);
    const railWidth = 5.5;
    for (let i = 0; i < nS; i++) {
      const st = this.strands[i];
      const laneT = i / (nS - 1);
      const mirror = 1 - 2 * laneT;
      const width = st.guard !== 0 ? railWidth : 1.2;
      for (let j = 0; j < NG; j++) {
        const t = j / (NG - 1);
        const leftX = leftStart + (xEntry - leftStart) * t;
        st.gx[j] = cx + (leftX - cx) * mirror;
        st.gy[j] = yStart + (yBend - yStart) * t;
        st.gw[j] = width;
      }
      const finalX = cx + (laneT * 2 - 1) * halfWidth;
      for (let j = 0; j <= NB; j++) {
        const t = j / NB;
        const angle = theta * (1 - t);
        const leftX = circleX + radius * Math.cos(angle);
        const leftY = circleY + radius * Math.sin(angle);
        const k = j;
        st.ax[k] = cx + (leftX - cx) * mirror;
        st.ay[k] = leftY;
        st.aw[k] = width;
      }
      for (let j = 1; j <= NV; j++) {
        const k = NB + j;
        st.ax[k] = finalX;
        st.ay[k] = circleY + (f.top - circleY) * j / NV;
        st.aw[k] = width;
      }
      st.cum[0] = 0;
      for (let k = 1; k < NA; k++) {
        st.cum[k] = st.cum[k - 1] + Math.hypot(st.ax[k] - st.ax[k - 1], st.ay[k] - st.ay[k - 1]);
      }
      st.Q = st.cum[NA - 1];
      st.Qb = st.cum[NB];
    }
    this.yBend = yBend;
    this.yVert = circleY;
    this.yDial = yStart;
  }
  /* ------------------------------ per-frame geometry ------------------------------ */
  frame(f) {
    this.f = f;
    this.prepareMobileLayers(f);
    const cfg = this.cfg;
    const kk = (this.kk = 1) * (f.small ? 1 : clamp(f.H / 1080, 0.7, 1.25));
    const db = cfg.bendDepth;
    const { pt, pt2 } = this;
    const nS = this.strands.length;
    if (nS === 0) return;
    if (f.small) {
      this.buildBendStrands(f);
    } else {
      for (const st of this.strands) {
        for (let i = 0; i < NG; i++) {
          const d = this.dBack * Math.pow(db / this.dBack, i / (NG - 1));
          f.proj(f.laneZ(st.lane, d), 0.05, d, pt);
          st.gx[i] = pt.x;
          st.gy[i] = pt.y;
          st.gw[i] = clamp(pt.s * 0.05, 1.3, 7);
        }
      }
      const L = this.strands[1];
      const R = this.strands[nS - 2];
      this.cx = (L.gx[NG - 1] + R.gx[NG - 1]) / 2;
      const rise = cfg.bendRise * kk;
      const yTop = f.top;
      for (const st of this.strands) {
        const x0 = st.gx[NG - 1];
        const y0 = st.gy[NG - 1];
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
        const w0 = st.gw[NG - 1];
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
          st.ay[k] = yc + (yTop - yc) * j / NV;
          st.aw[k] = wA;
        }
        st.cum[0] = 0;
        for (let k = 1; k < NA; k++) {
          st.cum[k] = st.cum[k - 1] + Math.hypot(st.ax[k] - st.ax[k - 1], st.ay[k] - st.ay[k - 1]);
        }
        st.Q = st.cum[NA - 1];
        st.Qb = st.cum[NB];
      }
    }
    const mid = this.strands[Math.floor(this.nLanes / 2) + 1];
    this.yBend = mid.ay[0];
    this.yVert = mid.ay[NB];
    this.yDial = f.small ? this.strands[0].gy[0] : this.strands[1].gy[0];
    if (this.taDirty) {
      this.taDirty = false;
      const vTop = cfg.topSpeed * clamp(f.H / 1080, 0.6, 1.25);
      this.Ta = mid.Q * this.shapeSlope(1) / vTop;
    }
    const K = f.small ? 7 : cfg.rings;
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
      const x = xA + (0.97 - xA) * k / (K - 1);
      const s = this.shape(x);
      this.ringS.push(s);
      this.pointAt(mid, s * mid.Q, this.out);
      this.ringY.push(this.out.y);
    }
    while (this.heat.length < K) this.heat.push(0);
    const gl = this.strands[0];
    const gr = this.strands[nS - 1];
    this.ringHalf = (gr.ax[NA - 1] - gl.ax[NA - 1]) / 2 + 6 * kk;
    const dt = f.dt;
    const hd = Math.exp(-dt * 1 / cfg.ringDecay);
    for (let k = 0; k < this.heat.length; k++) this.heat[k] *= hd;
    for (let i = 0; i < this.gate.length; i++) this.gate[i] *= Math.exp(-dt * 3.2);
    this.exitHeat *= Math.exp(-dt * 2.4);
    this.act *= Math.exp(-dt * 2.2);
    this.stepSparks(dt);
  }
  /** Position at arc length q along a strand's ascent polyline. */
  pointAt(st, q, o) {
    const qq = clamp(q, 0, st.Q);
    let lo = 0;
    let hi = NA - 1;
    while (hi - lo > 1) {
      const m = lo + hi >> 1;
      if (st.cum[m] < qq) lo = m;
      else hi = m;
    }
    const seg = st.cum[hi] - st.cum[lo];
    const k = seg > 0 ? (qq - st.cum[lo]) / seg : 0;
    o.x = st.ax[lo] + (st.ax[hi] - st.ax[lo]) * k;
    o.y = st.ay[lo] + (st.ay[hi] - st.ay[lo]) * k;
  }
  /** Fade applied to the whole channel as the hero scrolls away. */
  get gain() {
    return 1 - 0.5 * this.f.scroll;
  }
  /* ------------------------------ drawing: back layer ------------------------------ */
  /** Everything behind the vehicles: glow, veil, hoop backs, lane guides, guard rails, gate. */
  drawBack(ctx, lanes) {
    const f = this.f;
    if (!f || this.strands.length === 0) return;
    if (f.small) ctx = this.mobileBackCtx;
    const IN = f.IN * this.gain;
    const st0 = this.strands[0];
    const stN = this.strands[this.strands.length - 1];
    {
      const half = this.ringHalf * 2.6;
      const y0 = Math.max(f.top, 0) - 20;
      const y1 = this.yVert + 30;
      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = IN * (0.1 + 0.45 * Math.min(1, this.act));
      ctx.drawImage(this.column, this.cx - half, y0, half * 2, y1 - y0);
      ctx.globalCompositeOperation = "source-over";
    }
    {
      ctx.beginPath();
      const i0 = 7;
      for (let i = i0; i < NG; i++) (i === i0 ? ctx.moveTo : ctx.lineTo).call(ctx, st0.gx[i], st0.gy[i]);
      for (let k = 1; k < NA; k++) ctx.lineTo(st0.ax[k], st0.ay[k]);
      for (let k = NA - 1; k >= 1; k--) ctx.lineTo(stN.ax[k], stN.ay[k]);
      for (let i = NG - 1; i >= i0; i--) ctx.lineTo(stN.gx[i], stN.gy[i]);
      ctx.closePath();
      const gy0 = st0.gy[i0];
      const g = ctx.createLinearGradient(0, gy0, 0, f.top);
      g.addColorStop(0, `rgba(${COOL},0)`);
      g.addColorStop(clamp((gy0 - this.yBend) / (gy0 - f.top), 0, 1), `rgba(${COOL},.05)`);
      g.addColorStop(clamp((gy0 - this.yVert) / (gy0 - f.top), 0, 1), `rgba(${COOL},.08)`);
      g.addColorStop(1, `rgba(${COOL},.012)`);
      ctx.globalAlpha = IN;
      ctx.fillStyle = g;
      ctx.fill();
      for (const fr of [0.3, 0.7]) {
        ctx.beginPath();
        for (let k = 0; k < NA; k++) {
          const x = st0.ax[k] + (stN.ax[k] - st0.ax[k]) * fr;
          if (k === 0) ctx.moveTo(x, st0.ay[k]);
          else ctx.lineTo(x, st0.ay[k]);
        }
        ctx.lineWidth = Math.max(5, (stN.ax[NA - 1] - st0.ax[NA - 1]) * 0.12);
        const sg = ctx.createLinearGradient(0, this.yBend, 0, f.top);
        sg.addColorStop(0, "rgba(255,255,255,.0)");
        sg.addColorStop(0.35, `rgba(255,255,255,${fr < 0.5 ? 0.05 : 0.03})`);
        sg.addColorStop(1, "rgba(255,255,255,0)");
        ctx.strokeStyle = sg;
        ctx.stroke();
      }
    }
    this.drawRings(ctx, IN, false);
    {
      const g = ctx.createLinearGradient(0, this.yDial, 0, f.top);
      const span = this.yDial - f.top;
      g.addColorStop(0, `rgba(${COOL},.5)`);
      g.addColorStop(clamp((this.yDial - this.yBend) / span, 0, 1), `rgba(${COOL},.3)`);
      g.addColorStop(clamp((this.yDial - this.yVert) / span, 0, 1), `rgba(${COOL},.42)`);
      g.addColorStop(1, `rgba(${COOL},.06)`);
      ctx.lineWidth = 1.2;
      ctx.lineJoin = "round";
      for (let n = 0; n < lanes.length; n++) {
        const st = this.strands[n + 1];
        const lane = lanes[n];
        ctx.strokeStyle = g;
        ctx.globalAlpha = IN * clamp(0.55 + lane.lit * 0.9, 0, 1);
        this.tracePath(ctx, st);
        ctx.stroke();
      }
    }
    this.drawGuard(ctx, st0, IN);
    this.drawGuard(ctx, stN, IN);
    if (this.cfg.gate) this.drawGate(ctx, IN);
    ctx.globalAlpha = f.IN;
    ctx.globalCompositeOperation = "source-over";
    if (f.small) {
      const front = this.mobileFrontCtx;
      front.globalAlpha = 1;
      front.globalCompositeOperation = "source-over";
      front.drawImage(this.mobileBackCanvas, 0, 0, f.W, f.H);
    }
  }
  tracePath(ctx, st) {
    ctx.beginPath();
    ctx.moveTo(st.gx[0], st.gy[0]);
    for (let i = 1; i < NG; i++) ctx.lineTo(st.gx[i], st.gy[i]);
    for (let k = 1; k < NA; k++) ctx.lineTo(st.ax[k], st.ay[k]);
  }
  /** A guard rail as a tapered ribbon: metal body, key-light edge, inset light channel, soft glow. */
  drawGuard(ctx, st, IN) {
    const f = this.f;
    const N = NG + NA - 1;
    const px = this.sPx;
    const py = this.sPy;
    const pw = this.sPw;
    for (let i = 0; i < NG; i++) {
      px[i] = st.gx[i];
      py[i] = st.gy[i];
      pw[i] = st.gw[i];
    }
    for (let k = 1; k < NA; k++) {
      px[NG - 1 + k] = st.ax[k];
      py[NG - 1 + k] = st.ay[k];
      pw[NG - 1 + k] = st.aw[k];
    }
    const lx = this.sLx;
    const ly = this.sLy;
    const rx = this.sRx;
    const ry = this.sRy;
    for (let i = 0; i < N; i++) {
      const a = Math.max(0, i - 1);
      const b = Math.min(N - 1, i + 1);
      let dx = px[b] - px[a];
      let dy = py[b] - py[a];
      const l = Math.hypot(dx, dy) || 1;
      dx /= l;
      dy /= l;
      const w = pw[i] / 2;
      lx[i] = px[i] - dy * w;
      ly[i] = py[i] + dx * w;
      rx[i] = px[i] + dy * w;
      ry[i] = py[i] - dx * w;
    }
    const ribbon = (scale) => {
      ctx.beginPath();
      for (let i = 0; i < N; i++) {
        const x = px[i] + (lx[i] - px[i]) * scale;
        const y = py[i] + (ly[i] - py[i]) * scale;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      for (let i = N - 1; i >= 0; i--) ctx.lineTo(px[i] + (rx[i] - px[i]) * scale, py[i] + (ry[i] - py[i]) * scale);
      ctx.closePath();
    };
    const y0 = py[0];
    const span = y0 - f.top;
    const stopAt = (y) => clamp((y0 - y) / span, 0, 1);
    const fadeEnd = f.small ? 0 : stopAt(y0 + (this.yBend - y0) * clamp(this.cfg.guardFadeEnd, 0, 1));
    const addFadeStops = (g, rgb, alpha) => {
      if (fadeEnd <= 0) return;
      g.addColorStop(0, `rgba(${rgb},0)`);
      g.addColorStop(fadeEnd * 0.25, `rgba(${rgb},${alpha * 0.15})`);
      g.addColorStop(fadeEnd * 0.6, `rgba(${rgb},${alpha * 0.55})`);
      g.addColorStop(fadeEnd, `rgba(${rgb},${alpha})`);
    };
    const glass = this.cfg.railStyle === "glass";
    ctx.globalCompositeOperation = "lighter";
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(px[0], py[0]);
    for (let i = 1; i < N; i++) ctx.lineTo(px[i], py[i]);
    const halo = ctx.createLinearGradient(0, y0, 0, f.top);
    if (fadeEnd > 0) addFadeStops(halo, LIME, 0.05);
    else halo.addColorStop(0, `rgba(${LIME},0)`);
    halo.addColorStop(stopAt(this.yBend), `rgba(${LIME},.05)`);
    halo.addColorStop(stopAt(this.yVert), `rgba(${LIME},.11)`);
    halo.addColorStop(1, `rgba(${LIME},.03)`);
    ctx.strokeStyle = halo;
    ctx.lineWidth = pw[N - 1] * 4.2;
    ctx.globalAlpha = IN;
    ctx.stroke();
    ctx.globalCompositeOperation = "source-over";
    const body = ctx.createLinearGradient(0, y0, 0, f.top);
    if (glass) {
      if (fadeEnd > 0) addFadeStops(body, "150,185,235", 0.2);
      else body.addColorStop(0, "rgba(150,185,235,.20)");
      body.addColorStop(stopAt(this.yVert), "rgba(170,205,245,.34)");
      body.addColorStop(1, "rgba(170,205,245,.06)");
    } else {
      if (fadeEnd > 0) addFadeStops(body, "24,34,56", 0.96);
      else body.addColorStop(0, "rgba(24,34,56,.96)");
      body.addColorStop(stopAt(this.yBend), "rgba(32,44,70,.96)");
      body.addColorStop(stopAt(this.yVert), "rgba(46,60,92,.97)");
      body.addColorStop(1, "rgba(30,42,68,.35)");
    }
    ctx.fillStyle = body;
    ctx.globalAlpha = IN;
    ribbon(1);
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(lx[0], ly[0]);
    for (let i = 1; i < N; i++) ctx.lineTo(lx[i], ly[i]);
    const edge = ctx.createLinearGradient(0, y0, 0, f.top);
    if (fadeEnd > 0) addFadeStops(edge, "190,210,245", 0.28);
    else edge.addColorStop(0, "rgba(190,210,245,.28)");
    edge.addColorStop(stopAt(this.yVert), `rgba(214,228,252,${glass ? 0.7 : 0.55})`);
    edge.addColorStop(1, "rgba(214,228,252,.05)");
    ctx.strokeStyle = edge;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(rx[0], ry[0]);
    for (let i = 1; i < N; i++) ctx.lineTo(rx[i], ry[i]);
    const seam = ctx.createLinearGradient(0, y0, 0, f.top);
    if (fadeEnd > 0) addFadeStops(seam, "0,0,0", 0.45);
    else seam.addColorStop(0, "rgba(0,0,0,.45)");
    seam.addColorStop(stopAt(this.yVert), "rgba(0,0,0,.45)");
    seam.addColorStop(1, "rgba(0,0,0,.45)");
    ctx.strokeStyle = seam;
    ctx.stroke();
    ctx.globalCompositeOperation = "lighter";
    const ch = ctx.createLinearGradient(0, y0, 0, f.top);
    if (fadeEnd > 0) addFadeStops(ch, LIME, 0.28);
    else ch.addColorStop(0, `rgba(${LIME},.28)`);
    ch.addColorStop(stopAt(this.yBend), `rgba(${LIME},.55)`);
    ch.addColorStop(stopAt(this.yVert), `rgba(${LIME},.85)`);
    ch.addColorStop(1, `rgba(${LIME},.12)`);
    ctx.fillStyle = ch;
    ctx.globalAlpha = IN;
    ribbon(0.34);
    ctx.fill();
    ctx.globalCompositeOperation = "source-over";
  }
  /** Hoops: back half behind the traffic, front half in front. Perspective is physical: flat at eye level. */
  drawRings(ctx, IN, front) {
    const f = this.f;
    const kk = this.kk;
    const dB = this.cfg.bendDepth;
    for (let k = 0; k < this.ringY.length; k++) {
      const y = this.ringY[k];
      if (y < f.top + 4) continue;
      const rx = this.ringHalf;
      const ry = Math.abs(f.VY - y) * (0.55 / dB);
      const heat = clamp(this.heat[k] ?? 0, 0, 1);
      const above = y < f.VY;
      const nearIsUpper = above;
      const drawUpper = front ? nearIsUpper : !nearIsUpper;
      const fade = ss(f.top, f.top + 90, y);
      const a0 = IN * fade;
      ctx.beginPath();
      ctx.ellipse(this.cx, y, rx, Math.max(0.6, ry), 0, drawUpper ? Math.PI : 0, drawUpper ? Math.PI * 2 : Math.PI);
      ctx.lineCap = "round";
      ctx.globalAlpha = a0 * (front ? 0.24 : 0.12);
      ctx.lineWidth = 2.2 * kk;
      ctx.strokeStyle = `rgba(${COOL},.26)`;
      ctx.stroke();
      ctx.globalAlpha = a0 * (front ? 0.36 : 0.16);
      ctx.lineWidth = 1;
      ctx.strokeStyle = "rgba(225,236,255,.55)";
      ctx.stroke();
      if (heat > 0.02) {
        ctx.globalCompositeOperation = "lighter";
        ctx.globalAlpha = a0 * heat * (front ? 0.8 : 0.4);
        ctx.lineWidth = 1.4 * kk;
        ctx.strokeStyle = `rgba(${LIME},1)`;
        ctx.stroke();
        ctx.globalAlpha = a0 * heat * 0.08;
        ctx.lineWidth = 6 * kk;
        ctx.stroke();
        ctx.globalCompositeOperation = "source-over";
      }
      if (front) {
        for (const sx of [-1, 1]) {
          const x = this.cx + sx * rx;
          const w = 5.5 * kk;
          const h = 3.6 * kk;
          ctx.globalAlpha = a0 * 0.95;
          const g = ctx.createLinearGradient(0, y - h / 2, 0, y + h / 2);
          g.addColorStop(0, "rgba(84,100,138,.95)");
          g.addColorStop(1, "rgba(22,30,50,.95)");
          ctx.fillStyle = g;
          ctx.fillRect(x - w / 2, y - h / 2, w, h);
          ctx.fillStyle = "rgba(220,232,255,.5)";
          ctx.fillRect(x - w / 2, y - h / 2, w, 0.8);
          if (heat > 0.05) {
            ctx.globalCompositeOperation = "lighter";
            ctx.globalAlpha = a0 * heat * 0.5;
            const gs = 10 * kk;
            ctx.drawImage(this.glow, x - gs, y - gs, gs * 2, gs * 2);
            ctx.globalCompositeOperation = "source-over";
          }
        }
      }
    }
    ctx.globalAlpha = f.IN;
  }
  /** Throat gate: a machined collar at the base of the climb with one index light per lane. */
  drawGate(ctx, IN) {
    const kk = this.kk;
    const mid = this.strands[Math.floor(this.nLanes / 2) + 1];
    const y = mid.ay[NB];
    const xl = this.strands[0].ax[NB] - 9 * kk;
    const xr = this.strands[this.strands.length - 1].ax[NB] + 9 * kk;
    const h = 8 * kk;
    const w = xr - xl;
    ctx.globalAlpha = IN * 0.95;
    const g = ctx.createLinearGradient(0, y - h / 2, 0, y + h / 2);
    g.addColorStop(0, "rgba(70,86,122,.96)");
    g.addColorStop(0.15, "rgba(34,46,74,.96)");
    g.addColorStop(1, "rgba(10,15,28,.98)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.roundRect?.(xl, y - h / 2, w, h, 2.5 * kk);
    if (!ctx.roundRect) ctx.rect(xl, y - h / 2, w, h);
    ctx.fill();
    ctx.fillStyle = "rgba(214,228,252,.5)";
    ctx.fillRect(xl + 1, y - h / 2, w - 2, 0.9);
    ctx.fillStyle = "rgba(0,0,0,.6)";
    ctx.fillRect(xl, y + h / 2 - 0.9, w, 0.9);
    for (let n = 0; n < this.nLanes; n++) {
      const st = this.strands[n + 1];
      const x = st.ax[NB];
      const e = clamp(this.gate[n] ?? 0, 0, 1);
      const sw = Math.max(1.6, 2.2 * kk);
      ctx.globalAlpha = IN;
      ctx.fillStyle = e > 0.02 ? `rgba(${LIME},${0.2 + 0.8 * e})` : "rgba(6,10,20,.8)";
      ctx.fillRect(x - sw / 2, y - h * 0.28, sw, h * 0.56);
      if (e > 0.05) {
        ctx.globalCompositeOperation = "lighter";
        ctx.globalAlpha = IN * e;
        const gs = 15 * kk;
        ctx.drawImage(this.glow, x - gs, y - gs, gs * 2, gs * 2);
        ctx.globalCompositeOperation = "source-over";
      }
    }
    ctx.globalAlpha = this.f.IN;
  }
  /* ------------------------------ drawing: traffic ------------------------------ */
  /**
   * Draw one vehicle that is on the climb. `idx` is a stable per-vehicle index (for edge detection).
   * `vis0` is the brightness the vehicle had on the ground at the bend, so the hand-off is seamless.
   */
  drawHead(ctx, idx, lane, x, vis0, gCool, gLime) {
    const f = this.f;
    if (f.small) ctx = this.mobileFrontCtx;
    const st = this.strands[lane.i + 1];
    if (!st) return;
    const kk = this.kk;
    const headScale = f.small ? 1.2 : 1;
    const IN = f.IN * this.gain;
    const s = this.shape(x);
    const q = s * st.Q;
    this.pointAt(st, q, this.out);
    const hx = this.out.x;
    const hy = this.out.y;
    if (hy < f.top - 40) return;
    const vTop = st.Q * this.shapeSlope(1) / this.Ta;
    const v = st.Q * this.shapeSlope(x) / this.Ta;
    const sp = clamp(v / vTop, 0, 1);
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
    const sig = 0.7 * Math.max(0.02, this.shape(Math.min(1, x + 0.08)) - s);
    for (let k = 0; k < this.ringS.length; k++) {
      const dq = (this.ringS[k] - s) / Math.max(4e-3, sig);
      const e = Math.exp(-dq * dq) * (0.6 + 0.4 * sp);
      if (e > this.heat[k]) this.heat[k] = e;
    }
    const bright = (vis0 + (1 - vis0) * ss(0, 0.3, x)) * ss(0, 0.04, x + 0.04) * ss(f.top - 30, f.top + 60, hy);
    const colr = lane.lime ? LIME : "190,208,240";
    const Ltr = clamp(v * 0.19, 10, 260) * kk;
    const NT = 7;
    const tx = this.trX;
    const ty = this.trY;
    for (let j = 0; j <= NT; j++) {
      this.pointAt(st, q - Ltr * j / NT, this.out);
      tx[j] = this.out.x;
      ty[j] = this.out.y;
    }
    if (Math.abs(ty[0] - ty[NT]) > 0.5 || Math.abs(tx[0] - tx[NT]) > 0.5) {
      const g = ctx.createLinearGradient(tx[0], ty[0], tx[NT], ty[NT]);
      g.addColorStop(0, `rgba(${colr},${0.9 * bright})`);
      g.addColorStop(0.35, `rgba(${colr},${0.4 * bright})`);
      g.addColorStop(1, `rgba(${colr},0)`);
      ctx.globalCompositeOperation = "lighter";
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      ctx.moveTo(tx[0], ty[0]);
      for (let j = 1; j <= NT; j++) ctx.lineTo(tx[j], ty[j]);
      ctx.strokeStyle = g;
      ctx.globalAlpha = IN * 0.36;
      ctx.lineWidth = (4.6 + 3.4 * sp) * kk;
      ctx.stroke();
      ctx.globalAlpha = IN;
      ctx.lineWidth = (1.7 + 1.1 * sp) * kk;
      ctx.stroke();
    }
    const gs = (9 + 14 * sp) * kk * headScale;
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = IN * bright * (0.7 + 0.3 * sp);
    ctx.drawImage(lane.lime ? gLime : gCool, hx - gs, hy - gs, gs * 2, gs * 2);
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = IN * bright;
    ctx.fillStyle = "#F4F8FF";
    ctx.beginPath();
    ctx.arc(hx, hy, (1.1 + 1.2 * sp) * kk * headScale, 0, 6.2832);
    ctx.fill();
    const l0 = this.strands[0];
    const r0 = this.strands[this.strands.length - 1];
    this.pointAt(l0, s * l0.Q, this.out);
    const lx = this.out.x;
    const ly = this.out.y;
    this.pointAt(r0, s * r0.Q, this.out);
    const rx = this.out.x;
    const ry = this.out.y;
    ctx.globalCompositeOperation = "lighter";
    const spill = (14 + 10 * sp) * kk;
    ctx.globalAlpha = IN * bright * 0.2 * ss(0.12, 0.5, x);
    ctx.drawImage(this.glow, lx - spill, ly - spill, spill * 2, spill * 2);
    ctx.drawImage(this.glow, rx - spill, ry - spill, spill * 2, spill * 2);
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = f.IN;
  }
  /** Draw a ground-phase vehicle on the mobile straight approach, fading in from its start. */
  drawApproach(ctx, lane, u, gCool, gLime) {
    const f = this.f;
    const st = this.strands[lane.i + 1];
    if (!f.small || !st) return;
    ctx = this.mobileFrontCtx;
    const progress = clamp(u / this.ub, 0, 1);
    const fade = ss(0, 0.25, progress);
    if (fade <= 0) return;
    const startY = st.gy[0];
    const IN = f.IN * this.gain;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, f.W, startY);
    ctx.clip();
    for (let j = 0; j <= 7; j++) {
      const p = clamp(progress - 0.16 * j / 7, 0, 1);
      this.approachPoint(st, p);
      this.trX[j] = this.out.x;
      this.trY[j] = this.out.y;
    }
    const x = this.trX[0];
    const y = this.trY[0];
    const colour = lane.lime ? LIME : "190,208,240";
    const trail = ctx.createLinearGradient(x, y, this.trX[7], this.trY[7]);
    trail.addColorStop(0, `rgba(${colour},.72)`);
    trail.addColorStop(0.35, `rgba(${colour},.34)`);
    trail.addColorStop(1, `rgba(${colour},0)`);
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = IN * fade;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(this.trX[0], this.trY[0]);
    for (let j = 1; j <= 7; j++) ctx.lineTo(this.trX[j], this.trY[j]);
    ctx.strokeStyle = trail;
    ctx.lineWidth = 2.2;
    ctx.stroke();
    const gs = 10.8;
    ctx.globalAlpha = IN * fade * 0.72;
    ctx.drawImage(lane.lime ? gLime : gCool, x - gs, y - gs, gs * 2, gs * 2);
    ctx.globalAlpha = IN * fade;
    ctx.fillStyle = "#F4F8FF";
    ctx.beginPath();
    ctx.arc(x, y, 2.1, 0, 6.2832);
    ctx.fill();
    ctx.globalCompositeOperation = "source-over";
    ctx.restore();
  }
  approachPoint(st, progress) {
    const q = progress * (NG - 1);
    const i = Math.min(NG - 2, Math.floor(q));
    const t = q - i;
    this.out.x = st.gx[i] + (st.gx[i + 1] - st.gx[i]) * t;
    this.out.y = st.gy[i] + (st.gy[i + 1] - st.gy[i]) * t;
  }
  /** Front layer: front hoop arcs and clamps, exit glow, sparks. Call after all vehicles. */
  drawFront(ctx) {
    const f = this.f;
    if (!f || this.strands.length === 0) return;
    const target = ctx;
    if (f.small) ctx = this.mobileFrontCtx;
    const IN = f.IN * this.gain;
    this.drawRings(ctx, IN, true);
    const e = 0.04 + 0.4 * this.exitHeat;
    const kk = this.kk;
    const rw = this.ringHalf * 3;
    const rh = 120 * kk;
    ctx.globalCompositeOperation = "lighter";
    ctx.save();
    ctx.translate(this.cx, Math.max(f.top, 0) + 26 * kk);
    ctx.scale(1, rh / rw);
    ctx.globalAlpha = IN * e * 0.5;
    ctx.drawImage(this.glow, -rw, -rw, rw * 2, rw * 2);
    ctx.restore();
    if (this.sparkN > 0) {
      ctx.fillStyle = `rgb(${LIME})`;
      for (let i = 0; i < MAX_SPARKS; i++) {
        const l = this.spL[i];
        if (l <= 0) continue;
        ctx.globalAlpha = IN * clamp(l * 1.8, 0, 1) * 0.85;
        ctx.fillRect(this.spX[i] - 0.7, this.spY[i] - 0.7, 1.4, 1.4);
      }
    }
    ctx.globalAlpha = f.IN;
    ctx.globalCompositeOperation = "source-over";
    if (f.small) this.compositeMobileLayer(target, this.mobileFrontCanvas, ctx, this.mobileFrontMask);
  }
  /* ------------------------------ sparks ------------------------------ */
  spawn(x, y, st) {
    const kk = this.kk;
    for (let n = 0; n < 2; n++) {
      let slot = -1;
      for (let i = 0; i < MAX_SPARKS; i++) {
        if (this.spL[i] <= 0) {
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
  }
  stepSparks(dt) {
    if (this.sparkN === 0) return;
    let alive = 0;
    for (let i = 0; i < MAX_SPARKS; i++) {
      if (this.spL[i] <= 0) continue;
      this.spL[i] -= dt;
      this.spX[i] += this.spVX[i] * dt;
      this.spY[i] += this.spVY[i] * dt;
      this.spVX[i] *= Math.exp(-dt * 2.5);
      this.spVY[i] *= Math.exp(-dt * 1.2);
      if (this.spL[i] > 0) alive++;
    }
    if (alive === 0) this.sparkN = 0;
  }
  /* ------------------------------ sprites ------------------------------ */
  radial(rgb) {
    const size = 64;
    const c = this.mk();
    c.width = c.height = size;
    const g = c.getContext("2d");
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
  makeColumn() {
    const w = 96;
    const h = 256;
    const c = this.mk();
    c.width = w;
    c.height = h;
    const g = c.getContext("2d");
    if (!g) return c;
    const v = g.createLinearGradient(0, 0, 0, h);
    v.addColorStop(0, `rgba(${LIME},.25)`);
    v.addColorStop(0.7, `rgba(${LIME},.12)`);
    v.addColorStop(1, `rgba(${LIME},0)`);
    g.fillStyle = v;
    g.fillRect(0, 0, w, h);
    g.globalCompositeOperation = "destination-in";
    const hz = g.createLinearGradient(0, 0, w, 0);
    hz.addColorStop(0, "rgba(0,0,0,0)");
    hz.addColorStop(0.5, "rgba(0,0,0,1)");
    hz.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = hz;
    g.fillRect(0, 0, w, h);
    return c;
  }
};

// src/scene.ts
var CONFIG = {
  /** RGB triplets (no alpha) used throughout. */
  lime: "200,237,115",
  cool: "170,190,228",
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
  alertLabel: "Zone exit",
  /** Channel numbers printed on the dial face. Off by default: the scene carries no text. */
  dialNumerals: false
};
var { lime: LIME2, cool: COOL2 } = CONFIG;
var AMBER = "255,176,32";
var LIME_SOLID = "rgba(200,237,115,1)";
var REPORT_SOLID = "rgba(143,163,199,1)";
var ALERT = { exit: 1.3, open: 1.5, openDur: 0.55, close: 3.9, closeDur: 0.5, end: 4.8, zoneHalfWidth: 0.9 };
var DMIN = CONFIG.dMin;
var DMAX = CONFIG.dMax;
var DF = CONFIG.dialFront;
var DB = CONFIG.dialBack;
var MAX_DPR = 1.5;
var MAX_CANVAS_PIXELS = 12e6;
var LR = Math.log(DMAX / DMIN);
var UF = Math.log(DF / DMIN) / LR;
function comparePlacedByDepth(a, b) {
  return b.d - a.d;
}
var clamp2 = (v, a, b) => Math.min(b, Math.max(a, v));
var ss2 = (a, b, x) => {
  const k = clamp2((x - a) / (b - a), 0, 1);
  return k * k * (3 - 2 * k);
};
var hash2 = (a, b) => {
  const h = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return h - Math.floor(h);
};
var dOf = (u) => DMIN * Math.exp(u * LR);
var inSlab = (d) => d > DF - 0.02 && d < DB + 0.1;
var mixCol = (I, a) => `rgba(${Math.round(214 + (182 - 214) * I)},${Math.round(224 + (242 - 224) * I)},${Math.round(245 + (60 - 245) * I)},${a})`;
function getCenteredDialGeometry(width, span) {
  const worldHalfWidth = width * 0.47 * 1.6 / (span * 1.1);
  const edgePadding = Math.min(0.3, worldHalfWidth * 0.25);
  return { laneHalfWidth: worldHalfWidth - edgePadding, edgePadding };
}
function roundRect(c, x, y, w, h, r) {
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
var HeroScene = class {
  constructor(canvas, opts = {}) {
    this.phased = false;
    this.ast = { ascending: false, u: 0, x: 0 };
    this.W = 0;
    this.H = 0;
    this.dpr = 1;
    this.small = false;
    this.VX = 0;
    this.VY = 0;
    this.F = 0;
    this.Fe = 0;
    this.centerBlend = 0;
    this.zc = 0;
    this.zh = 0;
    this.pad = 0;
    this.copyTop = 0;
    this.copyBottom = 0;
    this.hg = 0;
    this.cz = 0;
    this.ch = 1.6;
    this.px = 0;
    this.py = 0;
    this.ps = 1;
    this.atmosphereHorizon = null;
    this.lanes = [];
    this.agents = [];
    this.placed = [];
    this.trailX = new Float32Array(18);
    this.trailY = new Float32Array(18);
    this.trailAlpha = new Float32Array(18);
    this.trailWidth = new Float32Array(18);
    this.trailVisible = new Uint8Array(18);
    this.bokeh = [];
    this.alert = null;
    this.nextAlert = null;
    this.ptr = { x: 0, y: 0, tx: 0, ty: 0, on: false, k: 0, touch: false };
    this.scroll = 0;
    this.cntDirty = true;
    this.T = 0;
    this.el = 0;
    this.IN = 1;
    this.lastT = 0;
    this.R = 140;
    this.N = 14;
    const ctx = canvas.getContext("2d", { desynchronized: true });
    if (!ctx) throw new Error("HeroScene: 2D canvas is unavailable");
    this.canvas = canvas;
    this.ctx = ctx;
    this.mk = opts.makeCanvas ?? (() => document.createElement("canvas"));
    this.off = this.mk();
    const o = this.off.getContext("2d", { desynchronized: true });
    if (!o) throw new Error("HeroScene: offscreen 2D canvas is unavailable");
    this.octx = o;
    this.rm = !!opts.reducedMotion;
    this.cnt = this.rm ? [42, 17, 9] : [0, 0, 0];
    this.onCounters = opts.onCounters;
    this.onAnchors = opts.onAnchors;
    this.gLime = this.radial(LIME2);
    this.gCool = this.radial(COOL2);
    this.gAmber = this.radial(AMBER);
    this.beam = this.makeBeam();
    this.curtain = this.makeCurtain();
    this.asc = new Ascent({ dMin: DMIN, dMax: DMAX, dialBack: DB, makeCanvas: this.mk, config: opts.ascent });
    this.af = {
      W: 0,
      H: 0,
      VX: 0,
      VY: 0,
      F: 0,
      Fe: 0,
      T: 0,
      IN: 1,
      dt: 0,
      small: false,
      scroll: 0,
      rm: this.rm,
      top: -30,
      proj: (z, y, d, o2) => {
        const s = this.Fe / d;
        o2.x = this.VX + (z - this.cz) * s;
        o2.y = this.VY + (this.ch - y) * s;
        o2.s = s;
      },
      laneZ: (l, d) => this.laneZ(l, d, this.T)
    };
  }
  /* ------------------------------ public API ------------------------------ */
  resize(w, h, dpr, layout) {
    this.W = w;
    this.H = h;
    const pixelRatioLimit = Math.sqrt(MAX_CANVAS_PIXELS / Math.max(1, w * h));
    this.dpr = Math.min(dpr || 1, MAX_DPR, pixelRatioLimit);
    this.copyTop = layout?.copyTop ?? h * 0.17;
    this.copyBottom = layout?.topInset ?? h * 0.52;
    this.canvas.width = Math.max(2, Math.round(w * this.dpr));
    this.canvas.height = Math.max(2, Math.round(h * this.dpr));
    this.off.width = Math.max(2, Math.round(w * this.dpr));
    this.off.height = Math.max(2, Math.round(Math.max(170, h * 0.3) * this.dpr));
    this.small = w < 820;
    if (this.small) {
      this.alert = null;
      this.nextAlert = null;
    }
    this.centerBlend = 1 - ss2(960, 1200, w);
    if (this.small) {
      const top = layout?.topInset ?? h * 0.54;
      const bottom = layout?.bottomInset ?? 118;
      this.VX = w * 0.5;
      this.VY = clamp2(top + 14, h * 0.38, h * 0.64);
      const span = Math.max(140, h - bottom - this.VY);
      this.F = span * DF / 1.6;
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
      const span = 1.6 * this.F / DF;
      const dial = getCenteredDialGeometry(w, span);
      this.pad = dial.edgePadding * this.centerBlend + 0.6 * (1 - this.centerBlend);
      this.zh = dial.laneHalfWidth * this.centerBlend + 2.3 * (1 - this.centerBlend);
      this.hg = 1.7;
    }
    const n = this.small ? 5 : 13;
    const per = 3;
    this.lanes = Array.from({ length: n }, (_, i) => {
      const v = i / (n - 1) * 2 - 1;
      return { i, v, z0: this.zc + v * this.zh, lime: i % 3 === 0, lit: 0, litE: 0 };
    });
    this.asc.setLanes(this.lanes, this.zh, this.pad);
    this.phased = false;
    this.agents = [];
    for (const lane of this.lanes) {
      for (let k = 0; k < per; k++) {
        this.agents.push({
          lane,
          u: (k + hash2(lane.i, k)) / per,
          sp: 0.054,
          // one shared rate keeps launches evenly spread for as long as the page is open
          seed: lane.i * 31 + k * 7,
          pf: null
        });
      }
    }
    this.bokeh = this.small ? [] : Array.from({ length: 9 }, (_, i) => ({
      z: this.zc + (hash2(i, 1) - 0.5) * 6,
      y: 0.2 + hash2(i, 2) * 1.1,
      d: 1.3 + hash2(i, 3) * 0.6,
      r: 0.1 + hash2(i, 4) * 0.12,
      ph: hash2(i, 5) * 6.28
    }));
    this.atmosphereHorizon = this.ctx.createLinearGradient(this.VX - this.W * 0.35, 0, this.VX + this.W * 0.35, 0);
    this.atmosphereHorizon.addColorStop(0, `rgba(${COOL2},0)`);
    this.atmosphereHorizon.addColorStop(0.5, `rgba(${COOL2},.18)`);
    this.atmosphereHorizon.addColorStop(1, `rgba(${COOL2},0)`);
    this.placed = this.agents.map((a, i) => ({ a, u: 0, d: 0, asc: false, x: 0, i }));
    this.onAnchors?.({
      horizonY: this.VY,
      dialCenterX: this.VX + this.zc * this.F / DF,
      dialHalfWidth: (this.zh + this.pad) * this.F * 1.1 / DF
    });
  }
  /**
   * Pointer position in hero-local CSS pixels. Ignored in reduced-motion mode.
   * Touch input lights the dial and clears noise under the finger but never moves the camera.
   */
  setPointer(x, y, on, touch = false) {
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
  setScroll(p) {
    this.scroll = this.rm ? 0 : clamp2(p, 0, 1);
  }
  setReducedMotion(rm) {
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
  destroy() {
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
  render(el) {
    if (!this.W || !this.H) return;
    const { ctx } = this;
    const rm = this.rm;
    const t = rm ? 9 : el + 5;
    const dt = clamp2(t - this.lastT, 0, 0.1);
    this.lastT = t;
    this.T = t;
    this.el = rm ? 9 : el;
    this.IN = rm ? 1 : ss2(0, 1.5, this.el);
    this.Fe = this.F * (rm ? 1 : 1 + 0.1 * (1 - ss2(0, 3, this.el)) + (this.small ? 0 : 0.35 * this.scroll * (1 - this.centerBlend)));
    const p = this.ptr;
    p.x += (p.tx - p.x) * 0.14;
    p.y += (p.ty - p.y) * 0.14;
    p.k += ((p.on ? 1 : 0) - p.k) * 0.08;
    const drift = rm ? 0 : 1;
    const push = p.touch ? 0 : 1;
    if (this.small) {
      this.cz = 0;
      this.ch = 1.6;
    } else {
      this.cz = ((p.x / this.W - 0.5) * 0.28 * p.k * push + Math.sin(t * 0.1) * 0.1 * drift) * (1 - this.centerBlend);
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
    ctx.globalCompositeOperation = "source-over";
    if (!this.small) this.drawAtmosphere();
    const af = this.af;
    af.W = this.W;
    af.H = this.H;
    af.VX = this.VX;
    af.VY = this.VY;
    af.F = this.F;
    af.Fe = this.Fe;
    af.T = this.T;
    af.IN = this.IN;
    af.dt = rm ? 0 : dt;
    af.small = this.small;
    af.scroll = this.scroll;
    af.rm = rm;
    af.top = -30;
    af.dpr = this.dpr;
    af.copyTop = this.copyTop;
    af.copyBottom = this.copyBottom;
    this.asc.frame(af);
    if (!this.phased) {
      this.asc.stratify(this.agents);
      this.phased = true;
    }
    this.asc.drawBack(ctx, this.lanes);
    for (let i = 0; i < this.agents.length; i++) {
      const a = this.agents[i];
      const st = this.ast;
      this.asc.state(a.u, a.sp, t, st);
      const placed = this.placed[i];
      placed.a = a;
      placed.u = st.u;
      placed.asc = st.ascending;
      placed.x = st.x;
      placed.d = st.ascending ? 1e6 : dOf(st.u);
    }
    const list = this.placed;
    list.sort(comparePlacedByDepth);
    if (!this.small) {
      for (const o of list) {
        const a = o.a;
        if (!rm && this.el > 1.5 && a.pf !== null && a.pf < UF && o.u >= UF) this.touch(a);
        a.pf = o.u;
      }
    }
    if (this.small) {
      for (const o of list) this.drawAgent(o);
    } else {
      this.updateAlert(list);
      this.drawAlertGround();
      for (const o of list) if (o.d > DB) this.drawAgent(o);
      this.drawDial();
      for (const o of list) if (o.d <= DB) this.drawAgent(o);
    }
    this.asc.drawFront(ctx);
    if (!this.small) this.drawAlertOverlay();
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    if (this.cntDirty && !this.small) {
      this.cntDirty = false;
      this.onCounters?.([this.cnt[0], this.cnt[1], this.cnt[2]]);
    }
  }
  /* ------------------------------ internals ------------------------------ */
  proj(z, y, d) {
    const s = this.Fe / d;
    this.px = this.VX + (z - this.cz) * s;
    this.py = this.VY + (this.ch - y) * s;
    this.ps = s;
  }
  laneZ(l, d, t) {
    const far = ss2(DB, DMAX * 0.6, d);
    const wob = d < DF ? 1.5 * (1 - ss2(DF - 1.6, DF, d)) : d < DB ? 0 : 0.3 * ss2(DB, DB + 5, d);
    const w = Math.sin(d * 0.55 + l.i * 1.7 + t * 0.3) * 0.07 + Math.sin(d * 0.23 - l.i + t * 0.18) * 0.12;
    return this.zc + l.v * this.zh * (1 - 0.32 * far) + w * wob * (0.4 + 0.6 * ss2(1.5, 8, d));
  }
  touch(a) {
    a.lane.lit = 1;
    this.cnt[0] += 1 + (Math.random() < 0.4 ? 1 : 0);
    this.cnt[1] += Math.random() < 0.6 ? 1 : 0;
    this.cnt[2] += Math.random() < 0.3 ? 1 : 0;
    this.cntDirty = true;
  }
  radial(rgb) {
    const size = 64;
    const c = this.mk();
    c.width = c.height = size;
    const g = c.getContext("2d");
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
  makeBeam() {
    const w = 48;
    const h = 160;
    const c = this.mk();
    c.width = w;
    c.height = h;
    const g = c.getContext("2d");
    if (!g) return c;
    const v = g.createLinearGradient(0, 0, 0, h);
    v.addColorStop(0, `rgba(${LIME2},0)`);
    v.addColorStop(0.5, `rgba(${LIME2},.16)`);
    v.addColorStop(1, `rgba(${LIME2},.85)`);
    g.fillStyle = v;
    g.fillRect(0, 0, w, h);
    g.globalCompositeOperation = "destination-in";
    const hz = g.createLinearGradient(0, 0, w, 0);
    hz.addColorStop(0, "rgba(0,0,0,0)");
    hz.addColorStop(0.5, "rgba(0,0,0,1)");
    hz.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = hz;
    g.fillRect(0, 0, w, h);
    return c;
  }
  /** Very faint light curtain rising across the full dial. */
  makeCurtain() {
    const w = 256;
    const h = 128;
    const c = this.mk();
    c.width = w;
    c.height = h;
    const g = c.getContext("2d");
    if (!g) return c;
    const v = g.createLinearGradient(0, 0, 0, h);
    v.addColorStop(0, `rgba(${LIME2},0)`);
    v.addColorStop(1, `rgba(${LIME2},.16)`);
    g.fillStyle = v;
    g.fillRect(0, 0, w, h);
    g.globalCompositeOperation = "destination-in";
    const hz = g.createLinearGradient(0, 0, w, 0);
    hz.addColorStop(0, "rgba(0,0,0,0)");
    hz.addColorStop(0.2, "rgba(0,0,0,1)");
    hz.addColorStop(0.8, "rgba(0,0,0,1)");
    hz.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = hz;
    g.fillRect(0, 0, w, h);
    return c;
  }
  drawAtmosphere() {
    const { ctx, VX, VY, W } = this;
    if (this.atmosphereHorizon) ctx.strokeStyle = this.atmosphereHorizon;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(VX - W * 0.35, VY);
    ctx.lineTo(VX + W * 0.35, VY);
    ctx.stroke();
    ctx.globalCompositeOperation = "lighter";
    for (const b of this.bokeh) {
      this.proj(b.z + Math.sin(this.T * 0.08 + b.ph) * 0.25, b.y + Math.cos(this.T * 0.06 + b.ph) * 0.1, b.d);
      const r = b.r * this.ps;
      ctx.globalAlpha = this.IN * 0.05;
      ctx.drawImage(this.gCool, this.px - r, this.py - r, r * 2, r * 2);
    }
    ctx.globalAlpha = this.IN;
    ctx.globalCompositeOperation = "source-over";
  }
  /**
   * The signal dial: a thick glass-and-metal slab spanning every lane.
   * Drawn into an offscreen buffer so its ends can be darkened and faded
   * to transparent, then composited. Light spill is added afterwards.
   */
  drawDial() {
    const { ctx, octx, dpr, lanes } = this;
    const el = this.el;
    const rm = this.rm;
    const s = this.Fe / DF;
    const zL = this.zc - this.zh - this.pad;
    const zR = this.zc + this.zh + this.pad;
    const DHe = CONFIG.dialHeight * (rm ? 1 : ss2(0.3, 1.4, el));
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
    ctx.save();
    ctx.translate((x0 + x1) / 2, yB + 3);
    ctx.scale(fw * 0.54, Math.max(6, s * 0.2));
    const sh = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    sh.addColorStop(0, "rgba(0,0,0,.7)");
    sh.addColorStop(1, "rgba(0,0,0,0)");
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = this.IN;
    ctx.fillStyle = sh;
    ctx.fillRect(-1, -1, 2, 2);
    ctx.restore();
    const dz = 2 * this.zh / (lanes.length - 1);
    const sxOf = (z) => this.VX + (z - this.cz) * s;
    const sigma = dz * s * 0.55;
    const ptr = this.ptr;
    const pf = ptr.k * ss2(yT - 70, yT - 10, ptr.y) * (1 - ss2(yB + 10, yB + 70, ptr.y));
    const boot = (x) => {
      if (rm || el < 1 || el > 3) return 0;
      const bx = x0 + fw * (0.1 + 0.8 * ss2(1, 2.6, el));
      const q = (x - bx) / (fw * 0.05);
      return Math.exp(-q * q) * (1 - ss2(2.4, 3, el));
    };
    const hov = (x) => {
      const q = (x - ptr.x) / (sigma * 1.1);
      return pf * 0.85 * Math.exp(-q * q);
    };
    for (const l of lanes) {
      const x = sxOf(l.z0);
      l.litE = clamp2(l.lit + boot(x) + hov(x), 0, 1.25);
    }
    const litAt = (x) => {
      let v = Math.max(boot(x), hov(x));
      for (const l of lanes) {
        const q = (x - sxOf(l.z0)) / sigma;
        v = Math.max(v, l.lit * Math.exp(-q * q));
      }
      return Math.min(v, 1.2);
    };
    const ox = Math.floor(x0 - 10);
    const oy = Math.floor(byT - 16);
    const ow = Math.min(Math.ceil(fw + 20), Math.floor(this.off.width / dpr));
    const oh = Math.min(Math.ceil(yB - byT + 34), Math.floor(this.off.height / dpr));
    octx.setTransform(1, 0, 0, 1, 0, 0);
    octx.clearRect(0, 0, this.off.width, this.off.height);
    octx.setTransform(dpr, 0, 0, dpr, -ox * dpr, -oy * dpr);
    octx.globalCompositeOperation = "source-over";
    octx.globalAlpha = 1;
    let g = octx.createLinearGradient(0, yT, 0, yB);
    g.addColorStop(0, "rgba(46,58,86,.97)");
    g.addColorStop(0.12, "rgba(27,36,58,.96)");
    g.addColorStop(0.7, "rgba(13,19,34,.97)");
    g.addColorStop(1, "rgba(7,10,20,.98)");
    octx.fillStyle = g;
    octx.fillRect(x0, yT, fw, fh);
    g = octx.createLinearGradient(0, byT, 0, yT);
    g.addColorStop(0, "rgba(58,70,100,.95)");
    g.addColorStop(1, this.small ? "rgba(82,96,128,.94)" : "rgba(104,120,154,.92)");
    octx.fillStyle = g;
    octx.beginPath();
    octx.moveTo(x0, yT);
    octx.lineTo(x1, yT);
    octx.lineTo(bx1, byT);
    octx.lineTo(bx0, byT);
    octx.closePath();
    octx.fill();
    g = octx.createLinearGradient(x0, 0, x1, 0);
    g.addColorStop(0, "rgba(255,255,255,0)");
    const sheen = this.small ? 0.55 : 1;
    g.addColorStop(0.28, `rgba(255,255,255,${0.16 * sheen})`);
    g.addColorStop(0.42, "rgba(255,255,255,0)");
    g.addColorStop(0.66, `rgba(255,255,255,${0.1 * sheen})`);
    g.addColorStop(0.8, "rgba(255,255,255,0)");
    octx.fillStyle = g;
    octx.fill();
    octx.strokeStyle = "rgba(255,255,255,.42)";
    octx.lineWidth = 1;
    octx.beginPath();
    octx.moveTo(x0, yT + 0.5);
    octx.lineTo(x1, yT + 0.5);
    octx.stroke();
    octx.strokeStyle = "rgba(0,0,0,.45)";
    octx.beginPath();
    octx.moveTo(bx0, byT);
    octx.lineTo(bx1, byT);
    octx.stroke();
    octx.strokeStyle = "rgba(0,0,0,.7)";
    octx.beginPath();
    octx.moveTo(x0, yB - 0.5);
    octx.lineTo(x1, yB - 0.5);
    octx.stroke();
    const wx0 = x0 + 12;
    const wy0 = yT + fh * 0.1;
    const ww = fw - 24;
    const wh = fh * 0.8;
    g = octx.createLinearGradient(0, wy0, 0, wy0 + wh);
    g.addColorStop(0, "rgba(130,160,215,.13)");
    g.addColorStop(1, "rgba(90,120,170,.03)");
    octx.fillStyle = g;
    roundRect(octx, wx0, wy0, ww, wh, 6);
    octx.fill();
    octx.strokeStyle = "rgba(255,255,255,.09)";
    octx.stroke();
    g = octx.createLinearGradient(0, wy0, 0, wy0 + 12);
    g.addColorStop(0, "rgba(0,0,0,.5)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    octx.fillStyle = g;
    octx.fillRect(wx0 + 1, wy0 + 1, ww - 2, 12);
    const n = lanes.length;
    const minor = this.small ? 3 : 4;
    const step = dz / (minor + 1);
    const yBase = wy0 + wh - 5;
    octx.strokeStyle = "rgba(255,255,255,.12)";
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
      const I = clamp2(litAt(x), 0, 1);
      const th = wh * (major ? 0.24 : 0.13) * (1 + 0.5 * I);
      const lw = (major ? 1.4 : 1) * (1 + 1.5 * I) * (this.small ? 0.8 : 1);
      octx.lineWidth = lw;
      octx.strokeStyle = "rgba(0,0,0,.6)";
      octx.beginPath();
      octx.moveTo(x, yBase + 1);
      octx.lineTo(x, yBase + 1 - th);
      octx.stroke();
      octx.globalAlpha = (major ? 0.5 : 0.3) + 0.7 * I;
      octx.strokeStyle = "rgba(214,224,245,1)";
      octx.beginPath();
      octx.moveTo(x, yBase);
      octx.lineTo(x, yBase - th);
      octx.stroke();
      octx.globalAlpha = 1;
      if (I > 0.2) {
        octx.globalCompositeOperation = "lighter";
        octx.lineWidth = lw * 4;
        octx.globalAlpha = 0.16 * I;
        octx.strokeStyle = LIME_SOLID;
        octx.beginPath();
        octx.moveTo(x, yBase);
        octx.lineTo(x, yBase - th);
        octx.stroke();
        octx.globalAlpha = 1;
        octx.globalCompositeOperation = "source-over";
      }
    }
    const cy = wy0 + wh * 0.45;
    const ph = wh * 0.3;
    const gp = octx.createLinearGradient(0, cy - ph / 2, 0, cy + ph / 2);
    gp.addColorStop(0, "rgba(34,44,66,.95)");
    gp.addColorStop(1, "rgba(16,22,38,.95)");
    octx.textAlign = "center";
    octx.font = `500 ${clamp2(s * 0.052, 8, 10)}px "JetBrains Mono", ui-monospace, Menlo, monospace`;
    for (const l of lanes) {
      const x = sxOf(l.z0);
      const Ic = Math.min(1, l.litE);
      const pw = Math.max(4.5, s * (this.small ? 0.075 : 0.05)) * (1 + 0.55 * Ic);
      octx.fillStyle = "rgba(0,0,0,.55)";
      roundRect(octx, x - pw / 2 - 1.5, cy - ph / 2 - 1.5, pw + 3, ph + 3, 3);
      octx.fill();
      octx.fillStyle = gp;
      roundRect(octx, x - pw / 2, cy - ph / 2, pw, ph, 2.5);
      octx.fill();
      if (Ic > 0.02) {
        octx.fillStyle = `rgba(${LIME2},${0.15 + 0.8 * Ic})`;
        roundRect(octx, x - pw / 2, cy - ph / 2, pw, ph, 2.5);
        octx.fill();
        octx.fillStyle = `rgba(245,255,210,${0.9 * Ic})`;
        octx.fillRect(x - 0.6, cy - ph / 2 + 2, 1.2, ph - 4);
        octx.globalCompositeOperation = "lighter";
        octx.globalAlpha = Ic;
        const gw = ph * 2.6;
        octx.drawImage(this.gLime, x - gw / 2, cy - gw / 2, gw, gw);
        octx.save();
        octx.translate(x, yT - (yT - byT) * 0.45);
        octx.scale(1, 0.3);
        octx.drawImage(this.gLime, -pw * 2.4, -pw * 2.4, pw * 4.8, pw * 4.8);
        octx.restore();
        octx.globalAlpha = 1;
        octx.globalCompositeOperation = "source-over";
      }
      if (CONFIG.dialNumerals && !this.small) {
        octx.fillStyle = mixCol(Ic, 0.38 + 0.55 * Ic);
        octx.fillText(String(l.i + 1).padStart(2, "0"), x, wy0 + wh * 0.2 + 3);
      }
    }
    octx.globalCompositeOperation = "source-atop";
    g = octx.createLinearGradient(x0, 0, x1, 0);
    g.addColorStop(0, "rgba(4,7,14,.75)");
    g.addColorStop(0.22, "rgba(4,7,14,0)");
    g.addColorStop(0.78, "rgba(4,7,14,0)");
    g.addColorStop(1, "rgba(4,7,14,.75)");
    octx.fillStyle = g;
    octx.fillRect(ox, oy, ow, oh);
    octx.globalCompositeOperation = "destination-in";
    g = octx.createLinearGradient(x0, 0, x1, 0);
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(0.16, "rgba(0,0,0,1)");
    g.addColorStop(0.84, "rgba(0,0,0,1)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    octx.fillStyle = g;
    octx.fillRect(ox, oy, ow, oh);
    octx.globalCompositeOperation = "source-over";
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = this.IN;
    ctx.drawImage(this.off, 0, 0, ow * dpr, oh * dpr, ox, oy, ow, oh);
    ctx.globalCompositeOperation = "lighter";
    const chh = this.hg * s * 1.15;
    ctx.globalAlpha = this.IN * 0.5;
    ctx.drawImage(this.curtain, x0, yT - chh, fw, chh);
    for (const l of lanes) {
      const I = Math.min(1, l.litE);
      if (I < 0.03) continue;
      const x = sxOf(l.z0);
      const Ib = Math.pow(I, 1.5);
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
    ctx.globalCompositeOperation = "source-over";
  }
  /** Ground brightness: eases down with distance but stays readable all the way to the bend. */
  groundVis(d) {
    return 1 - 0.5 * ss2(14, this.asc.bendDepth, d);
  }
  drawAgent(o) {
    const { ctx } = this;
    const a = o.a;
    const u = o.u;
    const d = o.d;
    const lane = a.lane;
    if (o.asc) {
      this.asc.drawHead(ctx, o.i, lane, o.x, this.groundVis(this.asc.bendDepth), this.gCool, this.gLime);
      return;
    }
    if (this.small) {
      this.asc.drawApproach(ctx, lane, u, this.gCool, this.gLime);
      return;
    }
    const vis = this.groundVis(d) * ss2(DMIN, DMIN + 0.8, d);
    if (vis < 0.01) return;
    const z = this.laneZ(lane, d, this.T);
    this.proj(z, 0.05, d);
    const x = this.px;
    const y = this.py;
    const s = this.ps;
    const hidden = inSlab(d);
    const mb = this.small ? 1.3 : 1;
    const n = 1 - ss2(DF - 1.3, DF - 0.05, d);
    const ptr = this.ptr;
    const lc = ptr.k > 0.01 ? 1 - ss2(0, this.R, Math.hypot(x - ptr.x, y - ptr.y)) : 0;
    const nn = n * (1 - ptr.k * lc);
    ctx.globalCompositeOperation = "lighter";
    if (nn > 0.03 && !hidden) {
      const st = Math.floor(this.T * 7 + a.seed * 0.37);
      const h1 = hash2(st, a.seed);
      const h2 = hash2(st, a.seed + 1);
      const h3 = hash2(st, a.seed + 2);
      const h4 = hash2(st, a.seed + 3);
      this.proj(z + (h1 - 0.5) * 0.46 * nn, 0.05 + (h2 - 0.5) * 0.2 * nn, Math.max(1.6, d + (h2 - 0.5) * 0.5 * nn));
      const nx = this.px;
      const ny = this.py;
      const rr = clamp2(0.02 * s * mb, 0.7, 5.5 * mb);
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
      const e1 = hash2(st - 1, a.seed);
      const e2 = hash2(st - 1, a.seed + 1);
      this.proj(z + (e1 - 0.5) * 0.46 * nn, 0.05 + (e2 - 0.5) * 0.2 * nn, Math.max(1.6, d + (e2 - 0.5) * 0.5 * nn));
      ctx.globalAlpha = this.IN * 0.3 * nn * vis;
      ctx.fillStyle = REPORT_SOLID;
      ctx.beginPath();
      ctx.arc(this.px, this.py, rr * 0.85, 0, 6.2832);
      ctx.fill();
      ctx.globalAlpha = this.IN;
    }
    let prevHidden = hidden;
    this.trailX[0] = x;
    this.trailY[0] = y;
    ctx.lineCap = "round";
    for (let i = 1; i <= this.N; i++) {
      const di = dOf(Math.max(0, u - i * 0.013));
      this.proj(this.laneZ(lane, di, this.T), 0.05, di);
      const tx = this.px;
      const ty = this.py;
      const hid = inSlab(di);
      let c = ss2(DF - 0.2, DF + 0.6, di);
      if (ptr.k > 0.01) c = Math.max(c, ptr.k * (1 - ss2(0, this.R, Math.hypot(tx - ptr.x, ty - ptr.y))));
      const k = 1 - i / this.N;
      const al = Math.pow(k, 1.6) * c * 0.9 * vis;
      this.trailX[i] = tx;
      this.trailY[i] = ty;
      this.trailVisible[i] = al > 0.01 && !hid && !prevHidden ? 1 : 0;
      this.trailAlpha[i] = al;
      this.trailWidth[i] = clamp2(0.035 * this.ps * k * mb + 0.5, 0.5, 3.2 * mb);
      prevHidden = hid;
    }
    for (let i = 1; i <= this.N; ) {
      if (!this.trailVisible[i]) {
        i++;
        continue;
      }
      let end = i;
      let count = 1;
      let alpha = this.trailAlpha[i];
      let width = this.trailWidth[i];
      if (i < this.N && this.trailVisible[i + 1]) {
        end++;
        count++;
        alpha += this.trailAlpha[end];
        width += this.trailWidth[end];
      }
      alpha /= count;
      width /= count;
      ctx.beginPath();
      ctx.moveTo(this.trailX[i - 1], this.trailY[i - 1]);
      for (let j = i; j <= end; j++) ctx.lineTo(this.trailX[j], this.trailY[j]);
      if (lane.lime) {
        ctx.globalAlpha = this.IN * alpha * 0.2;
        ctx.strokeStyle = LIME_SOLID;
        ctx.lineWidth = width * 3.2;
        ctx.stroke();
      }
      ctx.globalAlpha = this.IN * alpha;
      ctx.strokeStyle = lane.lime ? LIME_SOLID : "rgba(190,208,240,.8)";
      ctx.lineWidth = width;
      ctx.stroke();
      ctx.globalAlpha = this.IN;
      i = end + 1;
    }
    const ca = 1 - nn;
    if (ca > 0.03 && !hidden) {
      const gs = clamp2(0.13 * s * mb, 6, 28 * mb);
      ctx.globalAlpha = this.IN * ca * vis;
      ctx.drawImage(lane.lime ? this.gLime : this.gCool, x - gs, y - gs, gs * 2, gs * 2);
      ctx.fillStyle = "#F2F6FF";
      ctx.beginPath();
      ctx.arc(x, y, clamp2(0.022 * s * mb, 0.9, 3 * mb), 0, 6.2832);
      ctx.fill();
      ctx.globalAlpha = this.IN;
    }
    const dd = Math.abs(d - DF);
    if (dd < 0.55) {
      const fs = clamp2(0.2 * s, 10, 40);
      ctx.globalAlpha = this.IN * (1 - dd / 0.55) * 0.8 * vis;
      ctx.drawImage(this.gLime, x - fs, y - fs, fs * 2, fs * 2);
      ctx.globalAlpha = this.IN;
    }
  }
  /* ------------------------------ alert system ------------------------------ */
  /** Log-depth of a vehicle at time t (ground only; clamps to the bend while climbing). */
  stateU(a, t) {
    const st = { ascending: false, u: 0, x: 0 };
    this.asc.state(a.u, a.sp, t, st);
    return st.u;
  }
  startAlert(a, t0) {
    const dC = dOf(this.stateU(a, t0 + 0.35));
    const Rd = dOf(this.stateU(a, t0 + ALERT.exit)) - dC;
    this.alert = {
      agent: a,
      t0,
      dC,
      Rd,
      zC: this.laneZ(a.lane, dC, t0),
      ax: Number.NaN,
      ay: 0
    };
  }
  updateAlert(list) {
    if (this.rm) {
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
  drawAlertGround() {
    const al = this.alert;
    if (!al) return;
    const { ctx } = this;
    const tt = this.T - al.t0;
    const za = ss2(0, 0.6, tt) * (1 - ss2(ALERT.close, ALERT.end, tt));
    if (za < 0.01) return;
    const grow = 0.7 + 0.3 * ss2(0, 0.7, tt);
    const hot = ss2(ALERT.exit - 0.05, ALERT.exit + 0.2, tt) * (1 - ss2(3.4, 4.6, tt));
    const rz = ALERT.zoneHalfWidth * grow * (this.small ? 0.75 : 1);
    const rd = al.Rd * grow;
    const trace = (a0, a1, steps) => {
      ctx.beginPath();
      for (let i = 0; i <= steps; i++) {
        const a = a0 + (a1 - a0) * i / steps;
        this.proj(al.zC + Math.cos(a) * rz, 0, al.dC + Math.sin(a) * rd);
        if (i) ctx.lineTo(this.px, this.py);
        else ctx.moveTo(this.px, this.py);
      }
    };
    ctx.globalCompositeOperation = "source-over";
    trace(0, 6.2832, 56);
    ctx.closePath();
    ctx.fillStyle = `rgba(${COOL2},${0.035 * za * (1 - hot * 0.6)})`;
    ctx.fill();
    if (hot > 0.01) {
      ctx.fillStyle = `rgba(${AMBER},${0.07 * za * hot})`;
      ctx.fill();
    }
    ctx.setLineDash([6, 6]);
    ctx.lineDashOffset = -this.T * 5;
    ctx.strokeStyle = `rgba(${COOL2},${0.34 * za * (1 - hot * 0.5)})`;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.setLineDash([]);
    if (hot > 0.01) {
      ctx.lineCap = "round";
      trace(Math.PI / 2 - 0.6, Math.PI / 2 + 0.6, 18);
      ctx.globalCompositeOperation = "lighter";
      ctx.strokeStyle = `rgba(${AMBER},${0.1 * za * hot})`;
      ctx.lineWidth = 5;
      ctx.stroke();
      ctx.globalCompositeOperation = "source-over";
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
        const a = i / 28 * 6.2832;
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
  drawAlertOverlay() {
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
    const out = 1 - ss2(ALERT.close + ALERT.closeDur * 0.6, ALERT.end, tt);
    const hot = ss2(ALERT.exit - 0.1, ALERT.exit + 0.15, tt) * out;
    const pulse = 0.8 + 0.2 * Math.sin(tt * 8);
    ctx.globalCompositeOperation = "lighter";
    const gs = clamp2(0.16 * s, 8, 22);
    ctx.globalAlpha = IN * hot * pulse * 0.8;
    ctx.drawImage(this.gAmber, x - gs, y - gs, gs * 2, gs * 2);
    ctx.globalCompositeOperation = "source-over";
    const easeOut = (k) => k >= 1 ? 1 : 1 - Math.pow(2, -10 * k);
    const ko = easeOut(clamp2((tt - ALERT.open) / ALERT.openDur, 0, 1));
    const kc = ss2(0, 1, clamp2((tt - ALERT.close) / ALERT.closeDur, 0, 1));
    const e = ko * (1 - kc);
    const h = this.small ? 20 : 22;
    const label = CONFIG.alertLabel;
    ctx.font = '500 10px "JetBrains Mono", ui-monospace, Menlo, monospace';
    const wFull = label ? 35 + ctx.measureText(label).width : h * 1.7;
    const ph = 6 + (h - 6) * ss2(0, 0.35, e);
    const w = ph + (wFull - ph) * ss2(0.25, 1, e);
    const tx = clamp2(x, w / 2 + 8, this.W - w / 2 - 8);
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
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = IN * out * (0.1 + 0.1 * e);
    const bw = w * 2.2 + 16;
    ctx.drawImage(this.gAmber, cx - bw / 2, cy - ph * 1.6, bw, ph * 3.2);
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = IN * out;
    ctx.fillStyle = `rgb(${AMBER})`;
    roundRect(ctx, x0, y0, w, ph, ph / 2);
    ctx.fill();
    const glass = ss2(0, 0.4, e);
    if (glass > 0.01) {
      const g = ctx.createLinearGradient(0, y0, 0, y0 + ph);
      g.addColorStop(0, "rgba(40,44,60,.96)");
      g.addColorStop(1, "rgba(16,18,30,.97)");
      ctx.globalAlpha = IN * out * glass;
      ctx.fillStyle = g;
      roundRect(ctx, x0, y0, w, ph, ph / 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,.14)";
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    const ta = ss2(0.85, 1, e);
    if (ta > 0.01) {
      const remain = 1 - clamp2((tt - (ALERT.open + ALERT.openDur)) / (ALERT.close - ALERT.open - ALERT.openDur), 0, 1);
      const perimeter = 2 * (w - ph) + Math.PI * ph;
      ctx.globalAlpha = IN * out * ta;
      ctx.setLineDash([perimeter * remain, perimeter]);
      ctx.strokeStyle = `rgba(${AMBER},.95)`;
      ctx.lineWidth = 1.4;
      roundRect(ctx, x0, y0, w, ph, ph / 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    if (e > 0.2) {
      ctx.save();
      roundRect(ctx, x0, y0, w, ph, ph / 2);
      ctx.clip();
      const gx = label ? x0 + 7 + 6 : cx;
      const ga = ss2(0.25, 0.55, e);
      ctx.globalAlpha = IN * out * ga;
      ctx.strokeStyle = `rgb(${AMBER})`;
      ctx.lineWidth = 1.3;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
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
        ctx.globalAlpha = IN * out * ss2(0.65, 0.95, e);
        ctx.fillStyle = "#F4F6FB";
        ctx.textAlign = "left";
        ctx.fillText(label, x0 + 7 + 12 + 6, cy + 3.5);
      }
      ctx.restore();
    }
  }
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  HeroScene,
  getCenteredDialGeometry
});

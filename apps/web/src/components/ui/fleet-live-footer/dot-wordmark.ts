/**
 * Fleet Live footer: dot wordmark engine
 * ------------------------------------------------------------------
 * Framework-free Canvas2D renderer.
 *
 * 1. The word is drawn into an offscreen canvas and sampled on a dot grid.
 *    Only the top `visibleFraction` of the last line is sampled, so the
 *    wordmark reads as a large mark peeking up from the bottom of the page.
 * 2. Every sampled dot has a scattered "home" position. Until triggered, all
 *    dots drift and shimmer there as cool, dim noise.
 * 3. Scroll drives `setProgress(0..1)`: 0 = fully scattered, 1 = fully formed.
 *    Dots settle into the word character by character as progress rises,
 *    travelling on a slight arc and warming from cool grey to the word's
 *    colour. Lowering progress scatters them again, last characters first.
 * 4. Settled dots keep a tiny jitter so the mark stays alive. A share of
 *    "stray" dots never settle: the noise that remains around the signal.
 */

export interface WordmarkOptions {
  text?: string;
  /** One CSS "r,g,b" triplet per word, cycled. Default: white, then lime. */
  colors?: string[];
  /** Fraction of the last line's cap height that is shown. Default 0.9. */
  visibleFraction?: number;
  /** CSS font-family list used to draw the word (heavy weights look best). */
  fontFamily?: string;
  reducedMotion?: boolean;
  /** Canvas factory for the offscreen sampler. Override for tests or workers. */
  makeCanvas?: () => HTMLCanvasElement;
}

/* ------------------------------ CONFIG ------------------------------ */
const CONFIG = {
  white: '238,242,250',
  lime: '184,242,60',
  cool: '143,163,199',
  fontWeight: 800,
  /** Letter spacing as a fraction of the font size. */
  tracking: -0.03,
  /** Share of extra scattered dots that never settle. */
  strayShare: 0.3,
  /** Empty scatter space above the letters, as a fraction of cap height. */
  headroom: 0.5,
  /** How much of the progress range each dot's own travel takes (bigger = softer, more overlap). */
  window: 0.38,
  /** How much of the progress range is spent staggering characters left to right. */
  order: 0.58,
  /** Extra stagger for dots inside one character. */
  inner: 0.2,
  /** Progress smoothing speed (per second). Higher follows the scroll more tightly. */
  follow: 8.5,
  /** Settled jitter in px (each axis, roughly). Keep it tiny. */
  jitter: 0.6,
  /** Smallest radius scale, reached at the crop edge. */
  cropShrink: 0.7,
  /** Where (0..1 down the visible band) the halftone fade begins. */
  fadeStart: 0.8,
};
/* -------------------------------------------------------------------- */

interface Dot {
  tx: number;
  ty: number;
  sx: number;
  sy: number;
  ph1: number;
  ph2: number;
  dl: number;
  cv: number;
  ch: number;
  c: number;
  fd: number;
  stray: boolean;
  lv: number;
  x: number;
  y: number;
  r: number;
  st: number;
  /** progress at which this dot starts to travel */
  s: number;
  /** travel amount this frame, 0..1 */
  e: number;
}

const TAU = Math.PI * 2;
const clamp = (v: number, a: number, b: number): number => Math.min(b, Math.max(a, v));
const ss = (a: number, b: number, x: number): number => {
  const k = clamp((x - a) / (b - a), 0, 1);
  return k * k * (3 - 2 * k);
};
const hash = (a: number, b: number): number => {
  const h = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return h - Math.floor(h);
};

interface LineChars {
  text: string;
  /** word index for each character */
  words: number[];
  /** global character index of the first character */
  g0: number;
}

type SpacedContext = CanvasRenderingContext2D & { letterSpacing?: string };

export class DotWordmark {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly mk: () => HTMLCanvasElement;
  private readonly sprites = new Map<string, HTMLCanvasElement>();
  private readonly off: HTMLCanvasElement;
  private readonly octx: CanvasRenderingContext2D;
  private text: string;
  private colors: string[];
  private frac: number;
  private family: string;
  private rm: boolean;

  private W = 0;
  private H = 0;
  private dpr = 1;
  private small = false;
  private r = 1.4;
  private dots: Dot[] = [];
  private inflight: Dot[] = [];
  private pad = 0;
  /** Dot field = the whole canvas (the footer). The wordmark sits at (ox, oy) inside it. */
  private fw = 0;
  private fh = 0;
  private ox = 0;
  private oy = 0;
  private cur = 0;
  private target = 0;
  private last = 0;
  private layoutDirty = true;

  constructor(canvas: HTMLCanvasElement, opts: WordmarkOptions = {}) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('DotWordmark: 2D canvas is unavailable');
    this.canvas = canvas;
    this.ctx = ctx;
    this.mk = opts.makeCanvas ?? (() => document.createElement('canvas'));
    this.off = this.mk();
    const o = this.off.getContext('2d', { willReadFrequently: true });
    if (!o) throw new Error('DotWordmark: offscreen 2D canvas is unavailable');
    this.octx = o;
    this.text = (opts.text ?? 'NO NOISE').toUpperCase();
    this.colors = opts.colors ?? [CONFIG.white, CONFIG.lime];
    this.frac = opts.visibleFraction ?? 0.9;
    this.family = opts.fontFamily ?? 'system-ui, sans-serif';
    this.rm = !!opts.reducedMotion;
  }

  /* ------------------------------ public API ------------------------------ */

  /** CSS height (px) of the canvas for the current width. */
  get height(): number {
    return this.H;
  }

  setText(text: string): void {
    const nextText = text.toUpperCase();
    if (nextText === this.text) return;
    this.text = nextText;
    this.layoutDirty = true;
    if (this.W) this.resize(this.W, this.dpr);
  }

  setFontFamily(family: string): void {
    if (family === this.family) return;
    this.family = family;
    this.layoutDirty = true;
    if (this.W) this.resize(this.W, this.dpr);
  }

  setReducedMotion(rm: boolean): void {
    this.rm = rm;
  }

  /**
   * Let the dot field cover a larger area (e.g. the whole footer) than the wordmark.
   * `ox`/`oy` is where the wordmark's top-left corner sits inside that area (CSS px).
   */
  setField(fw: number, fh: number, ox: number, oy: number): void {
    const a = Math.max(1, Math.round(fw));
    const b = Math.max(1, Math.round(fh));
    const x = Math.round(ox);
    const y = Math.round(oy);
    if (a === this.fw && b === this.fh && x === this.ox && y === this.oy) return;
    this.fw = a;
    this.fh = b;
    this.ox = x;
    this.oy = y;
    this.layoutDirty = true;
    if (this.W) this.resize(this.W, this.dpr);
  }

  /** Empty scatter space (CSS px) above the letters inside the canvas. */
  get headroom(): number {
    return this.pad;
  }

  /**
   * Scroll-linked formation: 0 = scattered, 1 = fully formed.
   * Smoothed internally; pass `immediate` to jump (e.g. while off-screen).
   */
  setProgress(p: number, immediate = false): void {
    this.target = clamp(p, 0, 1);
    if (immediate) this.cur = this.target;
  }

  /** Lay out for a CSS width. Returns the CSS height to give the canvas. */
  resize(width: number, dpr: number): number {
    const nextWidth = Math.max(1, Math.round(width));
    const nextDpr = Math.min(dpr || 1, 2);
    if (!this.layoutDirty && nextWidth === this.W && nextDpr === this.dpr) return this.H;
    if (nextDpr !== this.dpr) this.sprites.clear();
    this.W = nextWidth;
    this.dpr = nextDpr;
    this.small = this.W < 700;
    this.build();
    this.canvas.width = Math.max(2, Math.round((this.fw || this.W) * this.dpr));
    this.canvas.height = Math.max(2, Math.round((this.fh || this.H) * this.dpr));
    this.layoutDirty = false;
    return this.H;
  }

  destroy(): void {
    this.off.width = 0;
    this.off.height = 0;
    this.dots = [];
    this.sprites.clear();
  }

  /** Draw one frame. `nowMs` is a monotonic clock in milliseconds. */
  render(nowMs: number): void {
    if (!this.W || !this.H) return;
    const { ctx } = this;
    const FW = this.fw || this.W;
    const FH = this.fh || this.H;
    const rm = this.rm;
    const t = nowMs / 1000;
    const dt = this.last ? clamp(t - this.last, 0, 0.1) : 0.016;
    this.last = t;
    if (rm) {
      this.cur = 1;
    } else {
      this.cur += (this.target - this.cur) * (1 - Math.exp(-dt * CONFIG.follow));
      if (Math.abs(this.target - this.cur) < 0.0005) this.cur = this.target;
    }
    const P = this.cur;
    const A = this.small ? 3.5 : 6; // slow drift of scattered dots (px)
    const J = rm ? 0 : CONFIG.jitter;
    this.inflight.length = 0;

    for (const d of this.dots) {
      const hx = d.sx + (rm ? 0 : Math.sin(t * 0.31 + d.ph1) * A + Math.sin(t * 8.3 + d.ph2) * 0.7);
      const hy = d.sy + (rm ? 0 : Math.cos(t * 0.27 + d.ph2) * A + Math.cos(t * 7.1 + d.ph1) * 0.7);
      if (d.stray) {
        d.x = hx;
        d.y = hy;
        d.r = this.r * 0.85;
        d.st = 0;
        continue;
      }
      const e = clamp((P * (1 + CONFIG.window) - d.s) / CONFIG.window, 0, 1);
      d.e = e;
      const jx = (Math.sin(t * 9.1 + d.ph1) + Math.sin(t * 5.3 + d.ph2)) * 0.5 * J;
      const jy = (Math.sin(t * 7.7 + d.ph2) + Math.sin(t * 4.1 + d.ph1)) * 0.5 * J;
      if (e <= 0) {
        d.x = hx;
        d.y = hy;
        d.r = this.r;
        d.st = 0;
      } else if (e >= 1) {
        d.x = d.tx + jx;
        d.y = d.ty + jy;
        d.r = this.r * d.fd;
        d.st = 2;
      } else {
        const k = ss(0, 1, e);
        const dx = d.tx - hx;
        const dy = d.ty - hy;
        const L = Math.hypot(dx, dy) || 1;
        const arcProgress = 16 * e * e * (1 - e) * (1 - e);
        const arc = arcProgress * d.cv * L * 0.16;
        d.x = hx + dx * k + (-dy / L) * arc + jx * k;
        d.y = hy + dy * k + (dx / L) * arc + jy * k;
        d.r = this.r * (0.85 + 0.15 * k) * (1 - (1 - d.fd) * k);
        d.st = 1;
        this.inflight.push(d);
      }
    }

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, FW, FH);
    ctx.globalCompositeOperation = 'source-over';

    // Noise: dim strays, brighter strays, and dots still waiting for their character's turn.
    for (const d of this.dots) {
      if (d.st !== 0) continue;
      this.blit(CONFIG.cool, d.x, d.y, d.r, d.stray && d.lv === 0 ? 0.26 : 0.5);
    }

    // Signal, pass 1: a soft additive glow under every settled dot (stronger for the coloured word).
    ctx.globalCompositeOperation = 'lighter';
    for (const d of this.dots) {
      if (d.st !== 2 || d.ph1 >= TAU * 0.4) continue;
      const rgb = this.colors[d.c] ?? CONFIG.white;
      const strong = Number(rgb.split(',')[2] ?? 255) < 150;
      this.glow(rgb, d.x, d.y, d.r * 2.6, strong ? 0.2 : 0.1);
    }
    ctx.globalCompositeOperation = 'source-over';

    // Signal, pass 2: the dots themselves.
    for (const d of this.dots) {
      if (d.st !== 2) continue;
      this.blit(this.colors[d.c] ?? CONFIG.white, d.x, d.y, d.r, 1);
    }

    // Dots in flight warm from cool grey to their word colour.
    for (const d of this.inflight) {
      const m = ss(0, 0.8, d.e);
      this.blit(CONFIG.cool, d.x, d.y, d.r, (1 - m) * 0.5);
      this.blit(this.colors[d.c] ?? CONFIG.white, d.x, d.y, d.r, m);
    }
    ctx.globalAlpha = 1;
  }

  /* ------------------------------ internals ------------------------------ */

  /** A crisp dot, pre-rendered at the exact device size so drawing needs no resampling. */
  private sprite(rgb: string, devR: number): HTMLCanvasElement {
    const key = `${rgb}|${devR}`;
    const hit = this.sprites.get(key);
    if (hit) return hit;
    const size = Math.ceil(devR * 2) + 2;
    const c = this.mk();
    c.width = c.height = size;
    const g = c.getContext('2d');
    if (g) {
      g.fillStyle = `rgb(${rgb})`;
      g.beginPath();
      g.arc(size / 2, size / 2, devR, 0, TAU);
      g.fill();
    }
    this.sprites.set(key, c);
    return c;
  }

  private blit(rgb: string, x: number, y: number, r: number, alpha: number): void {
    if (alpha <= 0.01) return;
    const devR = Math.max(0.5, Math.round(r * this.dpr * 4) / 4);
    const sp = this.sprite(rgb, devR);
    const s = sp.width / this.dpr;
    this.ctx.globalAlpha = alpha;
    this.ctx.drawImage(sp, x - s / 2, y - s / 2, s, s);
  }

  private glow(rgb: string, x: number, y: number, r: number, alpha: number): void {
    const devR = Math.max(2, Math.round(r * this.dpr));
    const key = `glow|${rgb}|${devR}`;
    let sp = this.sprites.get(key);
    if (!sp) {
      const size = devR * 2;
      sp = this.mk();
      sp.width = sp.height = size;
      const g = sp.getContext('2d');
      if (g) {
        const grad = g.createRadialGradient(devR, devR, 0, devR, devR, devR);
        grad.addColorStop(0, `rgba(${rgb},1)`);
        grad.addColorStop(1, `rgba(${rgb},0)`);
        g.fillStyle = grad;
        g.fillRect(0, 0, size, size);
      }
      this.sprites.set(key, sp);
    }
    const s = sp.width / this.dpr;
    this.ctx.globalAlpha = alpha;
    this.ctx.drawImage(sp, x - s / 2, y - s / 2, s, s);
  }

  /** Split the text into lines: one line normally, one word per line on narrow screens. */
  private lines(): LineChars[] {
    const tokens = this.text.match(/[^\s-]+[\s-]?/g) ?? [this.text];
    if (this.small && tokens.length > 1) {
      let g = 0;
      return tokens.map((tok, wi) => {
        const t = tok.replace(/\s+$/, '');
        const line = { text: t, words: Array.from({ length: t.length }, () => wi), g0: g };
        g += t.length;
        return line;
      });
    }
    const words: number[] = [];
    tokens.forEach((tok, wi) => {
      for (let i = 0; i < tok.length; i++) words.push(wi);
    });
    return [{ text: this.text, words, g0: 0 }];
  }

  private build(): void {
    const o = this.octx;
    const W = this.W;
    const lines = this.lines();
    const spaced = (c: SpacedContext, fs: number): void => {
      if ('letterSpacing' in c) c.letterSpacing = `${CONFIG.tracking * fs}px`;
    };

    // Fit the widest line to the container width.
    const refFs = 100;
    o.font = `${CONFIG.fontWeight} ${refFs}px ${this.family}`;
    spaced(o, refFs);
    let widest = 1;
    for (const l of lines) widest = Math.max(widest, o.measureText(l.text).width);
    const fs = clamp((W / widest) * refFs, 24, 420);
    const font = `${CONFIG.fontWeight} ${fs}px ${this.family}`;
    o.font = font;
    spaced(o, fs);
    const capM = o.measureText('H').actualBoundingBoxAscent;
    const cap = capM > 0 ? capM : fs * 0.72;

    const padTop = Math.round(cap * CONFIG.headroom);
    this.pad = padTop;
    const gap = cap * 0.16;
    const last = lines.length - 1;
    this.H = Math.ceil(padTop + last * (cap + gap) + this.frac * cap + 2);

    // Dot size follows the cap height, with a floor so phones stay legible.
    const pitch = clamp(cap / 44, 3.2, 6.6);
    this.r = pitch * 0.32;

    // Draw the word(s) and read them back.
    this.off.width = W;
    this.off.height = this.H;
    o.clearRect(0, 0, W, this.H);
    o.font = font;
    spaced(o, fs);
    o.textBaseline = 'alphabetic';
    o.fillStyle = '#fff';
    lines.forEach((l, i) => o.fillText(l.text, 0, padTop + i * (cap + gap) + cap));
    const img = o.getImageData(0, 0, W, this.H);

    const nChars = Math.max(1, lines.reduce((n, l) => n + l.text.length, 0));

    const FW = this.fw || W;
    const FH = this.fh || this.H;
    const ox = this.fw ? this.ox : 0;
    const oy = this.fh ? this.oy : 0;
    const dots: Dot[] = [];
    const rnd = (i: number, k: number): number => hash(i * 1.37, k);
    // Scattered positions with soft, uneven density (rejection sampling) so the field never looks like a grid.
    const scatter = (i: number, k: number): [number, number] => {
      let x = 0;
      let y = 0;
      for (let tries = 0; tries < 5; tries++) {
        x = rnd(i + tries * 7919, k) * FW;
        y = rnd(i + tries * 7919, k + 1) * FH;
        const dens = 0.5 + 0.5 * Math.sin(x * 0.012 + 1.3) * Math.sin(y * 0.05 + 0.7) * 0.9;
        if (rnd(i + tries * 7919, k + 2) < dens + 0.25) break;
      }
      return [x, y];
    };
    let n = 0;
    lines.forEach((l, li) => {
      const lineTop = padTop + li * (cap + gap);
      const isLast = li === last;
      const bandH = isLast ? this.frac * cap : cap;
      // Cumulative x offsets give each character's span for timing.
      const xs: number[] = [0];
      for (let i = 1; i <= l.text.length; i++) xs.push(o.measureText(l.text.slice(0, i)).width);
      let row = 0;
      for (let y = lineTop - cap * 0.02 + pitch / 2; y < lineTop + bandH; y += pitch, row++) {
        const off = row % 2 ? pitch / 2 : 0;
        for (let x = off; x < W; x += pitch) {
          const a = img.data[(Math.floor(y) * W + Math.floor(x)) * 4 + 3] ?? 0;
          if (a < 110) continue;
          let ci = 0;
          for (let i = 0; i < l.text.length; i++) {
            if ((xs[i] ?? 0) <= x) ci = i;
            else break;
          }
          if ((l.text[ci] ?? ' ') === ' ') continue;
          const x0 = xs[ci] ?? 0;
          const cw = Math.max(1, (xs[ci + 1] ?? x0 + 1) - x0);
          const rel = clamp((y - lineTop) / Math.max(1, bandH), 0, 1);
          n++;
          const [sx, sy] = scatter(n, 1);
          dots.push({
            tx: x + ox,
            ty: y + oy,
            sx,
            sy,
            ph1: rnd(n, 3) * TAU,
            ph2: rnd(n, 4) * TAU,
            dl: clamp(((x - x0) / cw) * 0.55 + ((y - lineTop) / cap) * 0.25 + rnd(n, 5) * 0.2, 0, 1),
            cv: rnd(n, 6) * 2 - 1,
            ch: l.g0 + ci,
            c: (l.words[ci] ?? 0) % this.colors.length,
            // Dots shrink toward the crop edge, like a halftone fading out.
            fd: isLast ? 1 - (1 - CONFIG.cropShrink) * ss(CONFIG.fadeStart, 1, rel) : 1,
            stray: false,
            lv: 0,
            x: 0,
            y: 0,
            r: 0,
            st: 0,
            s: 0,
            e: 0,
          });
          const dot = dots[dots.length - 1];
          if (dot) dot.s = ((l.g0 + ci) / nChars) * CONFIG.order + dot.dl * CONFIG.inner;
        }
      }
    });

    // Strays: noise that never settles.
    const strays = Math.round(dots.length * CONFIG.strayShare);
    for (let i = 0; i < strays; i++) {
      const k = n + i + 1;
      const [sx, sy] = scatter(k, 11);
      dots.push({
        tx: 0,
        ty: 0,
        sx,
        sy,
        ph1: rnd(k, 13) * TAU,
        ph2: rnd(k, 14) * TAU,
        dl: 0,
        cv: 0,
        ch: 0,
        c: 0,
        fd: 1,
        stray: true,
        lv: rnd(k, 15) > 0.55 ? 1 : 0,
        x: 0,
        y: 0,
        r: 0,
        st: 0,
        s: 0,
        e: 0,
      });
    }
    this.dots = dots;
  }
}

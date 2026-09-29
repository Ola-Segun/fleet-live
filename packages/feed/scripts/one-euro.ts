import type { Smoother } from "../src";

/**
 * **Kept for comparison only.** This was the design's planned smoother. The
 * evaluation measured it against the velocity-aided filter and it lost (see
 * docs/LAYERS.md, Layer 4), so it lives beside the evaluation script, not in
 * the package.
 *
 * The 1€ filter (Casiez, Roussel & Vogel, CHI 2012): a low-pass filter whose
 * cutoff rises with speed. Slow or still, it smooths hard and a parked truck
 * stops shivering. Fast, it smooths lightly, so a moving truck doesn't lag
 * behind its own reports.
 *
 * This version filters a 2-D path in local metres and uses the *magnitude* of
 * the velocity to set one cutoff for both axes, so the smoothing doesn't
 * depend on which way the road runs.
 *
 * It is written as a pure function of an ordered path, not as a stateful
 * object fed one sample at a time. The feed recomputes it over the current
 * window whenever the window changes, so the smoothed track depends only on
 * *which* samples are present, never on the order they arrived in.
 */
export interface OneEuroParams {
  /** Cutoff when still, Hz. Lower is smoother and laggier. */
  minCutoffHz: number;
  /** Cutoff added per m/s of speed, Hz. Higher tracks fast motion more closely. */
  beta: number;
  /** Cutoff for the speed estimate itself, Hz. */
  derivativeCutoffHz: number;
}

export interface TimedPoint {
  /** Seconds. Only differences matter. */
  t: number;
  x: number;
  y: number;
}

/** Smoothing factor for a first-order low-pass at `cutoffHz` over `dt` seconds. */
export function alpha(cutoffHz: number, dt: number): number {
  const tau = 1 / (2 * Math.PI * cutoffHz);
  return 1 / (1 + tau / dt);
}

export function smoothPath(points: readonly TimedPoint[], params: OneEuroParams): { x: number; y: number }[] {
  if (points.length === 0) return [];
  const first = points[0]!;
  const out = [{ x: first.x, y: first.y }];
  let x = first.x;
  let y = first.y;
  let vx = 0;
  let vy = 0;
  for (let i = 1; i < points.length; i++) {
    const p = points[i]!;
    const dt = p.t - points[i - 1]!.t;
    if (dt <= 0) {
      // Two samples at the same instant: no time has passed, so nothing to filter over.
      out.push({ x, y });
      continue;
    }
    const aD = alpha(params.derivativeCutoffHz, dt);
    vx += aD * ((p.x - x) / dt - vx);
    vy += aD * ((p.y - y) / dt - vy);
    const a = alpha(params.minCutoffHz + params.beta * Math.hypot(vx, vy), dt);
    x += a * (p.x - x);
    y += a * (p.y - y);
    out.push({ x, y });
  }
  return out;
}

/** The 1€ filter as a `Smoother`, ignoring the reported velocity it has no use for. */
export const oneEuro =
  (params: OneEuroParams): Smoother =>
  (path) =>
    smoothPath(path, params);

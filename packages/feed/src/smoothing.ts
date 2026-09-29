/**
 * Position smoothing for one vehicle's window of samples, in local metres.
 *
 * A smoother is a pure function of an ordered path. The track recomputes it
 * over the whole window whenever the window changes, so the smoothed track
 * depends only on *which* samples are present, never on arrival order.
 */
export interface SmoothInput {
  /** Seconds. Only differences matter. */
  t: number;
  /** Measured position, metres east and north of an origin. */
  x: number;
  y: number;
  /** Velocity the device reported (its GPS speed and heading), m/s east and north. */
  vx: number;
  vy: number;
}

export type Smoother = (path: readonly SmoothInput[]) => { x: number; y: number }[];

/**
 * A velocity-aided filter: predict each position from the previous estimate
 * plus the reported velocity, then move only part of the way (gain `k`)
 * towards the new GPS fix.
 *
 *   predicted = estimate[i−1] + v̄ · dt
 *   estimate[i] = predicted + k · (fix[i] − predicted)
 *
 * where v̄ is the mean of the velocities reported at i−1 and i, so a turn
 * between two reports is split between them.
 *
 * Why this and not a plain low-pass: GPS *speed* comes from Doppler shift and
 * is far more precise than GPS *position*. Using it, a parked truck (v = 0)
 * becomes a running average of its fixes, and a moving truck keeps pace with
 * itself instead of lagging. The 1€ filter the design planned was measured
 * against this and lost. See docs/LAYERS.md, Layer 4.
 *
 * With exact velocity, the steady-state error per axis is about
 * σ·√(k / (2 − k)): at k = 0.2, a third of the raw GPS noise.
 */
export function velocityAided(k: number): Smoother {
  if (!(k > 0 && k <= 1)) throw new RangeError(`gain must be in (0, 1], got ${k}`);
  return (path) => {
    if (path.length === 0) return [];
    const first = path[0]!;
    const out = [{ x: first.x, y: first.y }];
    let x = first.x;
    let y = first.y;
    for (let i = 1; i < path.length; i++) {
      const prev = path[i - 1]!;
      const p = path[i]!;
      const dt = Math.max(0, p.t - prev.t);
      const px = x + ((prev.vx + p.vx) / 2) * dt;
      const py = y + ((prev.vy + p.vy) / 2) * dt;
      x = px + k * (p.x - px);
      y = py + k * (p.y - py);
      out.push({ x, y });
    }
    return out;
  };
}

/** No smoothing: the GPS fixes as reported. The baseline every smoother is measured against. */
export const raw: Smoother = (path) => path.map(({ x, y }) => ({ x, y }));

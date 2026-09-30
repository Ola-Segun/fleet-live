/*
 * One small state machine, used for every alert that has an edge to wobble
 * across: inside/outside a zone, over/under the speed limit.
 *
 * Why it exists: a truck's reported position scatters by metres (GPS error,
 * which the simulator models at σ = 4 m) and its speed by a few km/h. A plain
 * "is it inside?" test on a truck parked by a zone's edge flips on every
 * report: enter, exit, enter, exit, each an alert. Two rules stop that:
 *
 *   - a **band** (hysteresis): to switch on, the value must pass the edge by a
 *     margin (20 m inside the zone, or over the limit); to switch off it must
 *     pass back by a margin the other way. Inside the band nothing changes.
 *   - a **dwell**: the value must stay past the margin for 10 s without a break
 *     before the switch counts. A single wild fix can't trigger anything.
 *
 * The cost is delay: a real entry is confirmed about dwell + margin ÷ speed
 * later than it happened. Layer 8b's evaluation measures that delay and the
 * false alerts it prevents, against the simulator's ground truth.
 *
 * State lives in typed arrays owned by the caller, one entry per truck, so
 * 5,000 trucks cost two arrays, not 5,000 objects.
 */

export const UNKNOWN = 0;
export const OFF = 1;
export const ON = 2;

export interface Debounced {
  /** UNKNOWN, OFF or ON per entry. */
  state: Uint8Array;
  /** When the current run towards a change began, or NaN if none is under way. */
  pendingSince: Float64Array;
}

export function debounced(capacity: number): Debounced {
  return { state: new Uint8Array(capacity), pendingSince: new Float64Array(capacity).fill(NaN) };
}

/** A copy with room for `capacity` entries; new entries start UNKNOWN. */
export function grow(d: Debounced, capacity: number): Debounced {
  if (capacity <= d.state.length) return d;
  const next = debounced(capacity);
  next.state.set(d.state);
  next.pendingSince.set(d.pendingSince);
  return next;
}

/**
 * Advance entry `i` to time `t` (ms).
 *
 * @param towardOn  the value is past the "on" margin (e.g. ≥ 20 m inside)
 * @param towardOff the value is past the "off" margin (e.g. ≥ 20 m outside)
 * @param initial   what an UNKNOWN entry starts as, without it counting as a change
 * @returns ON or OFF when a change is confirmed now, otherwise 0
 */
export function step(d: Debounced, i: number, t: number, towardOn: boolean, towardOff: boolean, dwellMs: number, initial: boolean): number {
  const s = d.state[i]!;
  if (s === UNKNOWN) {
    // First sight (or a zone just drawn): take the current side as given. A truck
    // already inside a new zone hasn't *entered* it.
    d.state[i] = initial ? ON : OFF;
    d.pendingSince[i] = NaN;
    return 0;
  }
  const wants = s === ON ? towardOff : towardOn;
  if (!wants) {
    d.pendingSince[i] = NaN; // the run was broken: start again next time
    return 0;
  }
  const since = d.pendingSince[i]!;
  if (Number.isNaN(since)) {
    d.pendingSince[i] = t;
    if (dwellMs > 0) return 0;
  } else if (t - since < dwellMs) {
    return 0;
  }
  d.state[i] = s === ON ? OFF : ON;
  d.pendingSince[i] = NaN;
  return d.state[i]!;
}

/** Keep the entry's state but abandon any run under way: used when its data can't be trusted (a stale truck). */
export function hold(d: Debounced, i: number): void {
  d.pendingSince[i] = NaN;
}

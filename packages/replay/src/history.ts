import type { ResolvedSample } from "@fleet/feed";
import {
  DEFAULT_STALENESS,
  FLAG_PARKED,
  FLOATS_PER_VEHICLE,
  METRES_PER_DEG,
  MODE_CODES,
  ORIGIN_X,
  ORIGIN_Y,
  SAMPLES_PER_VEHICLE,
  fromOffset,
  mercatorX,
  mercatorY,
} from "@fleet/gl";
import { PingFlag } from "@fleet/protocol";

/**
 * What the history records each time: every truck's estimate at one moment.
 * A FleetSnapshot has these fields, so it passes as is.
 */
export interface HistoryFrameInput {
  displayTime: number;
  count: number;
  ids: Uint32Array;
  lat: Float64Array;
  lon: Float64Array;
  heading: Float32Array;
  speed: Float32Array;
  mode: Uint8Array;
  ignition: Uint8Array;
}

export interface HistoryOptions {
  /** One frame of the whole fleet this often, in data time. */
  intervalMs: number;
  /** How far back replay can go. Older frames are overwritten. */
  capacityMs: number;
}

/** 5 s: Layer 9's evaluation measured replay at 5 s within 0.4 m of the live map at p99, for 25 MB an hour. */
export const DEFAULT_HISTORY: HistoryOptions = { intervalMs: 5000, capacityMs: 3_600_000 };

/**
 * Positions are stored as 16-bit steps of 2 × 10⁻⁵° of longitude (about 2.2 m)
 * in Web Mercator, offset from the map's origin: half the memory of float32
 * pairs, and already in the units the GPU texture wants, so packing a row is a
 * multiply, not a logarithm. Half a step, about 1.1 m, is the most any position
 * moves; GPS error alone is several metres. The range, ±0.655° from the origin,
 * covers every Lagos route (longitude 2.72°–4.04°).
 */
export const DEGREES_PER_STEP = 2e-5;
const MERCATOR_STEP = DEGREES_PER_STEP / 360;
const MAX_STEP = 32767;

/** Per truck per frame: 0 = no data (unknown, or stale then), 1 = ignition on, 2 = ignition off. */
const NONE = 0;
const ON = 1;
const OFF = 2;

interface Frame {
  time: number;
  x: Int16Array;
  y: Int16Array;
  /** Heading in steps of 360/256°. */
  heading: Uint8Array;
  /** Whole km/h, capped at 255. */
  speed: Uint8Array;
  state: Uint8Array;
}

export interface HistoryStats {
  frames: number;
  vehicles: number;
  bytes: number;
  /** Positions that fell outside the 16-bit range and were clamped. Expected to stay 0 in Lagos. */
  clamped: number;
}

/** Which frames to draw a truck with at one time, and how long that choice holds. */
interface Plan {
  slot: number;
  /** Frames lo…hi, oldest first; hi < lo means nothing to draw. */
  lo: number;
  hi: number;
  validFrom: number;
  validTo: number;
}

const FRESH = new Set<number>([MODE_CODES.interpolated, MODE_CODES.extrapolated, MODE_CODES.parked]);
const DEG = Math.PI / 180;

/**
 * The last hour of the fleet, for replay: a ring of frames, each holding every
 * truck's smoothed position, heading, speed and ignition at one moment.
 *
 * Why frames of estimates and not the raw pings: raw pings are 5,000 a second,
 * late, duplicated and out of order. An hour of them would be about 18 million
 * records, and replaying them would redo Layer 4. The feed's estimates are
 * already clean, and they are what the dispatcher saw at the time.
 *
 * Only *fresh* estimates are recorded (interpolated, projected or parked). A
 * truck that was holding or stale gets no data in that frame. In replay that
 * gap shows as stale, through the same shader rules as live, with no special
 * replay logic.
 *
 * Cost: 7 bytes per truck per frame. At the default 5 s, an hour of 5,000
 * trucks is 25 MB.
 */
export class History {
  readonly options: HistoryOptions;
  readonly capacity: number;
  private readonly frames: Frame[] = [];
  /** Index of the oldest frame in `frames` once the ring is full. */
  private head = 0;
  private readonly slots = new Map<number, number>();
  private lastRecorded = -Infinity;
  private clamped = 0;

  constructor(options: Partial<HistoryOptions> = {}) {
    this.options = { ...DEFAULT_HISTORY, ...options };
    this.capacity = Math.max(2, Math.round(this.options.capacityMs / this.options.intervalMs));
  }

  /** The grid time to record now, if display time has passed one not yet recorded. Missed ones (a sleeping tab) are skipped: a gap. */
  due(displayTime: number): number | undefined {
    const grid = Math.floor(displayTime / this.options.intervalMs) * this.options.intervalMs;
    return grid > this.lastRecorded ? grid : undefined;
  }

  record(input: HistoryFrameInput): void {
    // Until some truck has a fresh estimate there is nothing to replay: the first frames of a session
    // are empty, and replay started on an empty map (the browser check caught it). A frame with no
    // data *later* is recorded: that's a real gap, such as a lost connection.
    if (this.frames.length === 0 && !input.mode.some((m, i) => i < input.count && FRESH.has(m))) {
      this.lastRecorded = input.displayTime;
      return;
    }
    for (let i = 0; i < input.count; i++) {
      const id = input.ids[i]!;
      if (!this.slots.has(id)) this.slots.set(id, this.slots.size);
    }
    const size = this.slots.size;
    let frame: Frame;
    if (this.frames.length < this.capacity) {
      frame = newFrame(size);
      this.frames.push(frame);
    } else {
      // Overwrite the oldest, reusing its arrays when they're big enough: no garbage every 5 s.
      frame = this.frames[this.head]!;
      if (frame.state.length < size) {
        frame = newFrame(size);
        this.frames[this.head] = frame;
      } else {
        frame.state.fill(NONE);
      }
      this.head = (this.head + 1) % this.capacity;
    }
    frame.time = input.displayTime;
    for (let i = 0; i < input.count; i++) {
      if (!FRESH.has(input.mode[i]!)) continue;
      const slot = this.slots.get(input.ids[i]!)!;
      frame.x[slot] = this.quantize(mercatorX(input.lon[i]!) - ORIGIN_X);
      frame.y[slot] = this.quantize(mercatorY(input.lat[i]!) - ORIGIN_Y);
      frame.heading[slot] = Math.round((((input.heading[i]! % 360) + 360) % 360) * (256 / 360)) & 255;
      frame.speed[slot] = Math.min(255, Math.round(input.speed[i]! * 3.6));
      frame.state[slot] = input.ignition[i] ? ON : OFF;
    }
    this.lastRecorded = input.displayTime;
  }

  private quantize(offset: number): number {
    const q = Math.round(offset / MERCATOR_STEP);
    if (q > MAX_STEP || q < -MAX_STEP) {
      this.clamped++;
      return q > 0 ? MAX_STEP : -MAX_STEP;
    }
    return q;
  }

  /** Frames held, oldest first. */
  get length(): number {
    return this.frames.length;
  }

  /** The time of the k-th frame, oldest first. */
  timeAt(k: number): number {
    return this.frame(k).time;
  }

  /** Replayable range: from the oldest frame to the newest. Undefined until two frames exist. */
  range(): { from: number; to: number } | undefined {
    if (this.frames.length < 2) return undefined;
    return { from: this.timeAt(0), to: this.timeAt(this.frames.length - 1) };
  }

  stats(): HistoryStats {
    let bytes = 0;
    for (const f of this.frames) bytes += f.state.length * 7;
    return { frames: this.frames.length, vehicles: this.slots.size, bytes, clamped: this.clamped };
  }

  /** Vehicle ids the history has seen. */
  vehicleIds(): IterableIterator<number> {
    return this.slots.keys();
  }

  private frame(k: number): Frame {
    return this.frames[this.frames.length < this.capacity ? k : (this.head + k) % this.capacity]!;
  }

  /** Index of the last frame at or before `time`, or −1. Frames are in time order, so this is a binary search. */
  indexAt(time: number): number {
    let lo = 0;
    let hi = this.frames.length - 1;
    let found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (this.timeAt(mid) <= time) {
        found = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return found;
  }

  /** Whether history slot `slot` has data in frame k. */
  private has(slot: number, k: number): boolean {
    const f = this.frame(k);
    return slot < f.state.length && f.state[slot] !== NONE;
  }

  /** Parked by live's rule (packVehicle's): ignition off, or slower than 0.5 m/s. Speed is stored in whole km/h, so 0–1. */
  private parked(slot: number, k: number): boolean {
    const f = this.frame(k);
    return f.state[slot] === OFF || f.speed[slot]! <= 1;
  }

  /** Frames k and k+1 both hold this vehicle, one interval apart: nothing missing in between (a sleeping tab skips frames). */
  private linked(slot: number, k: number): boolean {
    return this.has(slot, k) && this.has(slot, k + 1) && this.timeAt(k + 1) - this.timeAt(k) <= this.options.intervalMs * 1.5;
  }

  /** When history slot `slot` next has data after frame `k`, or `otherwise`. */
  private nextDataAfter(slot: number, k: number, otherwise: number): number {
    for (let j = k + 1; j < this.frames.length; j++) if (this.has(slot, j)) return this.timeAt(j);
    return otherwise;
  }

  /**
   * Which frames to draw vehicle `id` with at `time`, and the span of time the
   * choice stays right for.
   *
   * - **During a run of data:** up to 8 consecutive frames, starting one before
   *   `time`, so forward playback has the most future samples before it needs
   *   new ones.
   * - **In a gap:** the run that ended before it. The shader then projects,
   *   holds and turns the truck stale by the same rules as live.
   * - **Before the truck's first data:** nothing, and the truck isn't drawn.
   * - **Parked at `time`:** only up to `time` (see below).
   *
   * `validTo` also ends at the next frame to be recorded whenever the choice
   * reaches the newest frame, because new data may extend it.
   *
   * Every scan is bounded by what's used, 8 frames or so. The first version
   * walked the whole run of data both ways, up to the full hour for a truck
   * that never stopped reporting. The benchmark found it.
   */
  private plan(id: number, time: number): Plan {
    const n = this.frames.length;
    const pending = n > 0 ? this.timeAt(n - 1) + this.options.intervalMs : Infinity;
    const slot = this.slots.get(id);
    if (slot === undefined || n === 0) return { slot: -1, lo: 0, hi: -1, validFrom: -Infinity, validTo: pending };
    const k = this.indexAt(time);

    // The newest frame at or before `time` that holds this vehicle. Unbounded: a truck with no data
    // for a long time is still drawn, stale, where it was last seen, as live does.
    let p = k;
    while (p >= 0 && !this.has(slot, p)) p--;
    if (p < 0) return { slot, lo: 0, hi: -1, validFrom: -Infinity, validTo: this.nextDataAfter(slot, k, pending) };

    // Parked at `time`: pack only up to p, so the shader draws it parked where it stands. With the
    // next frame packed too, time would sit *between* two samples, and the shader calls that
    // "interpolated": every parked truck replayed as a moving arrow (the tests caught it). Right
    // until the truck moves again, or until its one sample is half way to the shader's parked-stale
    // limit (90 s), whichever is first: one pack per 45 s of a parked truck instead of one per frame.
    if (this.parked(slot, p)) {
      let lo = p;
      while (lo > p - 7 && lo > 0 && this.linked(slot, lo - 1)) lo--;
      const refresh = Math.max(this.timeAt(p) + (DEFAULT_STALENESS.parkedStaleS * 1000) / 2, this.timeAt(p) + this.options.intervalMs);
      let q = p;
      while (q < n - 1 && this.timeAt(q) < refresh && this.linked(slot, q) && this.parked(slot, q + 1)) q++;
      const moves =
        q < n - 1 && this.linked(slot, q) ? (this.parked(slot, q + 1) ? Infinity : this.timeAt(q + 1)) : q === n - 1 ? pending : this.nextDataAfter(slot, q, pending);
      return { slot, lo, hi: p, validFrom: this.timeAt(p), validTo: Math.min(moves, refresh) };
    }

    // The run through p: one frame before p if linked, then up to 8 in all.
    const lo = p > 0 && this.linked(slot, p - 1) ? p - 1 : p;
    let hi = p;
    while (hi < lo + 7 && hi < n - 1 && this.linked(slot, hi)) hi++;
    // Right until time leaves the frames used, or, if the run ends at hi, until the next data (or new frames).
    const continues = hi < n - 1 && this.linked(slot, hi);
    const validTo = continues ? this.timeAt(hi) : hi === n - 1 ? pending : this.nextDataAfter(slot, hi, pending);
    return { slot, lo, hi, validFrom: this.timeAt(lo), validTo };
  }

  /**
   * Vehicle `id`'s row for the GPU at `time`, written straight into `out` in
   * packVehicle's layout, with no objects in between. Returns the span of time
   * it stays right for. A test holds it to packVehicle(window(…).samples).
   */
  packInto(id: number, time: number, epoch: number, out: Float32Array, offset: number): { validFrom: number; validTo: number } {
    const plan = this.plan(id, time);
    const count = plan.hi - plan.lo + 1;
    if (count <= 0) {
      out.fill(0, offset, offset + FLOATS_PER_VEHICLE);
      return plan;
    }
    const used = Math.min(count, SAMPLES_PER_VEHICLE);
    const first = plan.hi - used + 1;
    const s = plan.slot;
    for (let k = 0; k < SAMPLES_PER_VEHICLE; k++) {
      // Padded at the front by repeating the oldest, as packVehicle does.
      const f = this.frame(first + Math.max(0, k - (SAMPLES_PER_VEHICLE - used)));
      const o = offset + k * 4;
      out[o] = f.x[s]! * MERCATOR_STEP;
      out[o + 1] = f.y[s]! * MERCATOR_STEP;
      out[o + 2] = (f.time - epoch) / 1000;
      out[o + 3] = (f.heading[s]! * 360) / 256;
    }
    const last = this.frame(plan.hi);
    const speed = last.speed[s]! / 3.6;
    const h = ((last.heading[s]! * 360) / 256) * DEG;
    const [lat] = fromOffset(last.x[s]! * MERCATOR_STEP, last.y[s]! * MERCATOR_STEP);
    const cosLat = Math.cos(lat * DEG);
    const m = offset + SAMPLES_PER_VEHICLE * 4;
    // As packVehicle: m/s → degrees/s → Mercator units/s.
    out[m] = (speed * Math.sin(h)) / (METRES_PER_DEG * cosLat) / 360;
    out[m + 1] = -((speed * Math.cos(h)) / METRES_PER_DEG) / (360 * cosLat);
    out[m + 2] = last.state[s] === OFF || speed < 0.5 ? FLAG_PARKED : 0;
    out[m + 3] = used;
    return plan;
  }

  /** The same choice as `packInto`, as the feed's resolved samples: for tests, the evaluation and anything that wants objects. */
  window(id: number, time: number): { samples: ResolvedSample[]; validFrom: number; validTo: number } {
    const plan = this.plan(id, time);
    const samples: ResolvedSample[] = [];
    for (let k = plan.lo; k <= plan.hi; k++) samples.push(this.sample(plan.slot, k));
    return { samples, validFrom: plan.validFrom, validTo: plan.validTo };
  }

  /**
   * Speed (m/s) and ignition recorded for vehicle `id` in the frame at `time`,
   * if it has data there. Within a millisecond: callers may have the time back
   * from the GPU rows' float32 seconds.
   */
  recordedAt(id: number, time: number): { speed: number; ignition: boolean } | undefined {
    const slot = this.slots.get(id);
    const k = this.indexAt(time + 1);
    if (slot === undefined || k < 0 || Math.abs(this.timeAt(k) - time) > 1 || !this.has(slot, k)) return undefined;
    const f = this.frame(k);
    return { speed: f.speed[slot]! / 3.6, ignition: f.state[slot] === ON };
  }

  /** The sample in frame k for history slot `slot`, shaped as the feed's resolved samples so packVehicle can take it. */
  private sample(slot: number, k: number): ResolvedSample {
    const f = this.frame(k);
    const [lat, lon] = fromOffset(f.x[slot]! * MERCATOR_STEP, f.y[slot]! * MERCATOR_STEP);
    const heading = (f.heading[slot]! * 360) / 256;
    const speed = f.speed[slot]! / 3.6;
    const h = heading * DEG;
    return {
      seq: k,
      deviceTime: f.time,
      receivedAt: f.time,
      time: f.time,
      lat,
      lon,
      smoothLat: lat,
      smoothLon: lon,
      speed,
      heading,
      flags: f.state[slot] === ON ? PingFlag.Ignition : 0,
      vx: speed * Math.sin(h),
      vy: speed * Math.cos(h),
    };
  }
}

function newFrame(size: number): Frame {
  // Room to grow, so a fleet that gains trucks doesn't reallocate every frame.
  const capacity = Math.ceil(Math.max(size, 1) * 1.25);
  return {
    time: 0,
    x: new Int16Array(capacity),
    y: new Int16Array(capacity),
    heading: new Uint8Array(capacity),
    speed: new Uint8Array(capacity),
    state: new Uint8Array(capacity),
  };
}

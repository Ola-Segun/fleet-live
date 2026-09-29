import { PingFlag, type Ping } from "@fleet/protocol";
import type { LatLon } from "@fleet/routes";
import type { Smoother } from "./smoothing";
import { seqAfter, seqDiff } from "./seq";

/** A ping as the feed keeps it: what the device said, plus when it arrived. */
export interface Sample {
  seq: number;
  deviceTime: number;
  /** Server time the ping arrived: the frame's `baseTime`. */
  receivedAt: number;
  lat: number;
  lon: number;
  speed: number;
  heading: number;
  flags: number;
  /** Reported velocity, m/s east and north. Computed once on insert, not on every re-smooth. */
  vx: number;
  vy: number;
}

/** A sample with the track's current view of it: corrected time and smoothed position. */
export interface ResolvedSample extends Sample {
  /** Device time corrected onto the server's clock, ms. */
  time: number;
  smoothLat: number;
  smoothLon: number;
}

export type InsertOutcome = "added" | "duplicate" | "too_old" | "reset";

export type EstimateMode =
  /** The display time is before the first sample: nothing to show yet. */
  | "waiting"
  /** Between two known samples. The normal case. */
  | "interpolated"
  /** Past the newest sample, projected along its reported speed and heading. */
  | "extrapolated"
  /** Past the extrapolation limit: frozen where the projection stopped. */
  | "holding"
  /** Parked (ignition off or not moving): shown where it is, not projected. */
  | "parked"
  /** Nothing heard for too long. The UI greys it out. */
  | "stale";

export interface Estimate {
  lat: number;
  lon: number;
  heading: number;
  speed: number;
  mode: EstimateMode;
  /** Display time minus the newest sample's time. Negative while interpolating. */
  ageMs: number;
}

export interface TrackOptions {
  /** Samples kept per vehicle, by sequence number. */
  window: number;
  smoothing: Smoother;
  /** How far past the newest sample to project a moving truck. */
  extrapolateMs: number;
  /** A moving truck silent this long is stale. */
  movingStaleMs: number;
  /** A parked truck reports every 30 s, so it is only stale after much longer. */
  parkedStaleMs: number;
}

const METRES_PER_DEG = 111_195.08;
/** Below this a truck is treated as stopped, whatever its ignition flag says. */
const MOVING_MS = 0.5;
/**
 * A sequence number this far *behind* the newest, but with a newer device
 * time, means the tracker restarted and began counting from 0 again.
 */
const RESET_SEQ_GAP = 64;

/** Shortest-arc interpolation between two headings in degrees. */
export function lerpHeading(a: number, b: number, t: number): number {
  const delta = ((b - a + 540) % 360) - 180;
  return (a + delta * t + 360) % 360;
}

/**
 * Everything the feed knows about one vehicle: the last `window` samples by
 * sequence number, with duplicates removed.
 *
 * **The guarantee:** the resolved track (order, corrected times and smoothed
 * positions) is a pure function of the *set* of samples in the window. Arrival
 * order and duplication cannot change it, because:
 *   - order is by sequence number, which the device assigns;
 *   - the clock offset is the minimum delay over the window, which depends
 *     only on which samples are in it;
 *   - smoothing is recomputed from scratch over the window, not carried
 *     forward as state from whatever arrived last.
 * The one exception is noted on `lastOffset`.
 */
export class VehicleTrack {
  private samples: Sample[] = [];
  private resolved: ResolvedSample[] | null = null;
  /**
   * Used only when every sample in the window was buffered in a coverage gap,
   * whose delays say nothing about the clock. It is the one piece of state
   * carried between windows.
   */
  private lastOffset: number | undefined;

  constructor(private readonly options: TrackOptions) {}

  get size(): number {
    return this.samples.length;
  }

  insert(ping: Ping, receivedAt: number): InsertOutcome {
    const h = (ping.heading * Math.PI) / 180;
    const sample: Sample = { ...ping, receivedAt, vx: ping.speed * Math.sin(h), vy: ping.speed * Math.cos(h) };
    const newest = this.samples.at(-1);

    if (newest && seqDiff(newest.seq, sample.seq) > RESET_SEQ_GAP && sample.deviceTime > newest.deviceTime) {
      this.samples = [sample];
      this.resolved = null;
      return "reset";
    }

    // Insertion point by sequence number. The window is small (16), so a linear
    // scan from the newest end beats a binary search on constant factors.
    let i = this.samples.length;
    while (i > 0 && seqAfter(this.samples[i - 1]!.seq, sample.seq)) i--;
    if (i > 0 && this.samples[i - 1]!.seq === sample.seq) {
      // Keep the *earliest* arrival of the copies. The clock offset is built from
      // arrival times, so keeping "whichever copy came first in processing order"
      // would let arrival order leak into the result. The earliest arrival
      // depends only on the set of deliveries.
      const kept = this.samples[i - 1]!;
      if (receivedAt < kept.receivedAt) {
        kept.receivedAt = receivedAt;
        this.resolved = null;
      }
      return "duplicate";
    }
    if (i === 0 && this.samples.length >= this.options.window) return "too_old";

    this.samples.splice(i, 0, sample);
    if (this.samples.length > this.options.window) this.samples.shift();
    this.resolved = null;
    return "added";
  }

  /** Server-clock offset for this device: min over the window of arrival − device time. */
  offset(): number {
    let best = Infinity;
    for (const s of this.samples) {
      if (s.flags & PingFlag.Buffered) continue;
      best = Math.min(best, s.receivedAt - s.deviceTime);
    }
    if (best !== Infinity) this.lastOffset = best;
    // All buffered: fall back to the last known offset, or failing that the least-delayed sample.
    return this.lastOffset ?? Math.min(...this.samples.map((s) => s.receivedAt - s.deviceTime));
  }

  /**
   * Corrected time of one sample, and the device time of the sample just
   * before it if that one is present and consecutive. Cheap: it needs only the
   * clock offset, not the smoothing, so the feed can call it on every insert
   * without re-smoothing the window each time.
   */
  timing(seq: number): { deviceTime: number; time: number; previousDeviceTime: number | undefined } | undefined {
    const i = this.samples.findIndex((s) => s.seq === seq);
    const sample = this.samples[i];
    if (!sample) return undefined;
    const previous = this.samples[i - 1];
    return {
      deviceTime: sample.deviceTime,
      time: sample.deviceTime + this.offset(),
      previousDeviceTime: previous && previous.seq === ((seq - 1) >>> 0) ? previous.deviceTime : undefined,
    };
  }

  /** The window in order, with corrected times and smoothed positions. Recomputed only after a change. */
  resolve(): readonly ResolvedSample[] {
    if (this.resolved) return this.resolved;
    if (this.samples.length === 0) return (this.resolved = []);

    const offset = this.offset();
    const first = this.samples[0]!;
    const cosLat = Math.cos((first.lat * Math.PI) / 180);
    const mx = METRES_PER_DEG * cosLat;
    // Flat metres around the oldest sample (see toLocalMetres in @fleet/routes), inlined so one
    // cosine serves the whole window. Device-time differences: skew cancels out, so smoothing
    // never depends on the offset.
    const smooth = this.options.smoothing(
      this.samples.map((s) => ({
        t: (s.deviceTime - first.deviceTime) / 1000,
        x: (s.lon - first.lon) * mx,
        y: (s.lat - first.lat) * METRES_PER_DEG,
        vx: s.vx,
        vy: s.vy,
      })),
    );
    const origin: LatLon = [first.lat, first.lon];

    this.resolved = this.samples.map((s, i) => ({
      ...s,
      time: s.deviceTime + offset,
      smoothLat: origin[0] + smooth[i]!.y / METRES_PER_DEG,
      smoothLon: origin[1] + smooth[i]!.x / mx,
    }));
    return this.resolved;
  }

  newest(): ResolvedSample | undefined {
    return this.resolve().at(-1);
  }

  /**
   * Where to draw the vehicle at `displayTime` (server clock, ms).
   *
   * This is the reference implementation. Layer 7's vertex shader must agree
   * with it, and the follow camera, picking and tests use it directly.
   */
  estimate(displayTime: number): Estimate | undefined {
    // Hot path: called for every truck several times a second. No closures, no
    // `.at()`, one object allocated per call.
    const samples = this.resolve();
    const n = samples.length;
    if (n === 0) return undefined;
    const first = samples[0]!;
    const last = samples[n - 1]!;
    const age = displayTime - last.time;

    if (displayTime < first.time) {
      return { lat: first.smoothLat, lon: first.smoothLon, heading: first.heading, speed: first.speed, mode: "waiting", ageMs: age };
    }

    if (displayTime < last.time) {
      let i = n - 2;
      while (i > 0 && samples[i]!.time > displayTime) i--;
      const a = samples[i]!;
      const b = samples[i + 1]!;
      const span = b.time - a.time;
      const t = span > 0 ? (displayTime - a.time) / span : 1;
      return {
        lat: a.smoothLat + (b.smoothLat - a.smoothLat) * t,
        lon: a.smoothLon + (b.smoothLon - a.smoothLon) * t,
        heading: lerpHeading(a.heading, b.heading, t),
        speed: a.speed + (b.speed - a.speed) * t,
        mode: "interpolated",
        ageMs: age,
      };
    }

    const parked = !(last.flags & PingFlag.Ignition) || last.speed < MOVING_MS;
    if (parked) {
      return {
        lat: last.smoothLat,
        lon: last.smoothLon,
        heading: last.heading,
        speed: last.speed,
        mode: age > this.options.parkedStaleMs ? "stale" : "parked",
        ageMs: age,
      };
    }

    // Project along the reported velocity, precomputed on insert, for at most `extrapolateMs`.
    const seconds = Math.min(age, this.options.extrapolateMs) / 1000;
    const cosLat = Math.cos((last.smoothLat * Math.PI) / 180);
    return {
      lat: last.smoothLat + (last.vy * seconds) / METRES_PER_DEG,
      lon: last.smoothLon + (last.vx * seconds) / (METRES_PER_DEG * cosLat),
      heading: last.heading,
      speed: last.speed,
      mode: age > this.options.movingStaleMs ? "stale" : age > this.options.extrapolateMs ? "holding" : "extrapolated",
      ageMs: age,
    };
  }
}

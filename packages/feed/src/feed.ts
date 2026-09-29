import { PingFlag, type Frame } from "@fleet/protocol";
import { velocityAided } from "./smoothing";
import { seqDiff } from "./seq";
import { VehicleTrack, type Estimate, type TrackOptions } from "./track";

export interface FeedOptions extends TrackOptions {
  /** The display delay never goes below this, ms. */
  minDelayMs: number;
  /** …or above this. */
  maxDelayMs: number;
  /** Before enough samples exist to estimate it. */
  initialDelayMs: number;
  /** How many recent observations the delay estimate uses. */
  delayWindow: number;
}

/**
 * Gain for the velocity-aided smoother, chosen against the simulator's ground
 * truth by `pnpm --filter @fleet/feed evaluate`. The measurements are in
 * docs/LAYERS.md, Layer 4.
 */
export const DEFAULT_GAIN = 0.2;

export const DEFAULT_FEED_OPTIONS: FeedOptions = {
  window: 16,
  smoothing: velocityAided(DEFAULT_GAIN),
  extrapolateMs: 5000,
  movingStaleMs: 10_000,
  parkedStaleMs: 90_000,
  minDelayMs: 1000,
  maxDelayMs: 5000,
  initialDelayMs: 2000,
  delayWindow: 4096,
};

export interface FeedStats {
  frames: number;
  /** Frames never received: gaps in `frameSeq`. The transport (Layer 5) resumes from these. */
  framesMissed: number;
  pings: number;
  added: number;
  duplicates: number;
  tooOld: number;
  resets: number;
  /** Added, but already behind the display time when they arrived. The renderer blends these in. */
  lateForDisplay: number;
}

/** A fixed-size ring of recent numbers with an on-demand quantile. */
class RecentValues {
  private readonly values: Float64Array;
  private count = 0;
  private next = 0;

  constructor(capacity: number) {
    this.values = new Float64Array(capacity);
  }

  push(value: number): void {
    this.values[this.next] = value;
    this.next = (this.next + 1) % this.values.length;
    this.count = Math.min(this.count + 1, this.values.length);
  }

  get size(): number {
    return this.count;
  }

  quantile(q: number): number {
    const sorted = this.values.slice(0, this.count).sort();
    return sorted[Math.min(this.count - 1, Math.floor(q * this.count))] ?? 0;
  }
}

/**
 * The whole fleet's feed. `ingest` takes frames in the order they arrive.
 * `estimate` answers "where is vehicle N at display time T".
 *
 * **Display time runs behind server time by an adaptive delay** — entity
 * interpolation, as multiplayer games do it. The delay must cover how late
 * samples arrive *and* the gap between them, so that at display time there is
 * usually a known sample on both sides:
 *
 *   delay = clamp(p95(arrival lateness) + p95(interval between pings), 1 s, 5 s)
 *
 * Smooth and honestly a second or two behind beats current and jumping.
 */
export class Feed {
  readonly stats: FeedStats = {
    frames: 0,
    framesMissed: 0,
    pings: 0,
    added: 0,
    duplicates: 0,
    tooOld: 0,
    resets: 0,
    lateForDisplay: 0,
  };
  private readonly tracks = new Map<number, VehicleTrack>();
  /** Vehicles with new samples since the last `drainChanged()`. */
  private changed = new Set<number>();
  private readonly lateness: RecentValues;
  private readonly intervals: RecentValues;
  private delay: number;
  private lastFrameSeq: number | undefined;
  private lastFrameTime = 0;
  private delayUpdatedAt = -Infinity;

  constructor(readonly options: FeedOptions = DEFAULT_FEED_OPTIONS) {
    this.delay = options.initialDelayMs;
    this.lateness = new RecentValues(options.delayWindow);
    this.intervals = new RecentValues(options.delayWindow);
  }

  /** Current display delay, ms. */
  get delayMs(): number {
    return this.delay;
  }

  /** Server time of the newest frame. */
  get serverTime(): number {
    return this.lastFrameTime;
  }

  /** Display time for a server time (by default, the newest frame's). */
  displayTime(serverTime = this.lastFrameTime): number {
    return serverTime - this.delay;
  }

  vehicleIds(): IterableIterator<number> {
    return this.tracks.keys();
  }

  track(vehicleId: number): VehicleTrack | undefined {
    return this.tracks.get(vehicleId);
  }

  ingest(frame: Frame): void {
    const s = this.stats;
    s.frames++;
    if (this.lastFrameSeq !== undefined) s.framesMissed += Math.max(0, seqDiff(frame.frameSeq, this.lastFrameSeq) - 1);
    this.lastFrameSeq = frame.frameSeq;
    this.lastFrameTime = Math.max(this.lastFrameTime, frame.baseTime);
    const displayNow = this.displayTime(frame.baseTime);

    for (const ping of frame.pings) {
      s.pings++;
      let track = this.tracks.get(ping.vehicleId);
      if (!track) this.tracks.set(ping.vehicleId, (track = new VehicleTrack(this.options)));
      const outcome = track.insert(ping, frame.baseTime);
      if (outcome === "duplicate") s.duplicates++;
      else if (outcome === "too_old") s.tooOld++;
      else {
        if (outcome === "reset") s.resets++;
        s.added++;
        this.changed.add(ping.vehicleId);
        this.observe(track, ping.seq, ping.flags, frame.baseTime, displayNow);
      }
    }

    if (frame.baseTime - this.delayUpdatedAt >= 1000) this.updateDelay(frame.baseTime);
  }

  private observe(track: VehicleTrack, seq: number, flags: number, receivedAt: number, displayNow: number): void {
    // Timing only. Smoothing waits until something reads the track, so a burst
    // of pings for one truck costs one re-smooth, not one per ping.
    const timing = track.timing(seq);
    if (!timing) return;
    if (timing.time < displayNow) this.stats.lateForDisplay++;
    // Coverage-gap backlogs are late by design. Counting them would push the delay up for everyone.
    if (!(flags & PingFlag.Buffered)) this.lateness.push(receivedAt - timing.time);
    if (timing.previousDeviceTime !== undefined && flags & PingFlag.Ignition) {
      this.intervals.push(timing.deviceTime - timing.previousDeviceTime);
    }
  }

  private updateDelay(now: number): void {
    this.delayUpdatedAt = now;
    if (this.lateness.size < 200 || this.intervals.size < 200) return;
    const wanted = this.lateness.quantile(0.95) + this.intervals.quantile(0.95);
    this.delay = Math.round(Math.min(this.options.maxDelayMs, Math.max(this.options.minDelayMs, wanted)));
  }

  /**
   * The vehicles that gained samples since the last call, and resets the set.
   * The renderer only needs to re-upload these; everything else is unchanged.
   */
  drainChanged(): Set<number> {
    const changed = this.changed;
    this.changed = new Set();
    return changed;
  }

  estimate(vehicleId: number, displayTime = this.displayTime()): Estimate | undefined {
    return this.tracks.get(vehicleId)?.estimate(displayTime);
  }
}

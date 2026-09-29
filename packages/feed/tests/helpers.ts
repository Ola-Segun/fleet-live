import { FrameType, PingFlag, type Frame, type Ping } from "@fleet/protocol";
import { DEFAULT_FEED_OPTIONS, raw, type FeedOptions } from "../src";

export const T0 = Date.UTC(2026, 8, 29, 2, 0, 0);

/** Metres to degrees of longitude at 6.5° N. */
export const eastDeg = (m: number) => m / (111_195.08 * Math.cos((6.5 * Math.PI) / 180));

/** No smoothing, so interpolation and extrapolation can be checked against hand-computed positions. */
export const RAW_OPTIONS: FeedOptions = { ...DEFAULT_FEED_OPTIONS, smoothing: raw };

/**
 * A truck driving due east at 10 m/s from (6.5, 3.4), reporting once a second
 * with a correct clock: seq n is at n × 10 m east, at T0 + n s.
 */
export function eastbound(seq: number, overrides: Partial<Ping> = {}): Ping {
  return {
    vehicleId: 1,
    seq,
    deviceTime: T0 + seq * 1000,
    lat: 6.5,
    lon: 3.4 + eastDeg(seq * 10),
    speed: 10,
    heading: 90,
    flags: PingFlag.Ignition,
    ...overrides,
  };
}

export function frame(frameSeq: number, baseTime: number, pings: Ping[]): Frame {
  return { type: FrameType.Delta, frameSeq, baseTime, pings };
}

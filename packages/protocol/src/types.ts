export const PROTOCOL_VERSION = 1;

export const FrameType = {
  /** Pings received since the previous frame. */
  Delta: 0,
  /** The latest ping of every vehicle, sent on connect and when a resume is too far behind. */
  Snapshot: 1,
} as const;
export type FrameType = (typeof FrameType)[keyof typeof FrameType];

export const PingFlag = {
  Ignition: 1 << 0,
  /** Recorded during a coverage gap and delivered late, in a burst. */
  Buffered: 1 << 1,
} as const;

/**
 * One position report from one vehicle, as the device produced it.
 *
 * `deviceTime` is the *device's* clock, which may be skewed. Ordering and
 * interpolation happen later, in the transport worker, after the offset is
 * estimated — the protocol carries the raw value and does not correct it.
 */
export interface Ping {
  /** uint32 */
  vehicleId: number;
  /** uint32, per vehicle, +1 per ping. Duplicates share a seq. */
  seq: number;
  /** Integer epoch milliseconds, device clock. */
  deviceTime: number;
  /** Degrees, [-90, 90]. Carried at 1e-6° (~0.11 m). */
  lat: number;
  /** Degrees, [-180, 180]. Carried at 1e-6°. */
  lon: number;
  /** Metres per second, [0, 655.35]. Carried at 0.01 m/s. */
  speed: number;
  /** Degrees clockwise from north, [0, 360). Carried at 0.01°. */
  heading: number;
  /** Bit set of {@link PingFlag}. uint8 */
  flags: number;
}

export interface Frame {
  type: FrameType;
  /** uint32 server cursor. A reconnecting client sends the last one it saw. */
  frameSeq: number;
  /** Integer epoch milliseconds. Ping times are stored as int32 offsets from it. */
  baseTime: number;
  pings: Ping[];
}

export type DecodeErrorCode =
  | "too_short"
  | "unsupported_version"
  | "unknown_frame_type"
  | "length_mismatch"
  | "invalid_base_time"
  | "value_out_of_range";

export interface DecodeError {
  code: DecodeErrorCode;
  message: string;
}

/**
 * Decoding reads bytes from the network, so failure is an expected outcome and
 * is returned, not thrown. Encoding reads our own simulator's output, so bad
 * input there is a programmer error and throws.
 */
export type DecodeResult =
  | { ok: true; frame: Frame }
  | { ok: false; error: DecodeError };

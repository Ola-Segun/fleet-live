import {
  FrameType,
  PROTOCOL_VERSION,
  type DecodeError,
  type DecodeErrorCode,
  type DecodeResult,
  type Frame,
  type Ping,
} from "./types";

/*
 * Wire layout. Every multi-byte field is little-endian, set explicitly on each
 * DataView call rather than trusting the platform.
 *
 * Header, 20 bytes
 *   0  u8   version
 *   1  u8   frame type
 *   2  u16  reserved, written as 0
 *   4  u32  frameSeq
 *   8  f64  baseTime (epoch ms)
 *  16  u32  ping count
 *
 * Ping, 25 bytes
 *   0  u32  vehicleId
 *   4  u32  seq
 *   8  i32  deviceTime − baseTime, ms (signed: skewed or buffered pings can predate the frame)
 *  12  i32  lat, microdegrees
 *  16  i32  lon, microdegrees
 *  20  u16  speed, cm/s
 *  22  u16  heading, centidegrees
 *  24  u8   flags
 */
export const HEADER_BYTES = 20;
export const PING_BYTES = 25;

const MICRO = 1e6;
const LE = true;
const UINT32_MAX = 0xffff_ffff;
const INT32_MIN = -0x8000_0000;
const INT32_MAX = 0x7fff_ffff;

export function frameByteLength(pingCount: number): number {
  return HEADER_BYTES + pingCount * PING_BYTES;
}

/*
 * `+ 0` turns -0 into 0. Math.round(-0.4) is -0, and a decoded int32 is never
 * -0, so without it a round trip would change the value under Object.is.
 */
const toMicro = (deg: number) => Math.round(deg * MICRO) + 0;
const toCenti = (x: number) => Math.round(x * 100) + 0;
/* 359.996° rounds to 36000 centidegrees, which is north again, not 360.00°. */
const headingToCenti = (deg: number) => toCenti(deg) % 36_000;

/**
 * The ping exactly as a receiver will decode it. The worker and the tests use
 * this so nothing downstream compares a float against its quantised copy.
 */
export function quantize(ping: Ping): Ping {
  return {
    vehicleId: ping.vehicleId,
    seq: ping.seq,
    deviceTime: ping.deviceTime,
    lat: toMicro(ping.lat) / MICRO,
    lon: toMicro(ping.lon) / MICRO,
    speed: toCenti(ping.speed) / 100,
    heading: headingToCenti(ping.heading) / 100,
    flags: ping.flags,
  };
}

function assertUint(name: string, value: number, max: number): void {
  if (!Number.isInteger(value) || value < 0 || value > max) {
    throw new RangeError(`${name} must be an integer in [0, ${max}], got ${value}`);
  }
}

function assertRange(name: string, value: number, min: number, max: number, maxExcluded = false): void {
  const aboveMax = maxExcluded ? value >= max : value > max;
  if (!Number.isFinite(value) || value < min || aboveMax) {
    throw new RangeError(`${name} must be in [${min}, ${max}${maxExcluded ? ")" : "]"}, got ${value}`);
  }
}

export function encodeFrame(frame: Frame): ArrayBuffer {
  assertUint("frameSeq", frame.frameSeq, UINT32_MAX);
  if (!Number.isSafeInteger(frame.baseTime)) {
    throw new RangeError(`baseTime must be an integer epoch ms, got ${frame.baseTime}`);
  }

  const buffer = new ArrayBuffer(frameByteLength(frame.pings.length));
  const view = new DataView(buffer);

  view.setUint8(0, PROTOCOL_VERSION);
  view.setUint8(1, frame.type);
  view.setUint16(2, 0, LE);
  view.setUint32(4, frame.frameSeq, LE);
  view.setFloat64(8, frame.baseTime, LE);
  view.setUint32(16, frame.pings.length, LE);

  frame.pings.forEach((ping, i) => {
    assertUint("vehicleId", ping.vehicleId, UINT32_MAX);
    assertUint("seq", ping.seq, UINT32_MAX);
    assertUint("flags", ping.flags, 0xff);
    assertRange("lat", ping.lat, -90, 90);
    assertRange("lon", ping.lon, -180, 180);
    assertRange("heading", ping.heading, 0, 360, true);
    if (!Number.isInteger(ping.deviceTime)) {
      throw new RangeError(`deviceTime must be integer epoch ms, got ${ping.deviceTime}`);
    }
    const offset = ping.deviceTime - frame.baseTime;
    if (offset < INT32_MIN || offset > INT32_MAX) {
      throw new RangeError(`deviceTime is ${offset} ms from baseTime; the limit is ±2^31 ms`);
    }
    const speed = toCenti(ping.speed);
    if (!Number.isFinite(ping.speed) || speed < 0 || speed > 0xffff) {
      throw new RangeError(`speed must be in [0, 655.35] m/s, got ${ping.speed}`);
    }

    const at = HEADER_BYTES + i * PING_BYTES;
    view.setUint32(at, ping.vehicleId, LE);
    view.setUint32(at + 4, ping.seq, LE);
    view.setInt32(at + 8, offset, LE);
    view.setInt32(at + 12, toMicro(ping.lat), LE);
    view.setInt32(at + 16, toMicro(ping.lon), LE);
    view.setUint16(at + 20, speed, LE);
    view.setUint16(at + 22, headingToCenti(ping.heading), LE);
    view.setUint8(at + 24, ping.flags);
  });

  return buffer;
}

const fail = (code: DecodeErrorCode, message: string): { ok: false; error: DecodeError } => ({
  ok: false,
  error: { code, message },
});

const FRAME_TYPES: ReadonlySet<number> = new Set(Object.values(FrameType));

/**
 * Accepts an ArrayBuffer or any view of one. A Node `Buffer` from `ws` is
 * usually a slice of a shared pool, so its bytes do not start at offset 0 of
 * its `.buffer`. The DataView must honour `byteOffset` and `byteLength`, or it
 * reads a neighbouring message.
 */
export function decodeFrame(input: ArrayBuffer | ArrayBufferView): DecodeResult {
  const view =
    input instanceof ArrayBuffer
      ? new DataView(input)
      : new DataView(input.buffer, input.byteOffset, input.byteLength);

  if (view.byteLength < HEADER_BYTES) {
    return fail("too_short", `${view.byteLength} bytes is shorter than the ${HEADER_BYTES}-byte header`);
  }

  const version = view.getUint8(0);
  if (version !== PROTOCOL_VERSION) {
    return fail("unsupported_version", `version ${version}, expected ${PROTOCOL_VERSION}`);
  }

  const type = view.getUint8(1);
  if (!FRAME_TYPES.has(type)) {
    return fail("unknown_frame_type", `frame type ${type}`);
  }

  const frameSeq = view.getUint32(4, LE);
  const baseTime = view.getFloat64(8, LE);
  if (!Number.isSafeInteger(baseTime)) {
    return fail("invalid_base_time", `baseTime ${baseTime} is not an integer epoch ms`);
  }

  const count = view.getUint32(16, LE);
  const expected = frameByteLength(count);
  if (view.byteLength !== expected) {
    return fail("length_mismatch", `header says ${count} pings (${expected} bytes), got ${view.byteLength} bytes`);
  }

  const pings: Ping[] = new Array(count);
  for (let i = 0; i < count; i++) {
    const at = HEADER_BYTES + i * PING_BYTES;
    const lat = view.getInt32(at + 12, LE);
    const lon = view.getInt32(at + 16, LE);
    const heading = view.getUint16(at + 22, LE);
    /*
     * An int32 can hold 2147°. A corrupt or hostile frame must fail here, not
     * put a truck in orbit three layers later.
     */
    if (Math.abs(lat) > 90 * MICRO || Math.abs(lon) > 180 * MICRO || heading >= 36_000) {
      return fail("value_out_of_range", `ping ${i}: lat ${lat}, lon ${lon} (µ°), heading ${heading} (c°)`);
    }
    pings[i] = {
      vehicleId: view.getUint32(at, LE),
      seq: view.getUint32(at + 4, LE),
      deviceTime: baseTime + view.getInt32(at + 8, LE),
      lat: lat / MICRO,
      lon: lon / MICRO,
      speed: view.getUint16(at + 20, LE) / 100,
      heading: heading / 100,
      flags: view.getUint8(at + 24),
    };
  }

  return { ok: true, frame: { type: type as FrameType, frameSeq, baseTime, pings } };
}

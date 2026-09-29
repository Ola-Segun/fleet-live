import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  FrameType,
  HEADER_BYTES,
  PING_BYTES,
  PingFlag,
  decodeFrame,
  encodeFrame,
  frameByteLength,
  quantize,
  type Frame,
  type Ping,
} from "../src";

const BASE = 1_700_000_000_000;

const lagosPing: Ping = {
  vehicleId: 1,
  seq: 2,
  deviceTime: BASE + 1500,
  lat: 6.5,
  lon: 3.38,
  speed: 12.34,
  heading: 90,
  flags: PingFlag.Ignition,
};

const frameOf = (...pings: Ping[]): Frame => ({ type: FrameType.Delta, frameSeq: 7, baseTime: BASE, pings });

// ─── Arbitraries ────────────────────────────────────────────────────────────

const pingAt = (baseTime: number) =>
  fc.record({
    vehicleId: fc.integer({ min: 0, max: 0xffff_ffff }),
    seq: fc.integer({ min: 0, max: 0xffff_ffff }),
    deviceTime: fc.integer({ min: -(2 ** 31), max: 2 ** 31 - 1 }).map((offset) => baseTime + offset),
    lat: fc.double({ min: -90, max: 90, noNaN: true }),
    lon: fc.double({ min: -180, max: 180, noNaN: true }),
    speed: fc.double({ min: 0, max: 655.35, noNaN: true }),
    heading: fc.double({ min: 0, max: 360, maxExcluded: true, noNaN: true }),
    flags: fc.integer({ min: 0, max: 0xff }),
  });

const arbFrame: fc.Arbitrary<Frame> = fc
  .record({
    type: fc.constantFrom(FrameType.Delta, FrameType.Snapshot),
    frameSeq: fc.integer({ min: 0, max: 0xffff_ffff }),
    // Epoch 0 to 2100-01-01. Far enough that `baseTime + int32 offset` still fits.
    baseTime: fc.integer({ min: 2 ** 31, max: 4_102_444_800_000 }),
  })
  .chain((header) =>
    fc.array(pingAt(header.baseTime), { maxLength: 40 }).map((pings) => ({ ...header, pings })),
  );

// ─── Layout, checked against bytes computed by hand ─────────────────────────

describe("wire layout", () => {
  it("is a 20-byte header plus 25 bytes per ping", () => {
    expect(frameByteLength(0)).toBe(20);
    expect(frameByteLength(500)).toBe(12_520);
    expect(encodeFrame(frameOf(lagosPing, lagosPing)).byteLength).toBe(70);
  });

  it("writes the header fields where the layout says", () => {
    const view = new DataView(encodeFrame(frameOf(lagosPing)));
    expect(view.getUint8(0)).toBe(1); // version
    expect(view.getUint8(1)).toBe(FrameType.Delta);
    expect(view.getUint16(2, true)).toBe(0); // reserved
    expect(view.getUint32(4, true)).toBe(7);
    expect(view.getFloat64(8, true)).toBe(BASE);
    expect(view.getUint32(16, true)).toBe(1);
  });

  it("writes a ping as the hand-computed little-endian bytes", () => {
    const bytes = new Uint8Array(encodeFrame(frameOf(lagosPing)), HEADER_BYTES, PING_BYTES);
    // prettier-ignore
    expect([...bytes]).toEqual([
      0x01, 0x00, 0x00, 0x00, // vehicleId 1
      0x02, 0x00, 0x00, 0x00, // seq 2
      0xdc, 0x05, 0x00, 0x00, // +1500 ms           = 0x000005DC
      0xa0, 0x2e, 0x63, 0x00, // lat 6.5°  → 6500000 = 0x00632EA0
      0x20, 0x93, 0x33, 0x00, // lon 3.38° → 3380000 = 0x00339320
      0xd2, 0x04,             // 12.34 m/s → 1234    = 0x04D2 (12.34 × 100 is 1233.9999999999998 in floating point)
      0x28, 0x23,             // 90°       → 9000    = 0x2328
      0x01,                   // flags: ignition
    ]);
  });

  it("stores a ping that predates the frame as a negative offset", () => {
    const early = { ...lagosPing, deviceTime: BASE - 1 };
    const bytes = new Uint8Array(encodeFrame(frameOf(early)), HEADER_BYTES + 8, 4);
    expect([...bytes]).toEqual([0xff, 0xff, 0xff, 0xff]); // −1, two's complement
    const decoded = decodeFrame(encodeFrame(frameOf(early)));
    expect(decoded.ok && decoded.frame.pings[0]?.deviceTime).toBe(BASE - 1);
  });
});

// ─── Round trip ─────────────────────────────────────────────────────────────

describe("round trip", () => {
  it("decodes exactly what quantize() predicts, for any valid frame", () => {
    fc.assert(
      fc.property(arbFrame, (frame) => {
        const result = decodeFrame(encodeFrame(frame));
        expect(result).toEqual({ ok: true, frame: { ...frame, pings: frame.pings.map(quantize) } });
      }),
    );
  });

  it("loses at most half a unit of precision per field", () => {
    fc.assert(
      fc.property(pingAt(BASE), (ping) => {
        const q = quantize(ping);
        expect(Math.abs(q.lat - ping.lat)).toBeLessThanOrEqual(0.5e-6 + 1e-12);
        expect(Math.abs(q.lon - ping.lon)).toBeLessThanOrEqual(0.5e-6 + 1e-12);
        expect(Math.abs(q.speed - ping.speed)).toBeLessThanOrEqual(0.005 + 1e-12);
      }),
    );
  });

  it("is stable: quantising a decoded ping changes nothing", () => {
    fc.assert(
      fc.property(pingAt(BASE), (ping) => {
        expect(quantize(quantize(ping))).toEqual(quantize(ping));
      }),
    );
  });

  it("never produces -0, which would fail Object.is after a round trip", () => {
    const q = quantize({ ...lagosPing, lat: -1e-7, lon: -1e-7 });
    expect(Object.is(q.lat, 0)).toBe(true);
    expect(Object.is(q.lon, 0)).toBe(true);
  });

  it("wraps a heading that rounds up to 360° back to north", () => {
    expect(quantize({ ...lagosPing, heading: 359.996 }).heading).toBe(0);
  });
});

// ─── Decoding hostile input ─────────────────────────────────────────────────

describe("decoding untrusted bytes", () => {
  it("never throws, whatever the bytes", () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 200 }), (bytes) => {
        expect(() => decodeFrame(bytes)).not.toThrow();
      }),
    );
  });

  it("rejects every truncation of a valid frame", () => {
    const whole = new Uint8Array(encodeFrame(frameOf(lagosPing, lagosPing)));
    for (let length = 0; length < whole.length; length++) {
      const result = decodeFrame(whole.slice(0, length));
      expect(result.ok, `length ${length}`).toBe(false);
    }
  });

  it("rejects trailing bytes rather than ignoring them", () => {
    const whole = new Uint8Array(encodeFrame(frameOf(lagosPing)));
    const padded = new Uint8Array(whole.length + 1);
    padded.set(whole);
    expect(decodeFrame(padded)).toMatchObject({ ok: false, error: { code: "length_mismatch" } });
  });

  it("names each failure", () => {
    const valid = () => new Uint8Array(encodeFrame(frameOf(lagosPing)));
    const withByte = (at: number, value: number) => {
      const bytes = valid();
      bytes[at] = value;
      return bytes;
    };
    const withView = (edit: (view: DataView) => void) => {
      const bytes = valid();
      edit(new DataView(bytes.buffer));
      return bytes;
    };

    expect(decodeFrame(new Uint8Array(19))).toMatchObject({ ok: false, error: { code: "too_short" } });
    expect(decodeFrame(withByte(0, 2))).toMatchObject({ ok: false, error: { code: "unsupported_version" } });
    expect(decodeFrame(withByte(1, 9))).toMatchObject({ ok: false, error: { code: "unknown_frame_type" } });
    expect(decodeFrame(withView((v) => v.setFloat64(8, Number.NaN, true)))).toMatchObject({
      ok: false,
      error: { code: "invalid_base_time" },
    });
    expect(decodeFrame(withView((v) => v.setInt32(HEADER_BYTES + 12, 91_000_000, true)))).toMatchObject({
      ok: false,
      error: { code: "value_out_of_range" },
    });
    expect(decodeFrame(withView((v) => v.setUint16(HEADER_BYTES + 22, 36_000, true)))).toMatchObject({
      ok: false,
      error: { code: "value_out_of_range" },
    });
  });

  it("reads a view that does not start at offset 0 of its buffer, as a Node Buffer from `ws` usually doesn't", () => {
    const frame = new Uint8Array(encodeFrame(frameOf(lagosPing)));
    const pool = new Uint8Array(frame.length + 64).fill(0xee);
    pool.set(frame, 32);
    const slice = pool.subarray(32, 32 + frame.length);

    expect(slice.byteOffset).toBe(32);
    expect(decodeFrame(slice)).toEqual({ ok: true, frame: { ...frameOf(lagosPing), pings: [quantize(lagosPing)] } });
  });
});

// ─── Encoding our own output ────────────────────────────────────────────────

describe("encoding", () => {
  const rejects = (patch: Partial<Ping>) => () => encodeFrame(frameOf({ ...lagosPing, ...patch }));

  it("throws on values the layout cannot carry, instead of wrapping them silently", () => {
    expect(rejects({ lat: 90.000001 })).toThrow(RangeError);
    expect(rejects({ lon: -180.5 })).toThrow(RangeError);
    expect(rejects({ heading: 360 })).toThrow(RangeError);
    expect(rejects({ speed: 655.36 })).toThrow(RangeError);
    expect(rejects({ speed: -1 })).toThrow(RangeError);
    expect(rejects({ vehicleId: -1 })).toThrow(RangeError);
    expect(rejects({ vehicleId: 2 ** 32 })).toThrow(RangeError);
    expect(rejects({ seq: 1.5 })).toThrow(RangeError);
    expect(rejects({ flags: 256 })).toThrow(RangeError);
    expect(rejects({ deviceTime: BASE + 0.5 })).toThrow(RangeError);
    expect(rejects({ deviceTime: BASE + 2 ** 31 })).toThrow(RangeError);
    expect(rejects({ lat: Number.NaN })).toThrow(RangeError);
  });

  it("rejects a non-integer baseTime", () => {
    expect(() => encodeFrame({ ...frameOf(), baseTime: BASE + 0.5 })).toThrow(RangeError);
  });
});

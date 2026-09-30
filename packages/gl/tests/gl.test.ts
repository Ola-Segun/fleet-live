import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { Feed, type ResolvedSample } from "@fleet/feed";
import { PingFlag } from "@fleet/protocol";
import { haversine, parseDataset } from "@fleet/routes";
import committed from "@fleet/routes/data/lagos-routes.json";
import { Simulation, buildNetwork } from "@fleet/sim";
import {
  DisplayClock,
  FLOATS_PER_VEHICLE,
  MODE_CODES,
  ORIGIN_X,
  ORIGIN_Y,
  SampleMirror,
  TEXTURE_WIDTH,
  gpuEstimate,
  mercatorX,
  mercatorY,
  packVehicle,
  rtcMatrix,
  texelOf,
  fromOffset,
  groupOf,
  modeMask,
  slotEstimate,
  slotOffset,
} from "../src";

const lagos = buildNetwork(parseDataset(committed));
const PEAK = Date.UTC(2026, 8, 29, 7, 0, 0);

const toLngLat = (dx: number, dy: number): [lat: number, lng: number] => {
  const x = dx + ORIGIN_X;
  const y = dy + ORIGIN_Y;
  const lat = (360 / Math.PI) * Math.atan(Math.exp(((180 - y * 360) * Math.PI) / 180)) - 90;
  return [lat, x * 360 - 180];
};

// ─── The two precision traps from the design, shown with Math.fround ───────

describe("precision", () => {
  it("absolute Mercator x in Lagos steps by ~2.4 m in float32; an offset from the origin steps by millimetres", () => {
    // The next float32 after a value, by incrementing its bit pattern: the smallest step float32 can take there.
    const nextFloat32 = (v: number) => {
      const bits = new Uint32Array(Float32Array.of(v).buffer);
      bits[0]! += 1;
      return new Float32Array(bits.buffer)[0]!;
    };
    const metresPerUnit = 40_075_016.686 * Math.cos((6.52 * Math.PI) / 180);
    const x = Math.fround(mercatorX(3.38));
    expect(nextFloat32(x) - x).toBe(2 ** -24); // x ≈ 0.509 is in [0.5, 1), where float32 steps by 2⁻²⁴
    expect((nextFloat32(x) - x) * metresPerUnit).toBeCloseTo(2.37, 2);

    // 22 km east, across the whole metro: the offset is ≈ 5.6 × 10⁻⁴, in [2⁻¹¹, 2⁻¹⁰), where float32
    // steps by 2⁻³⁴ ≈ 5.8 × 10⁻¹¹ of the world, about 2.3 mm. A thousand times finer than absolute x.
    const offset = Math.fround(mercatorX(3.38 + 0.2) - ORIGIN_X);
    expect(nextFloat32(offset) - offset).toBe(2 ** -34);
    expect((nextFloat32(offset) - offset) * metresPerUnit).toBeCloseTo(0.0023, 4);
  });

  it("epoch seconds in float32 step by 128 s; session seconds after a whole day step by 1/128 s", () => {
    const epochSeconds = 1.7e9;
    expect(Math.fround(epochSeconds + 60)).toBe(Math.fround(epochSeconds)); // a whole minute vanishes
    const aDay = 86_400;
    expect(Math.fround(aDay + 1 / 128)).not.toBe(Math.fround(aDay));
  });
});

// ─── Packing ────────────────────────────────────────────────────────────────

const sample = (seq: number, overrides: Partial<ResolvedSample> = {}): ResolvedSample => ({
  seq,
  deviceTime: 0,
  receivedAt: 0,
  lat: 6.5,
  lon: 3.4,
  speed: 10,
  heading: 0,
  flags: PingFlag.Ignition,
  vx: 0,
  vy: 10,
  time: 1_000_000 + seq * 1000,
  smoothLat: 6.5 + seq * 1e-4,
  smoothLon: 3.4,
  ...overrides,
});

describe("packing a vehicle", () => {
  it("keeps the newest 8, oldest first, padding a short track by repeating its oldest sample", () => {
    const out = new Float32Array(FLOATS_PER_VEHICLE);
    packVehicle([sample(0), sample(1), sample(2)], 1_000_000, out, 0);
    const times = Array.from({ length: 8 }, (_, k) => out[k * 4 + 2]);
    expect(times).toEqual([0, 0, 0, 0, 0, 0, 1, 2]); // seconds since the epoch
    expect(out[8 * 4 + 3]).toBe(3); // sample count
    packVehicle(Array.from({ length: 12 }, (_, i) => sample(i)), 1_000_000, out, 0);
    expect(out[2]).toBe(4); // oldest kept is sample 4
    expect(out[7 * 4 + 2]).toBe(11);
  });

  it("stores velocity in Mercator units, with north as negative y, on the feed's own sphere", () => {
    const out = new Float32Array(FLOATS_PER_VEHICLE);
    packVehicle([sample(0, { vx: 0, vy: 10 })], 1_000_000, out, 0);
    expect(out[8 * 4]).toBeCloseTo(0, 12);
    expect(out[8 * 4 + 1]).toBeLessThan(0);
    // 10 m/s north for 1 s is 10 m: converting back through the origin gives 10 m of latitude.
    const dy = out[8 * 4 + 1]!;
    const [latA] = toLngLat(0, 0);
    const [latB] = toLngLat(0, dy);
    expect(haversine([latA, 3.38], [latB, 3.38])).toBeCloseTo(10, 3);
  });

  it("flags a truck as parked when its ignition is off or it isn't moving", () => {
    const out = new Float32Array(FLOATS_PER_VEHICLE);
    packVehicle([sample(0, { flags: 0 })], 0, out, 0);
    expect(out[8 * 4 + 2]).toBe(1);
    packVehicle([sample(0, { speed: 0.2 })], 0, out, 0);
    expect(out[8 * 4 + 2]).toBe(1);
    packVehicle([sample(0)], 0, out, 0);
    expect(out[8 * 4 + 2]).toBe(0);
  });
});

// ─── The GPU agrees with the feed ───────────────────────────────────────────

describe("gpuEstimate, the shader's algorithm", () => {
  it("puts every truck where Layer 4's estimate() does, in the same mode, to within 5 cm", { timeout: 30_000 }, () => {
    const sim = new Simulation(lagos, { seed: 21, vehicleCount: 150, startTime: PEAK });
    const feed = new Feed();
    for (const f of sim.advance(180_000)) feed.ingest(f);
    const epoch = PEAK;
    const out = new Float32Array(FLOATS_PER_VEHICLE);
    let compared = 0;
    let worst = 0;
    const modesSeen = new Set<number>();

    for (const id of feed.vehicleIds()) {
      const track = feed.track(id)!;
      const samples = track.resolve();
      packVehicle(samples, epoch, out, 0);
      // Times from the oldest sample the GPU keeps to 15 s past the newest: interpolation,
      // extrapolation, holding and staleness are all exercised.
      const oldest = samples[Math.max(0, samples.length - 8)]!.time;
      const newest = samples.at(-1)!.time;
      for (let i = 0; i <= 40; i++) {
        const t = oldest + ((newest + 15_000 - oldest) * i) / 40;
        const expected = track.estimate(t)!;
        const actual = gpuEstimate(out, 0, (t - epoch) / 1000)!;
        const [lat, lng] = toLngLat(actual.x, actual.y);
        const error = haversine([lat, lng], [expected.lat, expected.lon]);
        worst = Math.max(worst, error);
        expect(actual.mode, `vehicle ${id} at +${t - oldest} ms`).toBe(MODE_CODES[expected.mode]);
        modesSeen.add(actual.mode);
        compared++;
      }
    }
    expect(compared).toBeGreaterThan(5000);
    expect(worst).toBeLessThan(0.05);
    for (const m of [MODE_CODES.interpolated, MODE_CODES.extrapolated, MODE_CODES.holding, MODE_CODES.parked, MODE_CODES.stale]) {
      expect(modesSeen.has(m), `mode ${m} exercised`).toBe(true);
    }
  });
});

// ─── Matrix ─────────────────────────────────────────────────────────────────

describe("RTC matrix", () => {
  it("maps an offset to exactly where the original matrix maps the absolute position", () => {
    fc.assert(
      fc.property(
        fc.array(fc.double({ min: -1e6, max: 1e6, noNaN: true }), { minLength: 16, maxLength: 16 }),
        fc.double({ min: -0.01, max: 0.01, noNaN: true }),
        fc.double({ min: -0.01, max: 0.01, noNaN: true }),
        (m, dx, dy) => {
          const rtc = Array.from(rtcMatrix(m, new Float64Array(16)));
          const apply = (mat: number[], x: number, y: number) => [0, 1, 2, 3].map((r) => mat[r]! * x + mat[4 + r]! * y + mat[12 + r]!);
          const a = apply(rtc, dx, dy);
          const b = apply(m, ORIGIN_X + dx, ORIGIN_Y + dy);
          a.forEach((v, i) => expect(v).toBeCloseTo(b[i]!, 3));
        },
      ),
    );
  });
});

// ─── The page's texture copy ────────────────────────────────────────────────

describe("sample mirror", () => {
  it("writes each vehicle's floats where the shader will fetch them", () => {
    const mirror = new SampleMirror(1000);
    const rows = new Float32Array(2 * FLOATS_PER_VEHICLE).map((_, i) => i);
    mirror.apply(Uint32Array.from([0, 205]), rows, 206);
    const [x, y] = texelOf(205, 0);
    expect([x, y]).toEqual([5 * 9, 1]); // slot 205 is the 6th vehicle of row 1
    const at = (y * TEXTURE_WIDTH + x) * 4;
    expect(mirror.data[at]).toBe(FLOATS_PER_VEHICLE); // first float of the second row sent
    expect(mirror.data[0]).toBe(0);
    expect(mirror.dirty).toBe(true);
  });

  it("grows by whole rows without moving existing vehicles", () => {
    const mirror = new SampleMirror(200);
    mirror.apply(Uint32Array.from([7]), new Float32Array(FLOATS_PER_VEHICLE).fill(3), 8);
    mirror.apply(Uint32Array.from([450]), new Float32Array(FLOATS_PER_VEHICLE).fill(5), 451);
    expect(mirror.capacity).toBe(600);
    expect(mirror.data[7 * FLOATS_PER_VEHICLE]).toBe(3);
  });
});

// ─── The display clock ──────────────────────────────────────────────────────

describe("display clock", () => {
  it("never goes backwards, however the reports jitter", () => {
    fc.assert(
      fc.property(fc.array(fc.tuple(fc.integer({ min: 0, max: 300 }), fc.integer({ min: 1, max: 40 })), { minLength: 5, maxLength: 200 }), (steps) => {
        const clock = new DisplayClock();
        let local = 0;
        let server = 1_000_000;
        let previous = -Infinity;
        for (const [lateness, frameMs] of steps) {
          local += frameMs;
          server += frameMs;
          if (local % 100 < frameMs) clock.report(server - lateness, 1400, local);
          const now = clock.now(local);
          if (now === undefined) continue;
          expect(now).toBeGreaterThanOrEqual(previous);
          previous = now;
        }
      }),
    );
  });

  it("steers towards a new offset by at most 10% of elapsed time", () => {
    const clock = new DisplayClock();
    clock.report(10_000, 1000, 0);
    expect(clock.now(0)).toBe(9000);
    clock.report(10_000 + 1000 + 500, 1000, 1000); // reports now say server is 500 ms further ahead
    expect(clock.now(1000)).toBeCloseTo(10_000 + 100, 6); // 1000 ms elapsed → at most 100 ms of correction
    // 5 s more → up to 500 ms of correction, which covers the remaining 400: offset is now 10,500.
    // Display = local 6,000 + offset 10,500 − delay 1,000 = 15,500.
    expect(clock.now(6000)).toBeCloseTo(15_500, 6);
  });

  it("jumps rather than slewing through a gap of minutes", () => {
    const clock = new DisplayClock();
    clock.report(0, 1000, 0);
    clock.now(0);
    clock.report(600_000, 1000, 100); // ten minutes later on the server
    expect(clock.now(100)).toBeCloseTo(599_000, 6);
  });
});

// ─── Helpers for picking, following and filtering ───────────────────────────

describe("picking and filtering helpers", () => {
  it("slotOffset points at the same float as texelOf", () => {
    for (const slot of [0, 1, 199, 200, 4999]) {
      const [x, y] = texelOf(slot, 0);
      expect(slotOffset(slot)).toBe((y * TEXTURE_WIDTH + x) * 4);
    }
  });

  it("fromOffset inverts the packing to within a millionth of a degree", () => {
    const places: [number, number][] = [[6.52, 3.38], [6.45, 3.36], [6.6, 3.1], [6.43, 4.01]];
    for (const [lat, lon] of places) {
      const [la, lo] = fromOffset(mercatorX(lon) - ORIGIN_X, mercatorY(lat) - ORIGIN_Y);
      expect(la).toBeCloseTo(lat, 9);
      expect(lo).toBeCloseTo(lon, 9);
    }
  });

  it("slotEstimate reads a truck out of a mirror exactly as gpuEstimate does", () => {
    const mirror = new SampleMirror(400);
    const row = new Float32Array(FLOATS_PER_VEHICLE);
    packVehicle([sample(0), sample(1), sample(2)], 1_000_000, row, 0);
    mirror.apply(Uint32Array.from([237]), row, 238);
    const e = slotEstimate(mirror.data, 237, 1.5)!;
    const direct = gpuEstimate(row, 0, 1.5)!;
    expect(e.mode).toBe(direct.mode);
    expect([e.lat, e.lon]).toEqual(fromOffset(direct.x, direct.y));
    expect(slotEstimate(mirror.data, 5, 1.5)).toBeUndefined(); // an empty slot
  });

  it("builds a status mask the shader can test with one bit shift", () => {
    const mask = modeMask(["parked"]);
    const visible = (mode: number) => ((mask >> mode) & 1) === 1;
    expect(visible(MODE_CODES.parked)).toBe(true);
    expect(visible(MODE_CODES.interpolated)).toBe(false);
    expect(visible(MODE_CODES.stale)).toBe(false);
    expect(visible(MODE_CODES.waiting)).toBe(true); // always shown
    expect(groupOf(MODE_CODES.holding)).toBe("moving");
    expect(groupOf(MODE_CODES.waiting)).toBeUndefined();
  });
});

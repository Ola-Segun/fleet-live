import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { FLOATS_PER_VEHICLE, MODE_CODES, METRES_PER_DEG, ORIGIN_LAT, ORIGIN_LNG, packVehicle, slotEstimate } from "@fleet/gl";
import { haversine } from "@fleet/routes";
import { History, ReplayView, type HistoryFrameInput } from "../src";

const T0 = 1_000_000_000_000; // whole seconds: the session epoch below
const KX = METRES_PER_DEG * Math.cos((ORIGIN_LAT * Math.PI) / 180);

interface Truck {
  id: number;
  east: number;
  kmh?: number;
  mode?: keyof typeof MODE_CODES;
  ignition?: boolean;
}

/** One frame of the fleet at `time`: trucks on a line due east of the origin. */
function frame(time: number, trucks: Truck[]): HistoryFrameInput {
  const n = trucks.length;
  return {
    displayTime: time,
    count: n,
    ids: Uint32Array.from(trucks.map((t) => t.id)),
    lat: new Float64Array(n).fill(ORIGIN_LAT),
    lon: Float64Array.from(trucks.map((t) => ORIGIN_LNG + t.east / KX)),
    heading: new Float32Array(n).fill(90),
    speed: Float32Array.from(trucks.map((t) => (t.kmh ?? 36) / 3.6)),
    mode: Uint8Array.from(trucks.map((t) => MODE_CODES[t.mode ?? "interpolated"])),
    ignition: Uint8Array.from(trucks.map((t) => (t.ignition ?? true ? 1 : 0))),
  };
}

/** `frames` frames 5 s apart; truck 1 drives east at 10 m/s, and `absent(k)` frames leave it out. */
function drive(history: History, frames: number, absent: (k: number) => boolean = () => false) {
  for (let k = 0; k < frames; k++) history.record(frame(T0 + k * 5000, absent(k) ? [] : [{ id: 1, east: k * 50 }]));
}

const eastOf = (lon: number) => (lon - ORIGIN_LNG) * KX;

describe("the history", () => {
  it("stores positions to within 1.1 m (16-bit steps of 2 × 10⁻⁵°)", () => {
    fc.assert(
      fc.property(fc.double({ min: -0.6, max: 0.6, noNaN: true }), fc.double({ min: -0.6, max: 0.6, noNaN: true }), (dLat, dLon) => {
        const h = new History();
        const truth: [number, number] = [ORIGIN_LAT + dLat, ORIGIN_LNG + dLon];
        for (let k = 0; k < 2; k++) {
          const f = frame(T0 + k * 5000, [{ id: 1, east: 0 }]);
          f.lat[0] = truth[0];
          f.lon[0] = truth[1];
          h.record(f);
        }
        const [s] = h.window(1, T0).samples;
        expect(haversine(truth, [s!.smoothLat, s!.smoothLon])).toBeLessThan(1.6); // √2 × 1.1 m at worst, diagonally
      }),
    );
  });

  it("packs 8 frames starting one before the time asked for, and says how long they stay right", () => {
    const h = new History();
    drive(h, 20);
    const w = h.window(1, T0 + 5 * 5000 + 1200);
    expect(w.samples.map((s) => (s.time - T0) / 5000)).toEqual([4, 5, 6, 7, 8, 9, 10, 11]);
    expect([w.validFrom, w.validTo]).toEqual([T0 + 4 * 5000, T0 + 11 * 5000]);
  });

  it("near the newest frame, stays right only until the next frame is recorded", () => {
    const h = new History();
    drive(h, 10);
    const w = h.window(1, T0 + 9 * 5000 + 100);
    expect(w.samples.at(-1)!.time).toBe(T0 + 9 * 5000);
    expect(w.validTo).toBe(T0 + 10 * 5000);
  });

  it("in a gap, packs the run before it, valid until the data resumes", () => {
    const h = new History();
    drive(h, 20, (k) => k >= 10 && k < 15);
    const w = h.window(1, T0 + 12 * 5000);
    expect(w.samples.at(-1)!.time).toBe(T0 + 9 * 5000);
    expect(w.validTo).toBe(T0 + 15 * 5000);
  });

  it("gives nothing before a truck's first data, so it isn't drawn", () => {
    const h = new History();
    drive(h, 10, (k) => k < 4);
    const w = h.window(1, T0 + 2 * 5000);
    expect(w.samples).toEqual([]);
    expect(w.validTo).toBe(T0 + 4 * 5000);
  });

  it("breaks a run where frames were skipped (a sleeping tab), rather than gliding across the hole", () => {
    const h = new History();
    for (const k of [0, 1, 2, 3, 20, 21, 22]) h.record(frame(T0 + k * 5000, [{ id: 1, east: k * 50 }]));
    const w = h.window(1, T0 + 3 * 5000 + 1000);
    expect(w.samples.map((s) => (s.time - T0) / 5000)).toEqual([2, 3]); // the run ends at 3: one frame before it, as always
    expect(w.validTo).toBe(T0 + 20 * 5000);
  });

  it("records nothing for a truck whose estimate was holding or stale then", () => {
    const h = new History();
    h.record(frame(T0, [{ id: 1, east: 0 }]));
    h.record(frame(T0 + 5000, [{ id: 1, east: 50, mode: "stale" }]));
    h.record(frame(T0 + 10_000, [{ id: 1, east: 100, mode: "holding" }]));
    expect(h.window(1, T0 + 10_000).samples.map((s) => s.time)).toEqual([T0]);
  });

  it("keeps only its capacity, overwriting the oldest", () => {
    const h = new History({ intervalMs: 5000, capacityMs: 50_000 });
    drive(h, 25);
    expect(h.length).toBe(10);
    expect(h.range()).toEqual({ from: T0 + 15 * 5000, to: T0 + 24 * 5000 });
    expect(h.window(1, T0).samples).toEqual([]); // evicted
  });

  it("skips the empty frames a session starts with, but records an empty frame later (a real gap)", () => {
    const h = new History();
    h.record(frame(T0, []));
    h.record(frame(T0 + 5000, [{ id: 1, east: 0, mode: "waiting" }]));
    expect(h.length).toBe(0);
    h.record(frame(T0 + 10_000, [{ id: 1, east: 0 }]));
    h.record(frame(T0 + 15_000, []));
    expect(h.length).toBe(2);
  });

  it("asks to record once per interval, skipping intervals it missed", () => {
    const h = new History();
    expect(h.due(T0 + 7300)).toBe(T0 + 5000);
    h.record(frame(T0 + 5000, [{ id: 1, east: 0 }]));
    expect(h.due(T0 + 9900)).toBeUndefined();
    expect(h.due(T0 + 61_000)).toBe(T0 + 60_000);
  });

  it("costs 7 bytes per truck per frame (allocated with a quarter to spare)", () => {
    const h = new History();
    const fleet = Array.from({ length: 1000 }, (_, id) => ({ id, east: id }));
    for (let k = 0; k < 4; k++) h.record(frame(T0 + k * 5000, fleet));
    expect(h.stats()).toMatchObject({ frames: 4, vehicles: 1000, bytes: 4 * 1250 * 7, clamped: 0 });
  });
});

describe("packing rows straight from the frames", () => {
  it("writes exactly what packVehicle writes from the same frames, in every case: running, gap, parked, before data", () => {
    const h = new History();
    for (let k = 0; k < 60; k++) {
      const trucks: Truck[] = [];
      if (k >= 5 && !(k >= 20 && k < 26)) trucks.push({ id: 1, east: k * 47, kmh: 34 });
      trucks.push(k < 30 ? { id: 2, east: 900, kmh: 0, mode: "parked", ignition: false } : { id: 2, east: 900 + (k - 29) * 30, kmh: 22 });
      h.record(frame(T0 + k * 5000, trucks));
    }
    const a = new Float32Array(FLOATS_PER_VEHICLE);
    const b = new Float32Array(FLOATS_PER_VEHICLE);
    for (let t = T0; t < T0 + 62 * 5000; t += 1700) {
      for (const id of [1, 2]) {
        const direct = h.packInto(id, t, T0, a, 0);
        const w = h.window(id, t);
        packVehicle(w.samples, T0, b, 0);
        expect([direct.validFrom, direct.validTo]).toEqual([w.validFrom, w.validTo]);
        for (let i = 0; i < FLOATS_PER_VEHICLE; i++) expect(a[i]).toBeCloseTo(b[i]!, 9);
      }
    }
  });
});

describe("a parked truck in replay", () => {
  it("is drawn parked, and packed once per 45 s while it stays parked, not once per frame", () => {
    const h = new History();
    // Parked for frames 0–29, then drives off.
    for (let k = 0; k < 40; k++) h.record(frame(T0 + k * 5000, [k < 30 ? { id: 1, east: 0, kmh: 0, mode: "parked", ignition: false } : { id: 1, east: (k - 29) * 50 }]));
    const view = new ReplayView(h, T0);
    const slots = new Map([[1, 0]]);
    const at = (t: number) => ({ rows: view.update(t, slots).slots.length, e: slotEstimate(view.mirror.data, 0, (t - T0) / 1000)! });
    let packs = 0;
    for (let k = 2; k < 30; k++) {
      const { rows, e } = at(T0 + k * 5000 + 2500);
      packs += rows;
      expect(e.mode).toBe(MODE_CODES.parked); // never "interpolated", and never stale: refreshed inside 90 s
    }
    expect(packs).toBe(4); // 140 s parked: at 12.5 s, then every 45 s
    expect(at(T0 + 32 * 5000 + 2500)).toMatchObject({ rows: 1, e: { mode: MODE_CODES.interpolated } });
  });
});

describe("the replay view", () => {
  const slots = new Map([[1, 0]]);

  it("draws the recorded path through the shader's own algorithm", () => {
    const h = new History();
    drive(h, 20);
    const view = new ReplayView(h, T0);
    const t = T0 + 7 * 5000 + 2500; // halfway between frames 7 and 8: 375 m east
    view.update(t, slots);
    const e = slotEstimate(view.mirror.data, 0, (t - T0) / 1000)!;
    expect(e.mode).toBe(MODE_CODES.interpolated);
    expect(Math.abs(eastOf(e.lon) - 375)).toBeLessThan(1.2); // within the storage step
  });

  it("repacks a truck only when time leaves its samples", () => {
    const h = new History();
    drive(h, 40);
    const view = new ReplayView(h, T0);
    expect(view.update(T0 + 10 * 5000, slots).slots.length).toBe(1);
    expect(view.update(T0 + 12 * 5000, slots).slots.length).toBe(0); // still inside frames 9–16
    expect(view.update(T0 + 16 * 5000 + 1, slots).slots.length).toBe(1); // past the last packed frame
    expect(view.update(T0 + 3 * 5000, slots).slots.length).toBe(1); // a jump back
    view.invalidateAll();
    expect(view.update(T0 + 3 * 5000, slots).slots.length).toBe(1);
  });

  it("shows a truck as stale in a long gap, as live would, and hides it before its first data", () => {
    const h = new History();
    drive(h, 30, (k) => k < 3 || (k >= 10 && k < 20));
    const view = new ReplayView(h, T0);
    const at = (t: number) => {
      view.update(t, slots);
      return slotEstimate(view.mirror.data, 0, (t - T0) / 1000);
    };
    expect(at(T0 + 5000)).toBeUndefined();
    expect(at(T0 + 15 * 5000)!.mode).toBe(MODE_CODES.stale);
    expect(at(T0 + 25 * 5000)!.mode).toBe(MODE_CODES.interpolated);
  });

  it("gives the list and details panel what the map draws: position, speed, age, ignition", () => {
    const h = new History();
    for (let k = 0; k < 10; k++) h.record(frame(T0 + k * 5000, [{ id: 1, east: k * 50, kmh: 36 }, { id: 2, east: 0, kmh: 0, mode: "parked", ignition: false }]));
    const view = new ReplayView(h, T0);
    const both = new Map([[1, 0], [2, 1]]);
    const t = T0 + 4 * 5000 + 1000;
    view.update(t, both);
    const snap = view.snapshot(t, both);
    expect(Array.from(snap.ids)).toEqual([1, 2]);
    expect(Math.abs(eastOf(snap.lon[0]!) - 210)).toBeLessThan(1.2); // within the storage step
    expect(snap.speed[0]).toBeCloseTo(10, 5);
    expect(snap.ageMs[0]).toBeCloseTo(1000, 0);
    expect([snap.ignition[0], snap.ignition[1]]).toEqual([1, 0]);
    expect(snap.mode[1]).toBe(MODE_CODES.parked);
  });
});

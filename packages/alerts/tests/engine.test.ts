import { describe, expect, it } from "vitest";
import { createRng } from "@fleet/sim";
import { AlertEngine, DEFAULT_RULES, type AlertRules } from "../src";
import { frame, square, zone, type TruckAt } from "./helpers";

/** Run `seconds` of evaluations at 2 Hz, the Worker's rate, with trucks placed by `trucksAt(t)`. */
function run(engine: AlertEngine, fromMs: number, seconds: number, trucksAt: (t: number) => TruckAt[]): number {
  let t = fromMs;
  for (let k = 0; k < seconds * 2; k++) engine.evaluate(frame((t += 500), trucksAt(t)));
  return t;
}

const kinds = (engine: AlertEngine) => engine.alerts().map((a) => `${a.kind}${a.active ? "" : " (cleared)"}`);

describe("zone alerts", () => {
  it("don't fire for a truck parked by the edge with GPS noise, which fires every few seconds without the margin and dwell", () => {
    // Parked 5 m inside the edge, with the simulator's 4 m GPS noise on each axis: the case the rules exist for.
    const jittery = (rules: AlertRules) => {
      const engine = new AlertEngine(rules);
      engine.setZones([zone("z", square(1000), { alertOnExit: true })]);
      const noise = createRng(42);
      run(engine, 0, 600, () => [{ id: 1, east: 995 + noise.normal(0, 4), north: 500 + noise.normal(0, 4), kmh: 0, mode: "parked" }]);
      return engine.stats.raised;
    };
    expect(jittery(DEFAULT_RULES)).toBe(0);
    expect(jittery({ ...DEFAULT_RULES, marginM: 0, dwellMs: 0 })).toBeGreaterThan(100);
  });

  it("raise an entry once the truck is 20 m inside for 10 s, and clear it when it leaves", () => {
    const engine = new AlertEngine();
    engine.setZones([zone("z", square(1000))]);
    // Driving east at 10 m/s from 200 m west of the zone, straight through it.
    let entered = NaN;
    let t = 0;
    for (let k = 0; k < 300; k++) {
      t += 500;
      const east = -200 + (t / 1000) * 10;
      engine.evaluate(frame(t, [{ id: 7, east, north: 500 }]));
      if (Number.isNaN(entered) && engine.alerts().length > 0) entered = east;
    }
    // 20 m of margin, then 10 s at 10 m/s = 100 m more: confirmed about 120 m in.
    expect(entered).toBeGreaterThanOrEqual(120);
    expect(entered).toBeLessThan(126);
    expect(kinds(engine)).toEqual(["zone-enter (cleared)"]);
    expect(engine.alerts()[0]).toMatchObject({ vehicleId: 7, zoneId: "z", occurrences: 1 });
  });

  it("don't count a truck already inside a newly drawn zone as entering it, but do count it inside", () => {
    const engine = new AlertEngine();
    engine.evaluate(frame(0, [{ id: 1, east: 500, north: 500 }]));
    engine.setZones([zone("z", square(1000))]);
    run(engine, 0, 30, () => [{ id: 1, east: 500, north: 500 }]);
    expect(engine.alerts()).toEqual([]);
    expect(engine.zoneCounts()).toEqual([["z", 1]]);
  });

  it("hold their state while a truck is stale: a guessed position starts no change", () => {
    const engine = new AlertEngine();
    engine.setZones([zone("z", square(1000))]);
    run(engine, 0, 5, () => [{ id: 1, east: -100, north: 500 }]);
    run(engine, 5_000, 60, () => [{ id: 1, east: 500, north: 500, mode: "stale", ageMs: 20_000 }]);
    expect(engine.alerts()).toEqual([]);
  });

  it("keep a zone's state through a rename, and clear its alerts when it is reshaped or removed", () => {
    const engine = new AlertEngine();
    engine.setZones([zone("z", square(1000))]);
    let t = run(engine, 0, 5, () => [{ id: 1, east: -100, north: 500 }]);
    t = run(engine, t, 20, () => [{ id: 1, east: 500, north: 500 }]);
    expect(kinds(engine)).toEqual(["zone-enter"]);
    engine.setZones([zone("z", square(1000), { name: "renamed" })]);
    run(engine, t, 5, () => [{ id: 1, east: 500, north: 500 }]);
    expect(kinds(engine)).toEqual(["zone-enter"]);
    engine.setZones([]);
    expect(kinds(engine)).toEqual(["zone-enter (cleared)"]);
  });

  it("raise exit alerts for a zone watched for leaving, such as a depot", () => {
    const engine = new AlertEngine();
    engine.setZones([zone("depot", square(1000), { kind: "depot", alertOnEnter: false, alertOnExit: true })]);
    let t = run(engine, 0, 5, () => [{ id: 3, east: 500, north: 500 }]);
    t = run(engine, t, 20, () => [{ id: 3, east: 1200, north: 500 }]);
    expect(kinds(engine)).toEqual(["zone-exit"]);
    run(engine, t, 20, () => [{ id: 3, east: 500, north: 500 }]);
    expect(kinds(engine)).toEqual(["zone-exit (cleared)"]);
  });
});

describe("speeding alerts", () => {
  it("need 10 s over the limit, report the peak, and end only below 55 km/h", () => {
    const engine = new AlertEngine();
    let t = run(engine, 0, 8, () => [{ id: 1, kmh: 70 }]);
    run(engine, t, 5, () => [{ id: 1, kmh: 50 }]);
    expect(engine.alerts()).toEqual([]); // 8 s over wasn't enough

    t = run(engine, 20_000, 12, () => [{ id: 1, kmh: 72 }]);
    t = run(engine, t, 3, () => [{ id: 1, kmh: 78 }]);
    expect(engine.alerts()[0]).toMatchObject({ kind: "speeding", active: true, detail: 78 });
    t = run(engine, t, 30, () => [{ id: 1, kmh: 58 }]); // under the limit, but not under 55
    expect(engine.alerts()[0]!.active).toBe(true);
    run(engine, t, 11, () => [{ id: 1, kmh: 40 }]);
    expect(engine.alerts()[0]!.active).toBe(false);
  });

  it("raise the same alert again when it happens again, and un-acknowledge it", () => {
    const engine = new AlertEngine();
    let t = run(engine, 0, 12, () => [{ id: 1, kmh: 70 }]);
    t = run(engine, t, 12, () => [{ id: 1, kmh: 40 }]);
    const [first] = engine.alerts();
    expect(engine.acknowledge(first!.id)).toBe(true);
    run(engine, t, 12, () => [{ id: 1, kmh: 70 }]);
    expect(engine.alerts()).toHaveLength(1);
    expect(engine.alerts()[0]).toMatchObject({ id: first!.id, occurrences: 2, active: true });
    expect(engine.alerts()[0]!.acknowledgedAt).toBeUndefined();
  });
});

describe("offline alerts", () => {
  it("fire after 2 minutes of silence when the last report had the ignition on", () => {
    const engine = new AlertEngine();
    engine.evaluate(frame(1_000, [{ id: 1, mode: "interpolated", ageMs: 500 }]));
    engine.evaluate(frame(100_000, [{ id: 1, mode: "stale", ignition: true, ageMs: 99_500 }]));
    expect(engine.alerts()).toEqual([]);
    engine.evaluate(frame(121_000, [{ id: 1, mode: "stale", ignition: true, ageMs: 120_500 }]));
    expect(engine.alerts()[0]).toMatchObject({ kind: "offline", active: true, detail: 500 });
    engine.evaluate(frame(122_000, [{ id: 1, mode: "interpolated", ageMs: 400 }]));
    expect(engine.alerts()[0]!.active).toBe(false);
  });

  it("wait 10 minutes when the ignition was off, because the tracker reports less often", () => {
    const engine = new AlertEngine();
    engine.evaluate(frame(1_000, [{ id: 1, mode: "parked", kmh: 0, ageMs: 5_000 }]));
    engine.evaluate(frame(200_000, [{ id: 1, mode: "stale", ignition: false, kmh: 0, ageMs: 180_000 }]));
    expect(engine.alerts()).toEqual([]);
    engine.evaluate(frame(700_000, [{ id: 1, mode: "stale", ignition: false, kmh: 0, ageMs: 601_000 }]));
    expect(kinds(engine)).toEqual(["offline"]);
  });

  it("give a truck stopped in traffic, engine running, the 2-minute rule (the evaluation's four misses)", () => {
    // Speed 0 makes the feed call it "parked", but the ignition is on, so its tracker was reporting every second.
    const engine = new AlertEngine();
    engine.evaluate(frame(1_000, [{ id: 1, mode: "parked", ignition: true, kmh: 0, ageMs: 500 }]));
    engine.evaluate(frame(122_000, [{ id: 1, mode: "stale", ignition: true, kmh: 0, ageMs: 121_500 }]));
    expect(kinds(engine)).toEqual(["offline"]);
  });
});

describe("the alert list", () => {
  it("drops a resolved alert, and raises a new one if the condition comes back later", () => {
    const engine = new AlertEngine();
    let t = run(engine, 0, 12, () => [{ id: 1, kmh: 70 }]);
    const [first] = engine.alerts();
    expect(engine.resolve(first!.id)).toBe(true);
    expect(engine.alerts()).toEqual([]);
    t = run(engine, t, 12, () => [{ id: 1, kmh: 70 }]); // still speeding: resolved means dealt with, not re-raised
    expect(engine.alerts()).toEqual([]);
    t = run(engine, t, 12, () => [{ id: 1, kmh: 40 }]);
    run(engine, t, 12, () => [{ id: 1, kmh: 70 }]);
    expect(engine.alerts()).toHaveLength(1);
    expect(engine.alerts()[0]!.id).not.toBe(first!.id);
  });

  it("resolves the oldest cleared alerts past the cap, and never an active one", () => {
    const engine = new AlertEngine({ ...DEFAULT_RULES, maxOpen: 3 });
    // Five trucks speed, one after another; the first three stop.
    const fleet = (fast: number[]) => [1, 2, 3, 4, 5].map((id) => ({ id, kmh: fast.includes(id) ? 70 : 40 }));
    let t = run(engine, 0, 12, () => fleet([1, 2, 3]));
    t = run(engine, t, 12, () => fleet([]));
    run(engine, t, 12, () => fleet([4, 5]));
    expect(engine.alerts().map((a) => [a.vehicleId, a.active])).toEqual([
      [5, true],
      [4, true],
      [3, false],
    ]);
    expect(engine.stats.autoResolved).toBe(2);

    const all = new AlertEngine({ ...DEFAULT_RULES, maxOpen: 3 });
    run(all, 0, 12, () => fleet([1, 2, 3, 4, 5]));
    expect(all.alerts()).toHaveLength(5); // all active: over the cap rather than hide one
  });

  it("reports what was raised since it was last asked, for announcing", () => {
    const engine = new AlertEngine();
    run(engine, 0, 12, () => [{ id: 1, kmh: 70 }, { id: 2, kmh: 70 }]);
    expect(engine.drainRaised().map((a) => a.vehicleId).sort()).toEqual([1, 2]);
    expect(engine.drainRaised()).toEqual([]);
  });
});

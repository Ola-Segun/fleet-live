import { describe, expect, it } from "vitest";
import { PingFlag, decodeFrame, encodeFrame, quantize, type Frame, type Ping } from "@fleet/protocol";
import { haversine } from "@fleet/routes";
import { DEFAULT_DEVICE, NO_CHAOS, Simulation, Vehicle, createRng, positionAt, stoppingLimit, type DeviceConfig } from "../src";
import { MORNING_PEAK, NIGHT, lagos, straightNetwork } from "./helpers";

const QUIET_DEVICE: DeviceConfig = { ...DEFAULT_DEVICE, gpsSigmaM: 0, skewedShare: 0, normalSkewSdMs: 0, gapZoneCount: 0 };

/** A truck at the start of A → B on the straight test road, at rest. */
function truckAtStart(device: DeviceConfig = QUIET_DEVICE, start = NIGHT) {
  const network = straightNetwork();
  const vehicle = new Vehicle({ id: 0, plate: "T", driver: "T" }, createRng(1), createRng(2), network, device, start);
  vehicle.path = network.paths[0]!;
  vehicle.distanceAlong = 0;
  vehicle.speed = 0;
  vehicle.status = "moving";
  return { vehicle, network };
}

const pingsOf = (frames: Frame[]): Ping[] => frames.flatMap((f) => f.pings);

// ─── One truck ──────────────────────────────────────────────────────────────

describe("a truck", () => {
  it("accelerates at 0.6 m/s²: after 5 s it does 3.0 m/s and has covered 7.65 m", () => {
    const { vehicle } = truckAtStart();
    // 50 steps of 0.1 s; speed after step k is 0.06k m/s; distance is Σ 0.06k × 0.1 = 0.006 × 1275.
    for (let k = 1; k <= 50; k++) vehicle.drive(NIGHT + k * 100, 100);
    expect(vehicle.speed).toBeCloseTo(3.0, 9);
    expect(vehicle.distanceAlong).toBeCloseTo(7.65, 9);
  });

  it("brakes into its destination, stops exactly at the end, then loads", () => {
    const { vehicle, network } = truckAtStart();
    let t = NIGHT;
    let previous = 0;
    let lastRollingSpeed = Infinity;
    while (vehicle.status === "moving") {
      t += 100;
      const remaining = network.paths[0]!.length - vehicle.distanceAlong;
      vehicle.drive(t, 100);
      expect(vehicle.distanceAlong).toBeGreaterThanOrEqual(previous);
      expect(vehicle.distanceAlong).toBeLessThanOrEqual(network.paths[0]!.length);
      // Never faster than it could still stop from, on any step.
      expect(vehicle.speed).toBeLessThanOrEqual(stoppingLimit(remaining, 0.1) + 1e-9);
      previous = vehicle.distanceAlong;
      if (vehicle.status === "moving") lastRollingSpeed = vehicle.speed;
    }
    // It creeps the last few centimetres rather than being snapped to a halt from walking pace.
    expect(lastRollingSpeed).toBeLessThan(0.5);
    expect(vehicle.distanceAlong).toBe(network.paths[0]!.length);
    expect(vehicle.speed).toBe(0);
    expect(vehicle.statusUntil - t).toBeGreaterThanOrEqual(10 * 60_000);
  });

  it("leaves on a real route out of where it arrived, not the same route backwards", () => {
    const { vehicle } = truckAtStart();
    let t = NIGHT;
    while (vehicle.status === "moving") vehicle.drive((t += 100), 100);
    vehicle.drive(vehicle.statusUntil, 100);
    expect(vehicle.status).toBe("moving");
    expect(vehicle.path.id).toBe("b__a");
  });

  it("reports once a second while moving, every 30 s while parked, with consecutive seqs", () => {
    const { vehicle } = truckAtStart();
    const sent: Ping[] = [];
    for (let t = NIGHT + 100; t <= NIGHT + 60_000; t += 100) {
      vehicle.drive(t, 100);
      sent.push(...vehicle.report(t, []));
    }
    expect(sent.length).toBeGreaterThanOrEqual(58);
    expect(sent.length).toBeLessThanOrEqual(61);
    expect(sent.map((p) => p.seq)).toEqual(sent.map((_, i) => i));
    expect(sent.every((p) => p.flags & PingFlag.Ignition)).toBe(true);

    vehicle.status = "loading";
    vehicle.statusUntil = Number.MAX_SAFE_INTEGER;
    const parked: Ping[] = [];
    for (let t = NIGHT + 60_100; t <= NIGHT + 180_000; t += 100) parked.push(...vehicle.report(t, []));
    expect(parked.length).toBeGreaterThanOrEqual(3);
    expect(parked.length).toBeLessThanOrEqual(5);
    expect(parked.every((p) => p.speed === 0 && !(p.flags & PingFlag.Ignition))).toBe(true);
  });

  it("goes silent in a coverage gap, then sends the whole backlog at once on the way out", () => {
    const { vehicle, network } = truckAtStart();
    const mid = positionAt(network.paths[0]!, 500);
    const gap = [{ center: [mid.lat, mid.lon] as const, radiusM: 100 }];
    const sends: { t: number; pings: Ping[] }[] = [];
    for (let t = NIGHT + 100; vehicle.status === "moving"; t += 100) {
      vehicle.drive(t, 100);
      const pings = vehicle.report(t, gap);
      if (pings.length > 0) sends.push({ t, pings });
    }
    const burst = sends.find((s) => s.pings.length > 1)!;
    const buffered = burst.pings.filter((p) => p.flags & PingFlag.Buffered);
    // ~200 m of gap at ~10 m/s is ~20 s of reports held back.
    expect(buffered.length).toBeGreaterThan(10);
    expect(burst.pings.at(-1)!.flags & PingFlag.Buffered).toBe(0); // the first report back in coverage
    const all = sends.flatMap((s) => s.pings.map((p) => p.seq));
    expect(all).toEqual(all.map((_, i) => i)); // nothing lost, nothing reordered, on the device's side
  });

  it("records nothing while its tracker has no power, then reports again with the next seq", () => {
    // About one outage every 10 s, each exactly 30 s long, so the first comes early.
    const device: DeviceConfig = { ...QUIET_DEVICE, outagesPerHour: 360, outageMinMs: 30_000, outageMaxMs: 30_000 };
    const network = straightNetwork();
    const vehicle = new Vehicle({ id: 0, plate: "T", driver: "T" }, createRng(1), createRng(2), network, device, NIGHT, {
      speedCapMs: 15,
      power: createRng(3),
    });
    vehicle.path = network.paths[0]!;
    vehicle.distanceAlong = 0;
    const pings: Ping[] = [];
    let sawOff = false;
    for (let t = NIGHT + 100; t <= NIGHT + 60_000; t += 100) {
      vehicle.drive(t, 100);
      pings.push(...vehicle.report(t, []));
      sawOff ||= vehicle.truth().deviceOff;
    }
    const gaps = pings.slice(1).map((p, i) => p.deviceTime - pings[i]!.deviceTime);
    expect(sawOff).toBe(true);
    expect(Math.max(...gaps)).toBeGreaterThanOrEqual(30_000);
    expect(Math.max(...gaps)).toBeLessThan(31_500);
    // Nothing was recorded during the outage, so no sequence numbers are missing: no backlog exists.
    expect(pings.every((p, i) => p.seq === i)).toBe(true);
  });

  it("stamps every report with the same wrong clock when the device's clock is off", () => {
    const { vehicle } = truckAtStart({ ...QUIET_DEVICE, skewedShare: 1, maxSkewMs: 180_000 });
    const skews: number[] = [];
    for (let t = NIGHT + 100; t <= NIGHT + 10_000; t += 100) {
      vehicle.drive(t, 100);
      for (const p of vehicle.report(t, [])) skews.push(p.deviceTime - t);
    }
    expect(Math.abs(skews[0]!)).toBeLessThanOrEqual(180_000);
    expect(new Set(skews).size).toBe(1);
  });

  it("scatters GPS fixes around the truth with the configured spread", () => {
    const { vehicle } = truckAtStart({ ...QUIET_DEVICE, gpsSigmaM: 4 });
    vehicle.status = "loading";
    vehicle.statusUntil = Number.MAX_SAFE_INTEGER;
    const errors: number[] = [];
    for (let t = NIGHT + 100; t <= NIGHT + 200 * 30_000; t += 100) {
      for (const p of vehicle.report(t, [])) errors.push(haversine([p.lat, p.lon], [vehicle.lat, vehicle.lon]));
    }
    // Distance from the truth for a 2-D normal with σ = 4 m per axis has mean σ·√(π/2) ≈ 5.01 m.
    const mean = errors.reduce((a, b) => a + b, 0) / errors.length;
    expect(errors.length).toBeGreaterThanOrEqual(190);
    expect(mean).toBeGreaterThan(4.3);
    expect(mean).toBeLessThan(5.7);
  });
});

// ─── The fleet ──────────────────────────────────────────────────────────────

describe("the simulation", () => {
  const bytes = (frames: Frame[]) => frames.map((f) => Buffer.from(encodeFrame(f)).toString("base64")).join();

  it("sends a frame every 100 ms, with consecutive frame numbers", () => {
    const frames = new Simulation(lagos, { seed: 1, vehicleCount: 20, startTime: NIGHT }).advance(60_000);
    expect(frames).toHaveLength(600);
    expect(frames.map((f) => f.frameSeq)).toEqual(frames.map((_, i) => i));
    expect(frames.every((f, i) => f.baseTime === NIGHT + (i + 1) * 100)).toBe(true);
  });

  it("is byte-for-byte repeatable for a seed, and different for another", () => {
    const run = (seed: number) => bytes(new Simulation(lagos, { seed, vehicleCount: 50, startTime: NIGHT }).advance(60_000));
    expect(run(7)).toBe(run(7));
    expect(run(7)).not.toBe(run(8));
  });

  it("moves every truck identically however bad the network is", () => {
    const perfect = new Simulation(lagos, { seed: 3, vehicleCount: 30, startTime: MORNING_PEAK, chaos: NO_CHAOS });
    const awful = new Simulation(lagos, {
      seed: 3,
      vehicleCount: 30,
      startTime: MORNING_PEAK,
      chaos: { dropRate: 0.3, duplicateRate: 0.3, reorderRate: 0.3, jitterMeanMs: 2000 },
    });
    perfect.advance(120_000);
    awful.advance(120_000);
    for (let id = 0; id < 30; id++) expect(awful.truth(id)).toEqual(perfect.truth(id));
  });

  it("keeps each truck the same when trucks are added to the fleet", () => {
    const small = new Simulation(lagos, { seed: 4, vehicleCount: 10, startTime: NIGHT });
    const large = new Simulation(lagos, { seed: 4, vehicleCount: 20, startTime: NIGHT });
    small.advance(60_000);
    large.advance(60_000);
    for (let id = 0; id < 10; id++) {
      expect(large.truth(id)).toEqual(small.truth(id));
      expect(large.info()[id]).toEqual(small.info()[id]);
    }
  });

  it("produces frames that survive the wire protocol unchanged", () => {
    const frames = new Simulation(lagos, { seed: 5, vehicleCount: 200, startTime: MORNING_PEAK }).advance(30_000);
    for (const frame of frames) {
      expect(decodeFrame(encodeFrame(frame))).toEqual({ ok: true, frame: { ...frame, pings: frame.pings.map(quantize) } });
    }
  });

  it("misbehaves the way it was told to: duplicates, gaps and pings out of order", () => {
    const sim = new Simulation(lagos, { seed: 6, vehicleCount: 100, startTime: MORNING_PEAK });
    const pings = pingsOf(sim.advance(120_000));
    const seen = new Map<number, number[]>();
    for (const p of pings) seen.set(p.vehicleId, [...(seen.get(p.vehicleId) ?? []), p.seq]);

    let duplicates = 0;
    let outOfOrder = 0;
    let missing = 0;
    for (const seqs of seen.values()) {
      duplicates += seqs.length - new Set(seqs).size;
      outOfOrder += seqs.filter((s, i) => i > 0 && s < seqs[i - 1]!).length;
      missing += Math.max(...seqs) + 1 - new Set(seqs).size;
    }
    expect(duplicates).toBeGreaterThan(0);
    expect(outOfOrder).toBeGreaterThan(0);
    expect(missing).toBeGreaterThan(0); // dropped, or still buffered in a gap, or still in flight
    expect(sim.networkStats.dropped).toBeGreaterThan(0);
  });

  // 2 runs × 150 trucks × 15 simulated minutes × 10 steps a second is 2.7 million truck-steps.
  it("lets speeders past the 55 km/h laden-truck cap, up to their own, and nobody else", { timeout: 30_000 }, () => {
    const fastest = (speederShare: number) => {
      const sim = new Simulation(lagos, { seed: 5, vehicleCount: 200, startTime: NIGHT, chaos: NO_CHAOS, drivers: { speederShare } });
      let max = 0;
      for (let i = 0; i < 1500; i++) {
        sim.advance(100);
        for (let id = 0; id < 200; id++) max = Math.max(max, sim.truth(id).speed);
      }
      return max * 3.6;
    };
    const careful = fastest(0);
    const speeders = fastest(1);
    expect(careful).toBeLessThanOrEqual(55 + 1e-9);
    expect(speeders).toBeGreaterThan(65);
    expect(speeders).toBeLessThanOrEqual(80 + 1e-9);
  });

  it("is slower at the morning peak than at night", { timeout: 30_000 }, () => {
    const medianMovingKmh = (start: number) => {
      const sim = new Simulation(lagos, { seed: 9, vehicleCount: 150, startTime: start, chaos: NO_CHAOS });
      const speeds: number[] = [];
      for (let minute = 0; minute < 15; minute++) {
        sim.advance(60_000);
        for (let id = 0; id < 150; id++) {
          const t = sim.truth(id);
          if (t.status === "moving") speeds.push(t.speed * 3.6);
        }
      }
      speeds.sort((a, b) => a - b);
      return speeds[Math.floor(speeds.length / 2)]!;
    };
    const peak = medianMovingKmh(MORNING_PEAK);
    const night = medianMovingKmh(NIGHT);
    console.log(`median moving speed: ${peak.toFixed(1)} km/h at 08:00, ${night.toFixed(1)} km/h at 03:00`);
    expect(peak).toBeLessThan(night);
    expect(peak).toBeGreaterThan(3);
    expect(night).toBeLessThanOrEqual(55);
  });
});

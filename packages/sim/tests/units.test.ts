import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { Ping } from "@fleet/protocol";
import {
  CONGESTION_ZONES,
  ChaosChannel,
  NO_CHAOS,
  TRUCK_MAX_SPEED_MS,
  bearing,
  createRng,
  lagosHour,
  positionAt,
  segmentAt,
  targetSpeed,
  timeOfDayFactor,
  withinRadius,
  zoneAt,
} from "../src";
import { haversine } from "@fleet/routes";
import { eastDeg, lagos, straightNetwork } from "./helpers";

// ─── Random ─────────────────────────────────────────────────────────────────

describe("seeded random", () => {
  const draw = (seed: number | string, n = 5) => {
    const rng = createRng(seed);
    return Array.from({ length: n }, () => rng.next());
  };

  it("repeats exactly for the same seed, and differs for another", () => {
    expect(draw(42)).toEqual(draw(42));
    expect(draw("lagos")).toEqual(draw("lagos"));
    expect(draw(42)).not.toEqual(draw(43));
  });

  it("forks streams from the seed, so a fork ignores how much the parent has drawn", () => {
    const fresh = createRng(7);
    const used = createRng(7);
    for (let i = 0; i < 1000; i++) used.next();
    const a = fresh.fork("vehicle:3:motion");
    const b = used.fork("vehicle:3:motion");
    expect([a.next(), a.next()]).toEqual([b.next(), b.next()]);
    expect(createRng(7).fork("x").next()).not.toBe(createRng(7).fork("y").next());
  });

  it("is roughly uniform and roughly normal (seeded, so this can't flake)", () => {
    const rng = createRng(1);
    const n = 100_000;
    let sum = 0;
    let normalSum = 0;
    let normalSq = 0;
    const faces = new Set<number>();
    for (let i = 0; i < n; i++) {
      sum += rng.next();
      const z = rng.normal();
      normalSum += z;
      normalSq += z * z;
      faces.add(rng.int(1, 6));
    }
    expect(sum / n).toBeCloseTo(0.5, 2);
    expect(normalSum / n).toBeCloseTo(0, 1);
    expect(Math.sqrt(normalSq / n)).toBeCloseTo(1, 1);
    expect([...faces].sort()).toEqual([1, 2, 3, 4, 5, 6]);
  });
});

// ─── Road network ───────────────────────────────────────────────────────────

describe("road network", () => {
  it("computes bearings by the compass", () => {
    expect(bearing([0, 0], [1, 0])).toBeCloseTo(0, 9);
    expect(bearing([0, 0], [0, 1])).toBeCloseTo(90, 9);
    expect(bearing([1, 0], [0, 0])).toBeCloseTo(180, 9);
    expect(bearing([0, 1], [0, 0])).toBeCloseTo(270, 9);
  });

  it("finds a point part-way along a segment", () => {
    const path = straightNetwork().paths[0]!;
    expect(path.length).toBeCloseTo(1000, 0);
    const mid = positionAt(path, path.length / 2);
    // Halfway between the *stored* endpoints. Geometry is kept to the microdegree,
    // so the far end is 3.4 + eastDeg(1000) rounded, not the exact value.
    expect(mid.lat).toBeCloseTo(6.5, 9);
    expect(mid.lon).toBeCloseTo((path.lon[0]! + path.lon[1]!) / 2, 12);
    expect(Math.abs(path.lon[1]! - (3.4 + eastDeg(1000)))).toBeLessThanOrEqual(0.5e-6);
    expect(mid.heading).toBeCloseTo(90, 1);
  });

  it("clamps distances outside the path to its first and last segment", () => {
    const path = lagos.paths[0]!;
    expect(segmentAt(path, -5)).toBe(0);
    expect(segmentAt(path, path.length + 5)).toBe(path.cum.length - 2);
    expect(segmentAt(path, path.cum[3]!)).toBe(3);
  });

  it("lets a truck leave every place it can arrive at", () => {
    for (const place of lagos.places) expect(lagos.outgoing.get(place.id)?.length, place.id).toBe(24);
  });
});

// ─── Traffic ────────────────────────────────────────────────────────────────

describe("traffic model", () => {
  it("reads Lagos time as UTC+1", () => {
    expect(lagosHour(0)).toBe(1); // 1970-01-01T00:00Z is 01:00 in Lagos
    expect(lagosHour(Date.UTC(2026, 8, 29, 23, 30))).toBe(0.5);
  });

  it("interpolates the day curve between its points", () => {
    expect(timeOfDayFactor(8)).toBe(0.35);
    expect(timeOfDayFactor(7.25)).toBeCloseTo(0.475, 12); // halfway from (6.5, 0.6) to (8, 0.35)
  });

  it("never exceeds the truck cap or goes negative, whatever the inputs", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 60, noNaN: true }),
        fc.integer({ min: 0, max: 86_400_000 }),
        fc.option(fc.constantFrom(...CONGESTION_ZONES), { nil: undefined }),
        fc.double({ min: 0.9, max: 1.1, noNaN: true }),
        (freeFlow, time, zone, driver) => {
          const speed = targetSpeed(freeFlow, time, zone, driver);
          expect(speed).toBeGreaterThanOrEqual(0);
          expect(speed).toBeLessThanOrEqual(TRUCK_MAX_SPEED_MS);
        },
      ),
    );
  });

  it("holds a heavy-footed driver on an empty road at night to the cap", () => {
    // The property above can miss this narrow case: night (≈1.0), no zone, driver factor > 1.
    const halfPastMidnightLagos = Date.UTC(2026, 8, 28, 23, 30);
    expect(targetSpeed(30, halfPastMidnightLagos, undefined, 1.1)).toBe(TRUCK_MAX_SPEED_MS);
  });

  it("agrees with the great-circle distance except within 0.1% of the edge", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 6.3, max: 6.8, noNaN: true }),
        fc.double({ min: 2.9, max: 4.1, noNaN: true }),
        fc.double({ min: -0.05, max: 0.05, noNaN: true }),
        fc.double({ min: -0.05, max: 0.05, noNaN: true }),
        fc.integer({ min: 100, max: 5000 }),
        (lat, lon, dLat, dLon, radius) => {
          const center = [lat, lon] as const;
          const p = [lat + dLat, lon + dLon] as const;
          const exact = haversine(p, center);
          if (Math.abs(exact - radius) > radius * 0.001) {
            expect(withinRadius(p, center, radius)).toBe(exact <= radius);
          }
        },
      ),
    );
  });

  it("puts the port roads in the go-slow and leaves Ikeja clear", () => {
    expect(zoneAt([6.445, 3.355])?.name).toBe("Apapa go-slow");
    expect(zoneAt([6.603, 3.35])).toBeUndefined();
  });
});

// ─── Network chaos ──────────────────────────────────────────────────────────

const ping = (seq: number): Ping => ({
  vehicleId: 1,
  seq,
  deviceTime: seq * 1000,
  lat: 6.5,
  lon: 3.4,
  speed: 0,
  heading: 0,
  flags: 0,
});

describe("chaos channel", () => {
  it("with no chaos, delivers every ping once, immediately, in order", () => {
    const channel = new ChaosChannel(NO_CHAOS, createRng(1));
    for (let i = 0; i < 100; i++) channel.send(ping(i), i * 1000);
    expect(channel.receive(99_000).map((p) => p.seq)).toEqual(Array.from({ length: 100 }, (_, i) => i));
  });

  it("never delivers a ping before its latency has passed", () => {
    const channel = new ChaosChannel({ ...NO_CHAOS, baseLatencyMs: 100 }, createRng(1));
    channel.send(ping(0), 0);
    expect(channel.receive(99)).toEqual([]);
    expect(channel.receive(100)).toHaveLength(1);
  });

  it("drops and duplicates at close to the configured rates", () => {
    const channel = new ChaosChannel({ ...NO_CHAOS, dropRate: 0.05, duplicateRate: 0.1 }, createRng(2));
    const n = 20_000;
    for (let i = 0; i < n; i++) channel.send(ping(i), i);
    const delivered = channel.receive(Number.MAX_SAFE_INTEGER);
    const bySeq = new Map<number, number>();
    for (const p of delivered) bySeq.set(p.seq, (bySeq.get(p.seq) ?? 0) + 1);

    expect(channel.stats.dropped / n).toBeCloseTo(0.05, 2);
    expect(channel.stats.duplicated / (n - channel.stats.dropped)).toBeCloseTo(0.1, 2);
    expect(n - bySeq.size).toBe(channel.stats.dropped);
    expect(delivered.length - bySeq.size).toBe(channel.stats.duplicated);
  });

  it("delivers held-back pings after later ones", () => {
    const channel = new ChaosChannel({ ...NO_CHAOS, reorderRate: 0.1, reorderWindowMs: 3000 }, createRng(3));
    for (let i = 0; i < 1000; i++) channel.send(ping(i), i * 1000);
    const seqs = channel.receive(Number.MAX_SAFE_INTEGER).map((p) => p.seq);
    const inversions = seqs.filter((s, i) => i > 0 && s < seqs[i - 1]!).length;
    expect(channel.stats.heldBack).toBeGreaterThan(50);
    expect(inversions).toBeGreaterThan(50);
    expect([...seqs].sort((a, b) => a - b)).toEqual(Array.from({ length: 1000 }, (_, i) => i)); // nothing lost
  });
});

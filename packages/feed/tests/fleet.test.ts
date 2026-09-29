import { describe, expect, it } from "vitest";
import { FrameType, type Frame } from "@fleet/protocol";
import { haversine, parseDataset } from "@fleet/routes";
import committed from "@fleet/routes/data/lagos-routes.json";
import { Simulation, buildNetwork, createRng } from "@fleet/sim";
import { DEFAULT_FEED_OPTIONS, Feed, raw } from "../src";

const lagos = buildNetwork(parseDataset(committed));
const PEAK = Date.UTC(2026, 8, 29, 7, 0, 0);

describe("the feed on the simulated fleet", () => {
  it("accounts for every ping and keeps every track strictly ordered with no duplicates", () => {
    const sim = new Simulation(lagos, { seed: 11, vehicleCount: 100, startTime: PEAK });
    const feed = new Feed();
    for (const f of sim.advance(180_000)) feed.ingest(f);

    const s = feed.stats;
    expect(s.added + s.duplicates + s.tooOld).toBe(s.pings);
    expect(s.duplicates).toBeGreaterThan(0);
    for (const id of feed.vehicleIds()) {
      const seqs = feed.track(id)!.resolve().map((x) => x.seq);
      expect(seqs).toEqual([...new Set(seqs)].sort((a, b) => a - b));
    }
  });

  it("builds identical tracks when every delivery is processed in a random order", { timeout: 30_000 }, () => {
    // Coverage gaps off: a window made only of buffered samples falls back to a carried-over
    // clock offset, the one documented exception to order independence.
    const sim = new Simulation(lagos, { seed: 12, vehicleCount: 60, startTime: PEAK, device: { gapZoneCount: 0 } });
    const frames = sim.advance(120_000);
    const inOrder = new Feed();
    for (const f of frames) inOrder.ingest(f);

    // Every ping becomes its own frame at its real arrival time, then all are shuffled.
    const deliveries: Frame[] = frames.flatMap((f) =>
      f.pings.map((p) => ({ type: FrameType.Delta, frameSeq: 0, baseTime: f.baseTime, pings: [p] })),
    );
    const rng = createRng(99);
    for (let i = deliveries.length - 1; i > 0; i--) {
      const j = rng.int(0, i);
      [deliveries[i], deliveries[j]] = [deliveries[j]!, deliveries[i]!];
    }
    const shuffled = new Feed();
    for (const d of deliveries) shuffled.ingest(d);

    expect([...shuffled.vehicleIds()].sort()).toEqual([...inOrder.vehicleIds()].sort());
    for (const id of inOrder.vehicleIds()) {
      expect(shuffled.track(id)!.resolve()).toEqual(inOrder.track(id)!.resolve());
    }
  });

  it("puts parked trucks closer to where they really are than the raw GPS does", { timeout: 30_000 }, () => {
    const sim = new Simulation(lagos, { seed: 13, vehicleCount: 100, startTime: PEAK });
    const smoothed = new Feed();
    const unsmoothed = new Feed({ ...DEFAULT_FEED_OPTIONS, smoothing: raw });
    const errors = { smoothed: [] as number[], raw: [] as number[] };

    for (let second = 0; second < 240; second++) {
      for (const f of sim.advance(1000)) {
        smoothed.ingest(f);
        unsmoothed.ingest(f);
      }
      if (second < 60) continue; // warm-up
      // Truth *now*, compared with each feed's estimate at the same instant. Both feeds share the
      // same display delay, so lag hurts both equally and the difference is the smoothing.
      for (let id = 0; id < 100; id++) {
        const t = sim.truth(id);
        const now = sim.now;
        const a = smoothed.track(id)?.estimate(now);
        const b = unsmoothed.track(id)?.estimate(now);
        if (!a || !b || t.status !== "loading") continue; // parked: position error is pure GPS noise
        errors.smoothed.push(haversine([a.lat, a.lon], [t.lat, t.lon]));
        errors.raw.push(haversine([b.lat, b.lon], [t.lat, t.lon]));
      }
    }
    const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;
    expect(errors.smoothed.length).toBeGreaterThan(1000);
    // Measured by the evaluation script: 1.7 m vs 4.5 m. Asserting a clear margin, not the exact figure.
    expect(median(errors.smoothed)).toBeLessThan(median(errors.raw) * 0.6);
  });
});

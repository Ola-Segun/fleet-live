/**
 * Measures the feed against the simulator's ground truth.
 *
 *   pnpm --filter @fleet/feed evaluate
 *
 * Runs 300 trucks through the Lagos morning peak with the default network
 * chaos, feeds every frame to several Feed instances that differ only in
 * smoothing, and once a second compares where each feed says every truck is
 * (at its display time) with where the truck really was at that moment.
 *
 * The error includes the feed's inherent lag: corrected times sit on the
 * server's clock, roughly the fastest delivery latency behind reality. That
 * is part of what a dispatcher sees, so it is counted, not subtracted.
 */
import { parseDataset } from "@fleet/routes";
import committed from "@fleet/routes/data/lagos-routes.json";
import { haversine } from "@fleet/routes";
import { NO_CHAOS, Simulation, buildNetwork, type ChaosConfig } from "@fleet/sim";
import { DEFAULT_FEED_OPTIONS, Feed, raw, velocityAided, type EstimateMode, type Smoother } from "../src";
import { oneEuro } from "./one-euro";

const network = buildNetwork(parseDataset(committed));
const START = Date.UTC(2026, 8, 29, 7, 0, 0); // 08:00 Lagos
const VEHICLES = 300;
const WARMUP_MS = 120_000;
const MEASURE_MS = 600_000;
const STEP = 100;


interface Result {
  label: string;
  moving: number[];
  parked: number[];
  modes: Record<EstimateMode, number>;
  feed: Feed;
}

const pct = (xs: number[], q: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))] ?? NaN;
};

function run(chaos: Partial<ChaosConfig>, configs: { label: string; smoothing: Smoother }[]): Result[] {
  const sim = new Simulation(network, { seed: 2026, vehicleCount: VEHICLES, startTime: START, chaos });
  const results: Result[] = configs.map(({ label, smoothing }) => ({
    label,
    moving: [],
    parked: [],
    modes: { waiting: 0, interpolated: 0, extrapolated: 0, holding: 0, parked: 0, stale: 0 },
    feed: new Feed({ ...DEFAULT_FEED_OPTIONS, smoothing }),
  }));

  // Truth history: position of every truck at every step, so any display time can be looked up.
  const steps = (WARMUP_MS + MEASURE_MS) / STEP;
  const lat = new Float64Array(steps * VEHICLES);
  const lon = new Float64Array(steps * VEHICLES);
  const moving = new Uint8Array(steps * VEHICLES);

  for (let k = 0; k < steps; k++) {
    const frames = sim.advance(STEP);
    for (let id = 0; id < VEHICLES; id++) {
      const t = sim.truth(id);
      lat[k * VEHICLES + id] = t.lat;
      lon[k * VEHICLES + id] = t.lon;
      moving[k * VEHICLES + id] = t.status === "moving" && t.speed > 0.5 ? 1 : 0;
    }
    for (const r of results) for (const f of frames) r.feed.ingest(f);

    const now = START + (k + 1) * STEP;
    if (now - START < WARMUP_MS || (now - START) % 1000 !== 0) continue;
    for (const r of results) {
      const display = r.feed.displayTime(now);
      // Truth at the display time, interpolated between the two steps around it.
      const exact = (display - START) / STEP - 1;
      const k0 = Math.floor(exact);
      const w = exact - k0;
      if (k0 < 0) continue;
      for (let id = 0; id < VEHICLES; id++) {
        const e = r.feed.estimate(id, display);
        if (!e) continue;
        const i0 = k0 * VEHICLES + id;
        const i1 = i0 + VEHICLES;
        const truth: [number, number] = [lat[i0]! + (lat[i1]! - lat[i0]!) * w, lon[i0]! + (lon[i1]! - lon[i0]!) * w];
        const error = haversine([e.lat, e.lon], truth);
        if (moving[i0]) {
          r.moving.push(error);
          r.modes[e.mode]++;
        } else r.parked.push(error);
      }
    }
  }
  return results;
}

function table(title: string, results: Result[]) {
  console.log(`\n${title}`);
  console.log("smoothing                 | moving p50  p95 | parked p50  p95 | moving trucks: interp  extrap  hold/stale");
  for (const r of results) {
    const m = r.modes;
    const total = Object.values(m).reduce((a, b) => a + b, 0);
    const share = (n: number) => `${((100 * n) / total).toFixed(1)}%`.padStart(6);
    console.log(
      `${r.label.padEnd(25)} | ${pct(r.moving, 0.5).toFixed(1).padStart(8)} ${pct(r.moving, 0.95).toFixed(1).padStart(5)} m` +
        ` | ${pct(r.parked, 0.5).toFixed(1).padStart(8)} ${pct(r.parked, 0.95).toFixed(1).padStart(5)} m` +
        ` | ${share(m.interpolated)} ${share(m.extrapolated)} ${share(m.holding + m.stale + m.waiting + m.parked)}`,
    );
  }
  const s = results[0]!.feed.stats;
  console.log(
    `feed: delay ${results[0]!.feed.delayMs} ms · ${s.pings} pings · ${s.duplicates} duplicates removed · ` +
      `${s.tooOld} too old · ${s.lateForDisplay} late for display (${((100 * s.lateForDisplay) / s.added).toFixed(2)}%) · ${s.framesMissed} frames missed`,
  );
}

const grid: { label: string; smoothing: Smoother }[] = [
  { label: "raw (none)", smoothing: raw },
  // The best balanced 1€ settings from the first sweep, kept as the measured alternative.
  { label: "1€ min 0.002 Hz, β 0.05", smoothing: oneEuro({ minCutoffHz: 0.002, beta: 0.05, derivativeCutoffHz: 1 }) },
  { label: "1€ min 0.002 Hz, β 0.3", smoothing: oneEuro({ minCutoffHz: 0.002, beta: 0.3, derivativeCutoffHz: 1 }) },
];
for (const k of [0.05, 0.1, 0.2, 0.3, 0.5]) grid.push({ label: `velocity-aided k ${k}`, smoothing: velocityAided(k) });

const t0 = performance.now();
table(`Default chaos, ${VEHICLES} trucks, 08:00 Lagos, ${MEASURE_MS / 60_000} min measured (errors vs ground truth)`, run({}, grid));
table("No chaos (reference)", run(NO_CHAOS, [grid[0]!, { label: "chosen default", smoothing: DEFAULT_FEED_OPTIONS.smoothing }]));
console.log(`\n(${((performance.now() - t0) / 1000).toFixed(0)} s)`);

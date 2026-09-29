/**
 * What does the feed cost for a 5,000-truck fleet?
 *   pnpm --filter @fleet/feed bench
 * Frames are generated first, so only the feed is timed. Five runs, min and median,
 * because a single laptop run swings by 2×.
 */
import { parseDataset } from "@fleet/routes";
import committed from "@fleet/routes/data/lagos-routes.json";
import { Simulation, buildNetwork } from "@fleet/sim";
import { cpus } from "node:os";
import { Feed } from "../src";

const network = buildNetwork(parseDataset(committed));
const VEHICLES = 5000;
const sim = new Simulation(network, { seed: 1, vehicleCount: VEHICLES, startTime: Date.UTC(2026, 8, 29, 7, 0, 0) });
const warm = sim.advance(30_000);
const frames = sim.advance(60_000);
const pings = frames.reduce((n, f) => n + f.pings.length, 0);

/*
 * The loop the browser Worker will run: ingest each 10 Hz frame, then read every
 * truck (for the GPU upload and the picking index). Reading is what triggers the
 * deferred smoothing, so this is the honest total, not ingest alone.
 */
const ingestOnly: number[] = [];
const workerLoop: number[] = [];
for (let run = 0; run < 5; run++) {
  const a = new Feed();
  for (const f of warm) a.ingest(f);
  const t0 = performance.now();
  for (const f of frames) a.ingest(f);
  ingestOnly.push((performance.now() - t0) / 60);

  const b = new Feed();
  for (const f of warm) b.ingest(f);
  const t1 = performance.now();
  for (const f of frames) {
    b.ingest(f);
    const display = b.displayTime();
    for (let id = 0; id < VEHICLES; id++) b.estimate(id, display);
  }
  workerLoop.push((performance.now() - t1) / 60);
}
const stat = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return `${s[0]!.toFixed(1)} ms min, ${s[2]!.toFixed(1)} ms median`;
};
console.log(`ingest only, ${(pings / 60).toFixed(0)} pings/s from ${VEHICLES} trucks: ${stat(ingestOnly)} per simulated second`);
console.log(`ingest + read all ${VEHICLES} trucks at 10 Hz: ${stat(workerLoop)} per simulated second`);
console.log(`machine: ${cpus()[0]?.model}, Node ${process.version}`);

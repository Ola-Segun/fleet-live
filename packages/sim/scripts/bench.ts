/**
 * How long does one simulated second of a 5,000-truck fleet take on this machine?
 *   pnpm --filter @fleet/sim bench
 * Real-time demo mode needs this well under 1,000 ms, with room left for the
 * rest of the Worker's work.
 */
import { parseDataset } from "@fleet/routes";
import committed from "@fleet/routes/data/lagos-routes.json";
import { cpus } from "node:os";
import { Simulation, buildNetwork } from "../src";

const network = buildNetwork(parseDataset(committed));
const start = Date.UTC(2026, 8, 29, 7, 0, 0);

/*
 * Five timed runs per size, reporting the minimum and the median. On a laptop,
 * turbo boost, heat and background work swing a single run by 2× (identical
 * code measured 51, 100 and 69 ms in a row). The minimum is the least-disturbed
 * run; the median is what to expect.
 */
const RUNS = 5;
for (const vehicleCount of [1000, 5000]) {
  const perSecond: number[] = [];
  let pings = 0;
  for (let run = 0; run < RUNS; run++) {
    const sim = new Simulation(network, { seed: 1, vehicleCount, startTime: start });
    sim.advance(10_000); // warm up the JIT
    const t0 = performance.now();
    const frames = sim.advance(60_000);
    perSecond.push((performance.now() - t0) / 60);
    pings = frames.reduce((n, f) => n + f.pings.length, 0) / 60;
  }
  perSecond.sort((a, b) => a - b);
  const min = perSecond[0]!;
  const median = perSecond[Math.floor(RUNS / 2)]!;
  console.log(
    `${vehicleCount} trucks: ${min.toFixed(1)} ms min, ${median.toFixed(1)} ms median per simulated second ` +
      `(${((min * 1e6) / (vehicleCount * 10)).toFixed(0)} ns per truck-step at best), ${pings.toFixed(0)} pings/s delivered`,
  );
}
console.log(`machine: ${cpus()[0]?.model}, ${cpus().length} threads, Node ${process.version}`);

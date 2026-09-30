/**
 * What does replay cost the Worker, for 5,000 trucks?
 *   pnpm --filter @fleet/replay bench
 *
 * A history is recorded first (the simulator through the feed, one frame per
 * 5 s), so only replay itself is timed. Five runs, min and median.
 *
 *   jump       every truck repacked: entering replay, or dragging the slider
 *   snapshot   the list's snapshot at a replay time (5,000 shader estimates)
 *   60×        steady playback at 60×: 10 updates a second, each 6 s of replay time
 */
import { MODE_CODES } from "@fleet/gl";
import { Feed } from "@fleet/feed";
import { parseDataset } from "@fleet/routes";
import committed from "@fleet/routes/data/lagos-routes.json";
import { Simulation, buildNetwork } from "@fleet/sim";
import { cpus } from "node:os";
import { History, ReplayView, type HistoryFrameInput } from "../src";

const VEHICLES = 5000;
const sim = new Simulation(buildNetwork(parseDataset(committed)), { seed: 1, vehicleCount: VEHICLES, startTime: Date.UTC(2026, 8, 29, 8, 0, 0) });
const feed = new Feed();
const history = new History();
for (let t = 0; t < 360_000; t += 100) {
  for (const f of sim.advance(100)) feed.ingest(f);
  if ((t + 100) % 500 !== 0 || t < 30_000) continue;
  const g = history.due(feed.displayTime());
  if (g === undefined) continue;
  const ids = [...feed.vehicleIds()].sort((a, b) => a - b);
  const n = ids.length;
  const frame: HistoryFrameInput = { displayTime: g, count: n, ids: Uint32Array.from(ids), lat: new Float64Array(n), lon: new Float64Array(n), heading: new Float32Array(n), speed: new Float32Array(n), mode: new Uint8Array(n), ignition: new Uint8Array(n) };
  ids.forEach((id, i) => {
    const e = feed.estimate(id, g)!;
    frame.lat[i] = e.lat;
    frame.lon[i] = e.lon;
    frame.heading[i] = e.heading;
    frame.speed[i] = e.speed;
    frame.mode[i] = MODE_CODES[e.mode];
    frame.ignition[i] = e.ignition ? 1 : 0;
  });
  history.record(frame);
}

const range = history.range()!;
const epoch = Math.floor(range.from / 1000) * 1000;
const slots = new Map([...history.vehicleIds()].map((id, i) => [id, i] as [number, number]));
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;
const report = (label: string, xs: number[], unit = "ms") => console.log(`  ${label.padEnd(44)} min ${Math.min(...xs).toFixed(2)} ${unit}, median ${median(xs).toFixed(2)} ${unit}`);

const jump: number[] = [];
const snapshot: number[] = [];
const playback: number[] = [];
const repacked: number[] = [];
for (let run = 0; run < 5; run++) {
  const view = new ReplayView(history, epoch);
  const at = range.from + 60_000 + run * 7000;
  let t0 = performance.now();
  view.update(at, slots);
  jump.push(performance.now() - t0);

  t0 = performance.now();
  view.snapshot(at, slots);
  snapshot.push(performance.now() - t0);

  // 60× for 3 s of wall time: 30 updates, 6 s of replay time each.
  const before = view.stats.repacked;
  t0 = performance.now();
  for (let k = 1; k <= 30; k++) view.update(at + k * 6000, slots);
  playback.push((performance.now() - t0) / 30);
  repacked.push((view.stats.repacked - before) / 30);
}

console.log(`${slots.size} trucks, ${history.length} frames recorded (${(history.stats().bytes / 1e6).toFixed(1)} MB), 5 runs. ${cpus()[0]?.model ?? ""}`);
report("jump: repack every truck", jump);
report("snapshot for the list", snapshot);
report("60× playback, per 100 ms update", playback);
console.log(`  trucks repacked per update at 60×: ${median(repacked).toFixed(0)} (median)`);

// Where the time goes (diagnostic).
if (process.env.PARTS) {
  const { packVehicle, slotEstimate, FLOATS_PER_VEHICLE } = await import("@fleet/gl");
  const at = range.from + 60_000;
  const ids = [...slots.keys()];
  const out = new Float32Array(FLOATS_PER_VEHICLE);
  for (let run = 0; run < 3; run++) {
    let t0 = performance.now();
    const windows = ids.map((id) => history.window(id, at));
    const tWindow = performance.now() - t0;
    t0 = performance.now();
    for (const w of windows) packVehicle(w.samples, epoch, out, 0);
    const tPack = performance.now() - t0;
    const view = new ReplayView(history, epoch);
    view.update(at, slots);
    t0 = performance.now();
    for (const slot of slots.values()) slotEstimate(view.mirror.data, slot, (at - epoch) / 1000);
    const tEstimate = performance.now() - t0;
    t0 = performance.now();
    for (const id of ids) history.recordedAt(id, at);
    const tLookup = performance.now() - t0;
    t0 = performance.now();
    for (const id of feed.vehicleIds()) feed.estimate(id, feed.displayTime());
    const tLive = performance.now() - t0;
    console.log(`parts: window ${tWindow.toFixed(1)} ms, pack ${tPack.toFixed(1)} ms, slotEstimate ${tEstimate.toFixed(1)} ms, recordedAt ${tLookup.toFixed(1)} ms | live feed.estimate ×${ids.length}: ${tLive.toFixed(1)} ms`);
  }
}

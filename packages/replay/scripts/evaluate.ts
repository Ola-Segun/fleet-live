/**
 * How faithful is replay, and what does each recording interval cost?
 *
 *   pnpm --filter @fleet/replay evaluate
 *
 * Runs the fleet through the default network chaos and the Layer 4 feed,
 * recording history at several intervals side by side, exactly as the Worker
 * does (the feed's estimates at each grid time). It also keeps the simulator's
 * ground truth every 500 ms, and the error of what the live map showed at the
 * time, as the reference.
 *
 * Then it replays the recorded window forwards, as playback would, packing
 * rows with ReplayView and reading them back with `slotEstimate` (the shader's
 * algorithm). It compares every truck's replayed position with where it really
 * was at that moment.
 */
import { MODE_CODES, slotEstimate } from "@fleet/gl";
import { Feed } from "@fleet/feed";
import { haversine, parseDataset } from "@fleet/routes";
import committed from "@fleet/routes/data/lagos-routes.json";
import { Simulation, buildNetwork } from "@fleet/sim";
import { History, ReplayView, type HistoryFrameInput } from "../src";

const VEHICLES = Number(process.env.VEHICLES ?? 2000);
const START = Date.UTC(2026, 8, 29, 8, 0, 0); // 09:00 Lagos: busy but moving
const WARMUP_MS = 120_000;
const MEASURE_MS = Number(process.env.MINUTES ?? 15) * 60_000;
const TICK = 500;
const INTERVALS = [2000, 5000, 10_000];

const sim = new Simulation(buildNetwork(parseDataset(committed)), { seed: 2026, vehicleCount: VEHICLES, startTime: START });
const feed = new Feed();
const histories = INTERVALS.map((intervalMs) => new History({ intervalMs, capacityMs: 3_600_000 }));

// Truth every tick: sim time → positions and speeds of every truck.
const truthTimes: number[] = [];
const truthLat: Float64Array[] = [];
const truthLon: Float64Array[] = [];
const truthSpeed: Float32Array[] = [];
const liveErr = { moving: [] as number[], parked: [] as number[] };

function framesAt(t: number): HistoryFrameInput {
  const ids = [...feed.vehicleIds()].sort((a, b) => a - b);
  const n = ids.length;
  const f: HistoryFrameInput = { displayTime: t, count: n, ids: Uint32Array.from(ids), lat: new Float64Array(n), lon: new Float64Array(n), heading: new Float32Array(n), speed: new Float32Array(n), mode: new Uint8Array(n), ignition: new Uint8Array(n) };
  ids.forEach((id, i) => {
    const e = feed.estimate(id, t);
    if (!e) return;
    f.lat[i] = e.lat;
    f.lon[i] = e.lon;
    f.heading[i] = e.heading;
    f.speed[i] = e.speed;
    f.mode[i] = MODE_CODES[e.mode];
    f.ignition[i] = e.ignition ? 1 : 0;
  });
  return f;
}

/** Truth at any time in the stored range, interpolated linearly between 500 ms ticks. */
function truthAt(t: number, v: number): { lat: number; lon: number; speed: number } | undefined {
  const k = Math.floor((t - truthTimes[0]!) / TICK);
  if (k < 0 || k + 1 >= truthTimes.length) return undefined;
  const u = (t - truthTimes[k]!) / TICK;
  return {
    lat: truthLat[k]![v]! + (truthLat[k + 1]![v]! - truthLat[k]![v]!) * u,
    lon: truthLon[k]![v]! + (truthLon[k + 1]![v]! - truthLon[k]![v]!) * u,
    speed: truthSpeed[k]![v]!,
  };
}

const began = performance.now();
for (let t = 0; t < WARMUP_MS + MEASURE_MS; t += 100) {
  for (const frame of sim.advance(100)) feed.ingest(frame);
  if ((t + 100) % TICK !== 0) continue;
  if (t + 100 >= WARMUP_MS - 10_000) {
    truthTimes.push(sim.now);
    const lat = new Float64Array(VEHICLES), lon = new Float64Array(VEHICLES), speed = new Float32Array(VEHICLES);
    for (let v = 0; v < VEHICLES; v++) {
      const tr = sim.truth(v);
      lat[v] = tr.lat;
      lon[v] = tr.lon;
      speed[v] = tr.speed;
    }
    truthLat.push(lat);
    truthLon.push(lon);
    truthSpeed.push(speed);
  }
  if (t + 100 < WARMUP_MS) continue;
  const display = feed.displayTime();
  for (const h of histories) {
    const g = h.due(display);
    if (g !== undefined) h.record(framesAt(g));
  }
  // The live reference: what the map showed at `display`, against where the trucks were then.
  if ((t + 100) % 3000 === 0) {
    for (const id of feed.vehicleIds()) {
      const e = feed.estimate(id, display);
      const tr = truthAt(display, id);
      if (!e || !tr || e.mode === "stale" || e.mode === "waiting") continue;
      (tr.speed > 1 ? liveErr.moving : liveErr.parked).push(haversine([e.lat, e.lon], [tr.lat, tr.lon]));
    }
  }
}

const pct = (xs: number[], q: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))]! : NaN;
};
const m = (x: number) => `${x.toFixed(1)} m`;

console.log(`\n${VEHICLES} trucks, ${MEASURE_MS / 60_000} min recorded from 09:00 Lagos after ${WARMUP_MS / 60_000} min warm-up, default network chaos.`);
console.log(`live map at the time (reference): moving p50 ${m(pct(liveErr.moving, 0.5))}, p95 ${m(pct(liveErr.moving, 0.95))}, p99 ${m(pct(liveErr.moving, 0.99))}; parked p50 ${m(pct(liveErr.parked, 0.5))}\n`);

for (const h of histories) {
  const range = h.range()!;
  const epoch = Math.floor(range.from / 1000) * 1000;
  const view = new ReplayView(h, epoch);
  const slots = new Map([...h.vehicleIds()].map((id, i) => [id, i] as [number, number]));
  const err = { moving: [] as number[], parked: [] as number[] };
  let staleOrMissing = 0;
  // Play forwards through the recording, sampling every 1.5 s (off the frame grid, so between frames too).
  const from = range.from + h.options.intervalMs * 8;
  const to = range.to - h.options.intervalMs;
  for (let t = from; t < to; t += 1500) {
    view.update(t, slots);
    for (const [id, slot] of slots) {
      const tr = truthAt(t, id);
      if (!tr) continue;
      const est = slotEstimate(view.mirror.data, slot, (t - epoch) / 1000);
      if (!est || est.mode === MODE_CODES.stale || est.mode === MODE_CODES.waiting) {
        staleOrMissing++;
        continue;
      }
      (tr.speed > 1 ? err.moving : err.parked).push(haversine([est.lat, est.lon], [tr.lat, tr.lon]));
    }
  }
  const replaySeconds = (to - from) / 1000;
  const perHour5000 = (5000 * 7 * 3_600_000) / h.options.intervalMs / 1e6;
  console.log(
    `every ${String(h.options.intervalMs / 1000).padStart(2)} s: memory for an hour of 5,000 trucks ${perHour5000.toFixed(0).padStart(3)} MB | ` +
      `moving p50 ${m(pct(err.moving, 0.5))}, p95 ${m(pct(err.moving, 0.95))}, p99 ${m(pct(err.moving, 0.99))} | parked p50 ${m(pct(err.parked, 0.5))}, p95 ${m(pct(err.parked, 0.95))} | ` +
      `repacks per replayed second ${(view.stats.repacked / replaySeconds).toFixed(0)} (${VEHICLES} trucks) | stale or absent ${((100 * staleOrMissing) / (staleOrMissing + err.moving.length + err.parked.length)).toFixed(1)}%`,
  );
}
console.log(`\nran in ${((performance.now() - began) / 1000).toFixed(0)} s`);

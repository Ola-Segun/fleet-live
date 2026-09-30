/**
 * What does evaluating alerts cost, per Worker tick, for 5,000 trucks?
 *   pnpm --filter @fleet/alerts bench
 *
 * Snapshots are generated first (60 s of the fleet at 2 Hz, from the simulator
 * through the feed), so only the engine is timed. Five runs, min and median,
 * because a single laptop run swings by 2×.
 *
 * Zone sets: none (speeding and offline only), the two presets, ten zones, and
 * one zone at the importer's 5,000-vertex limit drawn round Apapa, where many
 * trucks are: the case the limit exists for.
 */
import { MODE_CODES, METRES_PER_DEG } from "@fleet/gl";
import { Feed } from "@fleet/feed";
import { PLACES, parseDataset } from "@fleet/routes";
import committed from "@fleet/routes/data/lagos-routes.json";
import { Simulation, buildNetwork } from "@fleet/sim";
import { cpus } from "node:os";
import { AlertEngine, PRESET_ZONES, type FleetFrame, type ZoneSpec } from "../src";

const VEHICLES = 5000;
const sim = new Simulation(buildNetwork(parseDataset(committed)), { seed: 1, vehicleCount: VEHICLES, startTime: Date.UTC(2026, 8, 29, 21, 30, 0) });
const feed = new Feed();
const frames: FleetFrame[] = [];
for (let t = 0; t < 90_000; t += 100) {
  for (const f of sim.advance(100)) feed.ingest(f);
  if (t < 30_000 || (t + 100) % 500 !== 0) continue;
  const ids = [...feed.vehicleIds()].sort((a, b) => a - b);
  const n = ids.length;
  const f: FleetFrame = { displayTime: feed.displayTime(), count: n, ids: Uint32Array.from(ids), lat: new Float64Array(n), lon: new Float64Array(n), speed: new Float32Array(n), mode: new Uint8Array(n), ageMs: new Float32Array(n), ignition: new Uint8Array(n) };
  ids.forEach((id, i) => {
    const e = feed.estimate(id, f.displayTime)!;
    f.lat[i] = e.lat;
    f.lon[i] = e.lon;
    f.speed[i] = e.speed;
    f.mode[i] = MODE_CODES[e.mode];
    f.ageMs[i] = e.ageMs;
    f.ignition[i] = e.ignition ? 1 : 0;
  });
  frames.push(f);
}

const circle = (id: string, [lat, lon]: readonly [number, number], radiusM: number, vertices: number): ZoneSpec => {
  const kx = METRES_PER_DEG * Math.cos((lat * Math.PI) / 180);
  const ring = Array.from({ length: vertices }, (_, k) => {
    const a = (2 * Math.PI * k) / (vertices - 1);
    return [lon + (radiusM * Math.cos(a)) / kx, lat + (radiusM * Math.sin(a)) / METRES_PER_DEG];
  });
  ring[vertices - 1] = ring[0]!;
  return { id, name: id, kind: "depot", alertOnEnter: true, alertOnExit: true, coordinates: [[ring]] };
};
const presets = PRESET_ZONES.map((z) => ({ ...z, id: z.presetId }));
const sets: Record<string, ZoneSpec[]> = {
  "no zones": [],
  "2 presets": presets,
  "10 zones": [...presets, ...PLACES.slice(0, 8).map((p) => circle(p.id, p.at, 800, 64))],
  "1 zone of 5,000 vertices": [circle("big", PLACES.find((p) => p.id === "apapa-port")!.at, 3000, 5000)],
};

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;
console.log(`${VEHICLES} trucks, ${frames.length} snapshots per run (60 s at 2 Hz), 5 runs. ${cpus()[0]?.model ?? ""}`);
for (const [label, zones] of Object.entries(sets)) {
  const perTick: number[] = [];
  for (let run = 0; run < 5; run++) {
    const engine = new AlertEngine();
    engine.setZones(zones);
    engine.evaluate(frames[0]!); // first sight of every truck: not what a steady tick costs
    const t0 = performance.now();
    for (let k = 1; k < frames.length; k++) engine.evaluate(frames[k]!);
    perTick.push((performance.now() - t0) / (frames.length - 1));
  }
  console.log(`  ${label.padEnd(26)} min ${Math.min(...perTick).toFixed(2)} ms, median ${median(perTick).toFixed(2)} ms per evaluation`);
}

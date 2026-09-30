/**
 * Measures the alert engine against the simulator's ground truth.
 *
 *   pnpm --filter @fleet/alerts evaluate
 *
 * Runs a fleet for an hour of simulated time through the default network
 * chaos and the Layer 4 feed, and evaluates alerts twice a second from the
 * feed's display-time estimates, exactly as the Worker does. Alongside, it
 * records what really happened, from `sim.truth()`:
 *
 *   speeding  truth speed over the limit
 *   offline   the tracker had no power, or was in a coverage gap
 *   zones     the truck's true position inside the zone
 *
 * and scores each alert as true or false, each real event as caught or
 * missed, and how late each alert came.
 *
 * Two engines see the same frames: the real rules (20 m margin, 10 s dwell),
 * and a naive one (no margin, no dwell) to show what the rules prevent. One
 * extra zone is deliberately hostile: its edge runs 5 m from where trucks park
 * at Mile 12 Market, so parked trucks sit on the line with GPS noise.
 *
 * Times are data time (the feed's corrected clock) unless marked "shown",
 * which adds the display delay: when the dispatcher could first see it.
 */
import { MODE_CODES, METRES_PER_DEG } from "@fleet/gl";
import { Feed } from "@fleet/feed";
import { parseDataset, PLACES } from "@fleet/routes";
import committed from "@fleet/routes/data/lagos-routes.json";
import { Simulation, buildNetwork, withinRadius } from "@fleet/sim";
import { AlertEngine, DEFAULT_RULES, PRESET_ZONES, prepareZone, signedDistance, type Alert, type FleetFrame, type ZoneSpec } from "../src";

const VEHICLES = Number(process.env.VEHICLES ?? 2000);
const START = Date.UTC(2026, 8, 29, 21, 30, 0); // 22:30 Lagos: light traffic, when speeding is possible
const WARMUP_MS = 180_000;
const MEASURE_MS = Number(process.env.MINUTES ?? 60) * 60_000;
const STEP = 100;
const EVAL_EVERY = 500;
const R = DEFAULT_RULES;

const network = buildNetwork(parseDataset(committed));
const sim = new Simulation(network, { seed: 2026, vehicleCount: VEHICLES, startTime: START });
const feed = new Feed();

// Hostile zones: 400 m squares whose west edge runs through, or 5 m east of, the Mile 12 parking point.
const mile12 = PLACES.find((p) => p.id === "mile-12")!;
const kx = METRES_PER_DEG * Math.cos((mile12.at[0] * Math.PI) / 180);
const arrival = network.paths.find((p) => p.to === "mile-12")!;
const park = [arrival.lat.at(-1)!, arrival.lon.at(-1)!] as const;
const half = 200 / METRES_PER_DEG;
function edgeZone(id: string, offsetM: number): ZoneSpec {
  const w = park[1] + offsetM / kx;
  const e = w + 400 / kx;
  return { id, name: id, kind: "depot", alertOnEnter: true, alertOnExit: true, coordinates: [[[[w, park[0] - half], [e, park[0] - half], [e, park[0] + half], [w, park[0] + half], [w, park[0] - half]]]] };
}
const bridge: ZoneSpec = { ...PRESET_ZONES[0]!, id: "bridge" };
const zones = [bridge, edgeZone("edge-0m", 0), edgeZone("edge-5m", 5)];

const engines = { rules: new AlertEngine(), naive: new AlertEngine({ ...R, marginM: 0, dwellMs: 0, speedDwellMs: 0, speedClearKmh: R.speedLimitKmh }) };
for (const e of Object.values(engines)) e.setZones(zones);

type EngineName = keyof typeof engines;
type TruthKind = "speeding" | "offline" | "bridge";
interface Episode {
  vehicle: number;
  /** Truth speed when it began, km/h. */
  speedAtStart: number;
  start: number;
  end: number;
  peakKmh: number;
  parkedAtStart: boolean;
  /** Per engine: first time (sim clock) an alert for it was active during the episode, else NaN; and whether one was already active when it began. */
  caughtAt: Record<EngineName, number>;
  alreadyActive: Record<EngineName, boolean>;
}
const ALERT_OF: Record<TruthKind, [Alert["kind"], string | undefined]> = { speeding: ["speeding", undefined], offline: ["offline", undefined], bridge: ["zone-enter", "bridge"] };
const perEngine = <T,>(make: () => T): Record<EngineName, Record<TruthKind, T>> => ({
  rules: { speeding: make(), offline: make(), bridge: make() },
  naive: { speeding: make(), offline: make(), bridge: make() },
});
const caughtAt = perEngine(() => new Float64Array(VEHICLES).fill(NaN));
const alreadyActive = perEngine(() => new Uint8Array(VEHICLES));
const truthEpisodes = { speeding: [] as Episode[], offline: [] as Episode[], bridge: [] as Episode[] };
const open = { speeding: new Float64Array(VEHICLES).fill(NaN), offline: new Float64Array(VEHICLES).fill(NaN), bridge: new Float64Array(VEHICLES).fill(NaN) };
const raised: Record<keyof typeof engines, Array<Alert & { shownAt: number }>> = { rules: [], naive: [] };
const preparedBridge = prepareZone(bridge.coordinates, 0);
const peak = new Float64Array(VEHICLES);
const speedAt = { speeding: new Float64Array(VEHICLES), offline: new Float64Array(VEHICLES), bridge: new Float64Array(VEHICLES) };
const parkedAt = { speeding: new Uint8Array(VEHICLES), offline: new Uint8Array(VEHICLES), bridge: new Uint8Array(VEHICLES) };
// Real crossings of the hostile zones: the true position going from 20 m outside to 20 m inside, or back.
const edgeTruth = zones.slice(1).map((z) => ({ id: z.id, prepared: prepareZone(z.coordinates, 40), side: new Int8Array(VEHICLES), crossings: 0 }));
let evalMs = 0;
let evaluations = 0;

function track(kind: keyof typeof open, v: number, on: boolean, t: number, parked = false, kmh = 0) {
  const since = open[kind][v]!;
  if (on && Number.isNaN(since)) {
    open[kind][v] = t;
    speedAt[kind][v] = kmh;
    parkedAt[kind][v] = parked ? 1 : 0;
    if (kind === "speeding") peak[v] = 0;
  } else if (!on && !Number.isNaN(since)) {
    truthEpisodes[kind].push({
      vehicle: v,
      speedAtStart: speedAt[kind][v]!,
      start: since,
      end: t,
      peakKmh: kind === "speeding" ? peak[v]! : 0,
      parkedAtStart: parkedAt[kind][v] === 1,
      caughtAt: { rules: caughtAt.rules[kind][v]!, naive: caughtAt.naive[kind][v]! },
      alreadyActive: { rules: alreadyActive.rules[kind][v] === 1, naive: alreadyActive.naive[kind][v] === 1 },
    });
    for (const name of ["rules", "naive"] as const) caughtAt[name][kind][v] = NaN;
    open[kind][v] = NaN;
  }
}

function snapshot(): FleetFrame {
  const ids = [...feed.vehicleIds()].sort((a, b) => a - b);
  const n = ids.length;
  const f: FleetFrame = { displayTime: feed.displayTime(), count: n, ids: Uint32Array.from(ids), lat: new Float64Array(n), lon: new Float64Array(n), speed: new Float32Array(n), mode: new Uint8Array(n), ageMs: new Float32Array(n), ignition: new Uint8Array(n) };
  ids.forEach((id, i) => {
    const e = feed.estimate(id, f.displayTime);
    if (!e) return;
    f.lat[i] = e.lat;
    f.lon[i] = e.lon;
    f.speed[i] = e.speed;
    f.mode[i] = MODE_CODES[e.mode];
    f.ageMs[i] = e.ageMs;
    f.ignition[i] = e.ignition ? 1 : 0;
  });
  return f;
}

const began = performance.now();
const total = WARMUP_MS + MEASURE_MS;
for (let t = 0; t < total; t += STEP) {
  for (const frame of sim.advance(STEP)) feed.ingest(frame);
  if ((t + STEP) % EVAL_EVERY !== 0) continue;
  const now = sim.now;

  // Truth, sampled at the same rate the engine evaluates. Tracked from the start, scored only
  // for episodes that begin after the warm-up (see score()).
  {
    for (let v = 0; v < VEHICLES; v++) {
      const truth = sim.truth(v);
      peak[v] = Math.max(peak[v]!, truth.speed * 3.6);
      const inGap = sim.gapZones.some((g) => withinRadius([truth.lat, truth.lon], g.center, g.radiusM));
      track("offline", v, truth.deviceOff || inGap, now, truth.status === "loading", truth.speed * 3.6);
      track("speeding", v, truth.speed * 3.6 > R.speedLimitKmh, now, false, truth.speed * 3.6);
      if (now >= START + WARMUP_MS) {
        for (const z of edgeTruth) {
          const d = signedDistance(z.prepared, truth.lat, truth.lon);
          const side = d <= -R.marginM ? 1 : d >= R.marginM ? -1 : 0;
          if (side !== 0 && z.side[v] !== 0 && side !== z.side[v]) z.crossings++;
          if (side !== 0) z.side[v] = side;
        }
      } else {
        for (const z of edgeTruth) {
          const d = signedDistance(z.prepared, truth.lat, truth.lon);
          if (Math.abs(d) >= R.marginM) z.side[v] = d < 0 ? 1 : -1;
        }
      }
      track("bridge", v, signedDistance(preparedBridge, truth.lat, truth.lon) < 0, now);
    }
  }

  const frame = snapshot();
  if (process.env.TRACE) {
    const v = Number(process.env.TRACE);
    const i = frame.ids.indexOf(v);
    const tr = sim.truth(v);
    if (i >= 0 && tr.speed * 3.6 > 55) {
      const mode = ["waiting", "interp", "extrap", "holding", "parked", "stale"][frame.mode[i]!];
      console.log(`${new Date(now).toISOString().slice(11, 21)} truth ${(tr.speed * 3.6).toFixed(1)} | seen ${(frame.speed[i]! * 3.6).toFixed(1)} ${mode} age ${(frame.ageMs[i]! / 1000).toFixed(1)} s${tr.deviceOff ? " OFF" : ""}`);
    }
  }
  for (const [name, engine] of Object.entries(engines) as [keyof typeof engines, AlertEngine][]) {
    const t0 = performance.now();
    engine.evaluate(frame);
    if (name === "rules") {
      evalMs += performance.now() - t0;
      evaluations++;
    }
    const fresh = engine.drainRaised();
    for (const a of fresh) raised[name].push({ ...a, shownAt: now });
    // Which real episodes this engine is alerting on right now.
    for (const kind of ["speeding", "offline", "bridge"] as const) {
      const [alertKind, zoneId] = ALERT_OF[kind];
      for (let v = 0; v < VEHICLES; v++) {
        if (Number.isNaN(open[kind][v]!)) continue;
        const active = engine.isActive(alertKind, v, zoneId);
        if (open[kind][v] === now) alreadyActive[name][kind][v] = active ? 1 : 0;
        if (active && Number.isNaN(caughtAt[name][kind][v]!)) caughtAt[name][kind][v] = now;
      }
    }
  }
}
for (const kind of Object.keys(open) as (keyof typeof open)[]) for (let v = 0; v < VEHICLES; v++) track(kind, v, false, START + total);

// ---- scoring ----

const pct = (xs: number[], q: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))]! : NaN;
};
const s = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
const byVehicle = (eps: Episode[]) => {
  const m = new Map<number, Episode[]>();
  for (const e of eps) (m.get(e.vehicle) ?? m.set(e.vehicle, []).get(e.vehicle)!).push(e);
  return m;
};

/**
 * An alert is true if a real episode for that truck overlaps [raisedAt − lookback, raisedAt + slack].
 * A real episode is caught if an alert for it was active at some point during it, or was raised
 * within `slack` after it ended (the display delay can put the confirmation just past the end).
 * Latency is measured only for episodes whose alert was raised during them; one already active
 * (a truck that dipped under the limit for a moment without the alert ending) has none.
 * `minMs` is the shortest episode the rules promise to catch.
 */
function score(label: string, kind: Alert["kind"], episodes: Episode[], minMs: (e: Episode) => number, lookback: number, slack: number, latencyFrom: (e: Episode) => number) {
  const eps = byVehicle(episodes);
  for (const name of ["rules", "naive"] as const) {
    // Scored from the end of the warm-up. An episode already under way then may have been alerted
    // during the warm-up, or first seen mid-episode (a truck first seen on the bridge hasn't entered it).
    const from = START + WARMUP_MS;
    const alerts = raised[name].filter((a) => a.lastRaisedAt >= from && a.kind === kind && (kind !== "zone-enter" || a.zoneId === "bridge"));
    const trueAlerts = alerts.filter((a) => (eps.get(a.vehicleId) ?? []).some((e) => e.start <= a.lastRaisedAt + slack && e.end >= a.lastRaisedAt - lookback));
    const significant = episodes.filter((e) => e.start >= from && e.end - e.start >= minMs(e));
    const latency: number[] = [];
    const shownLatency: number[] = [];
    let caught = 0;
    for (const e of significant) {
      const hit = alerts.find((a) => a.vehicleId === e.vehicle && a.lastRaisedAt >= e.start - slack && a.lastRaisedAt <= e.end + slack);
      if (!hit && !Number.isNaN(e.caughtAt[name])) {
        caught++;
        continue;
      }
      if (!hit) {
        if (name === "rules" && process.env.DEBUG) console.log(`  missed ${kind} truck ${e.vehicle}: ${new Date(e.start).toISOString().slice(11, 19)} for ${s(e.end - e.start)}${kind === "speeding" ? `, peak ${e.peakKmh.toFixed(1)} km/h` : ""}${e.parkedAtStart ? ", parked when it began" : ""}, ${e.speedAtStart.toFixed(1)} km/h when it began`);
        continue;
      }
      caught++;
      latency.push(hit.lastRaisedAt - latencyFrom(e));
      shownLatency.push(hit.shownAt - latencyFrom(e));
    }
    console.log(
      `${label.padEnd(9)} ${name.padEnd(6)} alerts ${String(alerts.length).padStart(5)}  false ${String(alerts.length - trueAlerts.length).padStart(5)}` +
        `  | real ${String(significant.length).padStart(4)}  caught ${String(caught).padStart(4)}` +
        (latency.length ? `  | late by p50 ${s(pct(latency, 0.5))}, p95 ${s(pct(latency, 0.95))}; shown p50 ${s(pct(shownLatency, 0.5))}` : ""),
    );
  }
}

console.log(`\n${VEHICLES} trucks, ${MEASURE_MS / 60_000} min measured after ${WARMUP_MS / 60_000} min warm-up, from 22:30 Lagos, default network chaos.`);
console.log(`Real events: ${truthEpisodes.speeding.length} speeding episodes, ${truthEpisodes.offline.length} silences (power loss or coverage gap), ${truthEpisodes.bridge.length} bridge visits.\n`);
const threshold = (e: Episode) => (e.parkedAtStart ? R.offlineParkedMs : R.offlineMovingMs);
console.log("Real events counted: speeding for 12 s or more; silences longer than the offline threshold (2 min moving, 10 min parked) plus 5 s; bridge visits of 30 s or more.");
score("speeding", "speeding", truthEpisodes.speeding, () => R.speedDwellMs + 2_000, 15_000, 2_000, (e) => e.start);
score("offline", "offline", truthEpisodes.offline, (e) => threshold(e) + 5_000, 5_000, 5_000, (e) => e.start + threshold(e));
score("bridge", "zone-enter", truthEpisodes.bridge, () => 30_000, 20_000, 2_000, (e) => e.start);

const edgeEvents = (name: keyof typeof engines, zone: string) => raised[name].filter((a) => a.zoneId === zone && a.lastRaisedAt >= START + WARMUP_MS).length;
console.log("");
for (const [zone, where] of [["edge-0m", "through"], ["edge-5m", "5 m from"]] as const) {
  const real = edgeTruth.find((z) => z.id === zone)!.crossings;
  console.log(`hostile edge ${where} where trucks park (GPS σ 4 m): real crossings ${real}; alerts: rules ${edgeEvents("rules", zone)}, naive ${edgeEvents("naive", zone)}`);
}
console.log(`engine cost: ${(evalMs / evaluations).toFixed(2)} ms per evaluation of ${VEHICLES} trucks × ${zones.length} zones (mean of ${evaluations}; single run, see bench.ts for the real measurement)`);
console.log(`ran in ${((performance.now() - began) / 1000).toFixed(0)} s`);

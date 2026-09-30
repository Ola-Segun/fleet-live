/**
 * The fleet Worker: the socket (or the local simulator), the decoder and the
 * Layer 4 feed all run here, off the thread that paints.
 *
 * This file is only glue. Everything it starts is FleetCore from
 * @fleet/transport, which is tested in Node against a real server.
 */
import type { ZoneSpec } from "@fleet/alerts";
import { FleetCore, SocketSource, type FrameSource, type WorkerToMain } from "@fleet/transport";
import type { MainToWorker } from "@/lib/worker-messages";

// The project's TypeScript config targets the DOM, not the Worker global. Only
// these two members are used, so they are typed here rather than pulling in
// the conflicting "webworker" lib.
interface WorkerScope {
  postMessage(message: WorkerToMain, transfer: Transferable[]): void;
  onmessage: ((event: MessageEvent<MainToWorker>) => void) | null;
}
const scope = self as unknown as WorkerScope;

let core: FleetCore | undefined;
let generation = 0;
// Zones outlive a restart (a new seed, network mode): the page sends them once, not per start.
let zones: ZoneSpec[] = [];

/** Today (in Lagos) at `minute` past midnight Lagos time, or now. Lagos is UTC+1 all year. */
function startTimeFor(minute: number | undefined): number {
  const now = Date.now();
  if (minute === undefined) return Math.floor(now / 100) * 100;
  const lagosMidnight = Math.floor((now + 3_600_000) / 86_400_000) * 86_400_000 - 3_600_000;
  return lagosMidnight + minute * 60_000;
}

/** Long enough for a truck to reach cruising speed from rest (55 km/h at 0.6 m/s² takes about 25 s). */
const WARM_UP_MS = 30_000;

async function demoSource(seed: string, vehicleCount: number, startMinute: number | undefined): Promise<FrameSource> {
  // Loaded only in demo mode. Network mode never downloads or parses the 1.3 MB route file.
  const [{ parseDataset }, routes, { Simulation, buildNetwork }, { DemoSource }] = await Promise.all([
    import("@fleet/routes"),
    import("@fleet/routes/data/lagos-routes.json"),
    import("@fleet/sim"),
    import("@fleet/transport"),
  ]);
  const network = buildNetwork(parseDataset(routes.default));
  // Every simulated truck starts at rest, so a fresh fleet crawled for its first 20 s or so and sped up
  // in unison: the first thing a visitor saw. Start the day WARM_UP_MS early and simulate that stretch
  // before going live, so the first frame is traffic already under way. It costs about 1.7 s of Worker
  // time for 5,000 trucks (Layer 3 measured ~55 ms per simulated second), while the map loads anyway.
  const startTime = startTimeFor(startMinute) - WARM_UP_MS;
  const sim = new Simulation(network, { seed, vehicleCount, startTime });
  sim.advance(WARM_UP_MS);
  return new DemoSource(sim);
}

scope.onmessage = async (event) => {
  const message = event.data;
  if (message.type === "zones") {
    zones = message.zones;
    core?.setZones(zones);
    return;
  }
  if (message.type === "replay") {
    core?.setReplay({ at: message.at, wall: message.wall, speed: message.speed, playing: message.playing });
    return;
  }
  if (message.type === "live") {
    core?.setReplay(undefined);
    return;
  }
  if (message.type === "alert") {
    core?.actOnAlert(message.action, message.action === "resolve-cleared" ? undefined : message.id);
    return;
  }
  core?.stop();
  core = undefined;
  if (message.type === "stop") return;

  // A second start can arrive while the first is still loading. Only the latest wins.
  const mine = ++generation;
  const source = message.mode === "network" ? new SocketSource({ url: message.url }) : await demoSource(message.seed, message.vehicleCount, message.startMinute);
  if (mine !== generation) return;
  core = new FleetCore(source, (m, transfer) => scope.postMessage(m, transfer ?? []));
  core.setZones(zones);
  core.start();
};

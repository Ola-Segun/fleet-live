/**
 * The fleet Worker: the socket (or the local simulator), the decoder and the
 * Layer 4 feed all run here, off the thread that paints.
 *
 * This file is only glue. Everything it starts is FleetCore from
 * @fleet/transport, which is tested in Node against a real server.
 */
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

async function demoSource(seed: string, vehicleCount: number): Promise<FrameSource> {
  // Loaded only in demo mode. Network mode never downloads or parses the 1.3 MB route file.
  const [{ parseDataset }, routes, { Simulation, buildNetwork }, { DemoSource }] = await Promise.all([
    import("@fleet/routes"),
    import("@fleet/routes/data/lagos-routes.json"),
    import("@fleet/sim"),
    import("@fleet/transport"),
  ]);
  const network = buildNetwork(parseDataset(routes.default));
  const startTime = Math.floor(Date.now() / 100) * 100;
  return new DemoSource(new Simulation(network, { seed, vehicleCount, startTime }));
}

scope.onmessage = async (event) => {
  const message = event.data;
  core?.stop();
  core = undefined;
  if (message.type === "stop") return;

  // A second start can arrive while the first is still loading. Only the latest wins.
  const mine = ++generation;
  const source = message.mode === "network" ? new SocketSource({ url: message.url }) : await demoSource(message.seed, message.vehicleCount);
  if (mine !== generation) return;
  core = new FleetCore(source, (m, transfer) => scope.postMessage(m, transfer ?? []));
  core.start();
};

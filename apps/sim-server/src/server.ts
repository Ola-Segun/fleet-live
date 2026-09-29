import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { WebSocketServer, type WebSocket } from "ws";
import { FrameType, encodeFrame, type Frame, type Ping } from "@fleet/protocol";
import { parseDataset } from "@fleet/routes";
import committed from "@fleet/routes/data/lagos-routes.json";
import { Simulation, buildNetwork, type ChaosConfig, type DeviceConfig } from "@fleet/sim";
import { Pacer, parseHello } from "@fleet/transport";

export interface SimServerOptions {
  /** 0 picks a free port, which is what the tests use. */
  port?: number;
  host?: string;
  seed?: number | string;
  vehicleCount?: number;
  /** Integer epoch ms, rounded to the step. Defaults to now, so simulated time matches the wall clock. */
  startTime?: number;
  /** Frames kept for resuming clients. 300 frames = 30 s at 10 Hz. */
  historyFrames?: number;
  /** A client must say hello within this long, or it is closed. */
  helloTimeoutMs?: number;
  /** A client this far behind is closed rather than buffered without limit. */
  maxBufferedBytes?: number;
  /** Network chaos between the server and its clients: drop every connection this often. */
  forceDisconnectEveryMs?: number;
  heartbeatMs?: number;
  tickMs?: number;
  chaos?: Partial<ChaosConfig>;
  device?: Partial<DeviceConfig>;
}

export interface SimServerStats {
  clients: number;
  framesBroadcast: number;
  resumes: number;
  snapshots: number;
  slowConsumersClosed: number;
  forcedDisconnects: number;
  badHellos: number;
}

export interface SimServer {
  readonly port: number;
  readonly url: string;
  readonly stats: SimServerStats;
  /** The newest frame number broadcast. */
  lastFrameSeq(): number | undefined;
  close(): Promise<void>;
}

interface Client {
  ws: WebSocket;
  live: boolean;
  alive: boolean;
}

/**
 * The network-mode server: one simulation, paced to the wall clock,
 * broadcast to every client as 10 Hz binary frames.
 *
 * It keeps two things so clients can come back after a drop:
 *   - **history**: the last `historyFrames` encoded frames, so a returning
 *     client gets exactly the frames it missed;
 *   - **latest**: each truck's newest ping, so a new client, or one whose gap
 *     has left the history, can start from a snapshot.
 */
export async function startSimServer(options: SimServerOptions = {}): Promise<SimServer> {
  const o = {
    port: 0,
    host: "127.0.0.1",
    seed: "fleet-live",
    vehicleCount: 5000,
    historyFrames: 300,
    helloTimeoutMs: 2000,
    maxBufferedBytes: 1_000_000,
    heartbeatMs: 10_000,
    tickMs: 100,
    ...options,
  };
  const startTime = o.startTime ?? Math.floor(Date.now() / 100) * 100;
  const sim = new Simulation(buildNetwork(parseDataset(committed)), {
    seed: o.seed,
    vehicleCount: o.vehicleCount,
    startTime,
    ...(o.chaos && { chaos: o.chaos }),
    ...(o.device && { device: o.device }),
  });
  const pacer = new Pacer(sim);
  const vehiclesJson = JSON.stringify(sim.info());

  const stats: SimServerStats = {
    clients: 0,
    framesBroadcast: 0,
    resumes: 0,
    snapshots: 0,
    slowConsumersClosed: 0,
    forcedDisconnects: 0,
    badHellos: 0,
  };
  const history: { seq: number; bytes: Buffer }[] = [];
  const latest = new Map<number, Ping>();
  const clients = new Set<Client>();

  const http = createServer((req: IncomingMessage, res: ServerResponse) => {
    const json = (status: number, body: string) => {
      // Read-only public data; the web app is served from another origin in development.
      res.writeHead(status, { "content-type": "application/json", "access-control-allow-origin": "*" });
      res.end(body);
    };
    if (req.method === "GET" && req.url === "/health") {
      return json(200, JSON.stringify({ ok: true, clients: clients.size, lastFrameSeq: history.at(-1)?.seq ?? null }));
    }
    if (req.method === "GET" && req.url === "/vehicles") return json(200, vehiclesJson);
    json(404, JSON.stringify({ error: "not found" }));
  });

  // Clients only ever send one small hello, so anything bigger is refused at the protocol level.
  const wss = new WebSocketServer({ server: http, path: "/stream", maxPayload: 1024 });

  const snapshotFrame = (): Buffer => {
    const frame: Frame = {
      type: FrameType.Snapshot,
      frameSeq: history.at(-1)?.seq ?? 0,
      baseTime: sim.now,
      pings: [...latest.values()],
    };
    return Buffer.from(encodeFrame(frame));
  };

  wss.on("connection", (ws) => {
    const client: Client = { ws, live: false, alive: true };
    clients.add(client);
    stats.clients = clients.size;
    const helloTimer = setTimeout(() => ws.close(1008, "hello expected"), o.helloTimeoutMs);

    ws.on("pong", () => (client.alive = true));
    ws.on("close", () => {
      clearTimeout(helloTimer);
      clients.delete(client);
      stats.clients = clients.size;
    });
    ws.on("message", (data, isBinary) => {
      if (client.live) return; // one hello per connection; anything after it is ignored
      clearTimeout(helloTimer);
      const hello = isBinary ? undefined : parseHello(data.toString());
      if (!hello) {
        stats.badHellos++;
        ws.close(1008, "bad hello");
        return;
      }
      const oldest = history[0]?.seq;
      const newest = history.at(-1)?.seq;
      const canResume =
        hello.resumeAfter !== undefined &&
        oldest !== undefined &&
        newest !== undefined &&
        hello.resumeAfter >= oldest - 1 &&
        hello.resumeAfter <= newest;
      if (canResume) {
        stats.resumes++;
        for (const f of history) if (f.seq > hello.resumeAfter!) ws.send(f.bytes);
      } else {
        stats.snapshots++;
        ws.send(snapshotFrame());
      }
      client.live = true;
    });
  });

  const broadcast = (frame: Frame) => {
    const bytes = Buffer.from(encodeFrame(frame));
    history.push({ seq: frame.frameSeq, bytes });
    if (history.length > o.historyFrames) history.shift();
    for (const p of frame.pings) {
      const known = latest.get(p.vehicleId);
      if (!known || ((p.seq - known.seq) | 0) > 0) latest.set(p.vehicleId, p);
    }
    for (const c of clients) {
      if (!c.live) continue;
      // Backpressure: a client that can't keep up is closed, not buffered without limit.
      // When it comes back it resumes from history, or gets a snapshot.
      if (c.ws.bufferedAmount > o.maxBufferedBytes) {
        stats.slowConsumersClosed++;
        c.ws.close(1013, "slow consumer");
        c.live = false;
        continue;
      }
      c.ws.send(bytes);
    }
    stats.framesBroadcast++;
  };

  pacer.start();
  const tick = setInterval(() => {
    for (const frame of pacer.tick()) broadcast(frame);
  }, o.tickMs);

  // Heartbeat: terminate clients whose TCP connection died without closing.
  const heartbeat = setInterval(() => {
    for (const c of clients) {
      if (!c.alive) {
        c.ws.terminate();
        continue;
      }
      c.alive = false;
      c.ws.ping();
    }
  }, o.heartbeatMs);

  const chaos =
    o.forceDisconnectEveryMs !== undefined
      ? setInterval(() => {
          for (const c of clients) {
            stats.forcedDisconnects++;
            c.ws.terminate(); // abrupt, like a network drop, not a polite close
          }
        }, o.forceDisconnectEveryMs)
      : undefined;

  await new Promise<void>((resolve) => http.listen(o.port, o.host, resolve));
  const port = (http.address() as AddressInfo).port;

  return {
    port,
    url: `ws://${o.host}:${port}/stream`,
    stats,
    lastFrameSeq: () => history.at(-1)?.seq,
    close: async () => {
      clearInterval(tick);
      clearInterval(heartbeat);
      clearInterval(chaos);
      for (const c of clients) c.ws.terminate();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      await new Promise<void>((resolve) => http.close(() => resolve()));
    },
  };
}

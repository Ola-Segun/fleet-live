import { afterEach, describe, expect, it } from "vitest";
import { WebSocket as WsClient } from "ws";
import { FrameType, decodeFrame, type Frame } from "@fleet/protocol";
import { Feed } from "@fleet/feed";
import { FleetCore, ReconnectingSocket, SocketSource, type WorkerToMain } from "@fleet/transport";
import { startSimServer, type SimServer } from "../src/server";

let server: SimServer | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(condition: () => boolean, timeoutMs = 10_000): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeoutMs) throw new Error("timed out waiting for condition");
    await sleep(20);
  }
}

/** A bare client that decodes every binary message and records how it closed. */
function rawClient(url: string, hello: string | undefined) {
  const ws = new WsClient(url);
  const frames: Frame[] = [];
  let closed: { code: number; reason: string } | undefined;
  ws.on("open", () => hello !== undefined && ws.send(hello));
  ws.on("message", (data: Buffer) => {
    const r = decodeFrame(data);
    if (r.ok) frames.push(r.frame);
  });
  ws.on("close", (code, reason) => (closed = { code, reason: reason.toString() }));
  return { ws, frames, closed: () => closed };
}

describe("sim server", () => {
  it("serves health and the vehicle list over HTTP", async () => {
    server = await startSimServer({ vehicleCount: 20, seed: 1 });
    const health = await (await fetch(`http://127.0.0.1:${server.port}/health`)).json();
    const vehicles = await (await fetch(`http://127.0.0.1:${server.port}/vehicles`)).json();
    expect(health.ok).toBe(true);
    expect(vehicles).toHaveLength(20);
    expect(vehicles[0]).toMatchObject({ id: 0, plate: expect.stringMatching(/^[A-Z]{3}-\d{3}[A-Z]{2}$/) });
  });

  it("gives a new client a snapshot, then consecutive live frames at 10 Hz", async () => {
    server = await startSimServer({ vehicleCount: 100, seed: 2 });
    await sleep(1500); // let some history and latest positions build up
    const c = rawClient(server.url, '{"type":"hello"}');
    await until(() => c.frames.length >= 11);
    c.ws.close();

    expect(c.frames[0]!.type).toBe(FrameType.Snapshot);
    expect(c.frames[0]!.pings.length).toBeGreaterThan(50);
    const live = c.frames.slice(1);
    expect(live.every((f) => f.type === FrameType.Delta)).toBe(true);
    expect(live.map((f) => f.frameSeq)).toEqual(live.map((_, i) => live[0]!.frameSeq + i));
    expect(live[0]!.frameSeq).toBe(c.frames[0]!.frameSeq + 1); // the snapshot is at the last frame; live starts right after
  });

  it("closes a client that never says hello, or says something else", async () => {
    server = await startSimServer({ vehicleCount: 10, seed: 3, helloTimeoutMs: 300 });
    const silent = rawClient(server.url, undefined);
    const rude = rawClient(server.url, "hi there");
    await until(() => silent.closed() !== undefined && rude.closed() !== undefined);
    expect(silent.closed()).toEqual({ code: 1008, reason: "hello expected" });
    expect(rude.closed()).toEqual({ code: 1008, reason: "bad hello" });
    expect(server.stats.badHellos).toBe(1);
  });

  it("sends a snapshot to a client whose resume point has left the history", async () => {
    server = await startSimServer({ vehicleCount: 50, seed: 4, historyFrames: 10 });
    await sleep(2000); // 20 frames: frame 1 is long gone from a 10-frame history
    const c = rawClient(server.url, '{"type":"hello","resumeAfter":1}');
    await until(() => c.frames.length >= 1);
    c.ws.close();
    expect(c.frames[0]!.type).toBe(FrameType.Snapshot);
    expect(server.stats.snapshots).toBe(1);
  });

  it("loses nothing across repeated forced disconnects: every frame arrives exactly once", { timeout: 20_000 }, async () => {
    server = await startSimServer({ vehicleCount: 100, seed: 5, forceDisconnectEveryMs: 800 });
    const frames: Frame[] = [];
    const client = new ReconnectingSocket({ url: server.url, baseDelayMs: 50, maxDelayMs: 200 }, { onFrame: (f) => frames.push(f) });
    client.start();
    await sleep(5000);
    client.stop();

    expect(server.stats.forcedDisconnects).toBeGreaterThanOrEqual(4);
    expect(client.status.resumes).toBeGreaterThanOrEqual(4);
    expect(client.status.snapshots).toBe(0);
    // One snapshot at the very start, then an unbroken run of live frames through every drop.
    expect(frames[0]!.type).toBe(FrameType.Snapshot);
    const seqs = frames.slice(1).map((f) => f.frameSeq);
    expect(seqs).toEqual(seqs.map((_, i) => seqs[0]! + i));
    expect(seqs.length).toBeGreaterThan(35);
  });

  it("runs the worker core end to end over a flaky connection with no frames missed", { timeout: 20_000 }, async () => {
    server = await startSimServer({ vehicleCount: 150, seed: 6, forceDisconnectEveryMs: 1000 });
    const posted: WorkerToMain[] = [];
    const feed = new Feed();
    const core = new FleetCore(new SocketSource({ url: server.url, baseDelayMs: 50, maxDelayMs: 200 }), (m) => posted.push(m), 2, feed);
    core.start();
    await sleep(5000);
    core.stop();

    expect(feed.stats.framesMissed).toBe(0);
    expect(feed.stats.pings).toBeGreaterThan(500);
    const lastSnapshot = posted.filter((m) => m.type === "snapshot").at(-1);
    const lastStatus = posted.filter((m) => m.type === "status").at(-1);
    expect(lastSnapshot?.type === "snapshot" && lastSnapshot.snapshot.count).toBeGreaterThan(100);
    expect(lastStatus?.type === "status" && lastStatus.connection.resumes).toBeGreaterThanOrEqual(3);
  });

  it("closes a client that stops reading, instead of buffering for it forever", { timeout: 30_000 }, async () => {
    server = await startSimServer({ vehicleCount: 5000, seed: 7, maxBufferedBytes: 16_384 });
    const c = rawClient(server.url, '{"type":"hello"}');
    await until(() => c.frames.length >= 1);
    // Stop reading from the socket: the kernel buffers fill, then the server's queue grows.
    (c.ws as unknown as { _socket: { pause(): void } })._socket.pause();
    await until(() => server!.stats.slowConsumersClosed >= 1, 25_000);
    expect(server.stats.slowConsumersClosed).toBe(1);
    c.ws.terminate();
  });
});

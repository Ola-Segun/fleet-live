import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FrameType, encodeFrame, quantize, type Frame } from "@fleet/protocol";
import { parseDataset } from "@fleet/routes";
import committed from "@fleet/routes/data/lagos-routes.json";
import { Simulation, buildNetwork } from "@fleet/sim";
import { Feed } from "@fleet/feed";
import {
  DemoSource,
  FleetCore,
  MODE_CODES,
  Pacer,
  ReconnectingSocket,
  backoffDelay,
  buildSnapshot,
  encodeHello,
  parseHello,
  snapshotTransfer,
  type SocketLike,
  type WorkerToMain,
} from "../src";

const lagos = buildNetwork(parseDataset(committed));
const T0 = Date.UTC(2026, 8, 29, 2, 0, 0);

// ─── Small pieces ───────────────────────────────────────────────────────────

describe("backoff", () => {
  it("draws from 0 up to an exponentially growing, capped ceiling", () => {
    expect(backoffDelay(0, 500, 15_000, () => 0)).toBe(0);
    expect(backoffDelay(0, 500, 15_000, () => 0.5)).toBe(250);
    expect(backoffDelay(3, 500, 15_000, () => 0.5)).toBe(2000); // 0.5 × 500 × 2³
    expect(backoffDelay(10, 500, 15_000, () => 0.5)).toBe(7500); // capped at 15 s, then halved
  });
});

describe("hello", () => {
  it("round-trips, with and without a resume point", () => {
    expect(parseHello(encodeHello(undefined))).toEqual({ type: "hello" });
    expect(parseHello(encodeHello(4242))).toEqual({ type: "hello", resumeAfter: 4242 });
  });

  it("rejects anything else a client might send", () => {
    for (const bad of ["nope", "{}", '{"type":"bye"}', '{"type":"hello","resumeAfter":-1}', '{"type":"hello","resumeAfter":1.5}', '{"type":"hello","resumeAfter":4294967296}', "null"]) {
      expect(parseHello(bad), bad).toBeUndefined();
    }
  });
});

describe("pacer", () => {
  it("advances the simulation to the wall clock in whole steps, carrying the remainder", () => {
    const sim = new Simulation(lagos, { seed: 1, vehicleCount: 5, startTime: T0 });
    let wall = 0;
    const pacer = new Pacer(sim, () => wall);
    pacer.start();
    wall = 350;
    expect(pacer.tick()).toHaveLength(3); // 300 ms of 100 ms frames; 50 ms carried
    wall = 400;
    expect(pacer.tick()).toHaveLength(1);
    expect(sim.now).toBe(T0 + 400);
  });

  it("does not burst after a long pause: simulated time falls behind instead", () => {
    const sim = new Simulation(lagos, { seed: 1, vehicleCount: 5, startTime: T0 });
    let wall = 0;
    const pacer = new Pacer(sim, () => wall, 1000);
    pacer.start();
    wall = 300_000; // five minutes in a hidden tab
    expect(pacer.tick()).toHaveLength(10); // one second's worth, not three thousand frames
    wall = 300_500;
    expect(pacer.tick()).toHaveLength(5);
  });
});

// ─── The reconnecting socket ────────────────────────────────────────────────

class FakeSocket implements SocketLike {
  binaryType = "";
  sent: string[] = [];
  closed: { code?: number; reason?: string } | undefined;
  onopen: SocketLike["onopen"] = null;
  onmessage: SocketLike["onmessage"] = null;
  onclose: SocketLike["onclose"] = null;
  onerror: SocketLike["onerror"] = null;
  send(data: string) {
    this.sent.push(data);
  }
  close(code?: number, reason?: string) {
    this.closed = { code, reason };
  }
  open() {
    this.onopen?.({});
  }
  frame(frame: Frame) {
    this.onmessage?.({ data: encodeFrame(frame) });
  }
  drop() {
    this.onclose?.({ code: 1006, reason: "" });
  }
}

const delta = (frameSeq: number): Frame => ({ type: FrameType.Delta, frameSeq, baseTime: T0 + frameSeq * 100, pings: [] });

describe("reconnecting socket", () => {
  let sockets: FakeSocket[];
  const make = (random = () => 0.5) => {
    const frames: Frame[] = [];
    const s = new ReconnectingSocket(
      {
        url: "ws://test",
        random,
        createSocket: () => {
          const socket = new FakeSocket();
          sockets.push(socket);
          return socket;
        },
      },
      { onFrame: (f) => frames.push(f) },
    );
    return { s, frames };
  };

  beforeEach(() => {
    sockets = [];
    vi.useFakeTimers();
    vi.setSystemTime(T0);
  });
  afterEach(() => vi.useRealTimers());

  it("says hello on open, then resumes from the last frame after a drop", () => {
    const { s, frames } = make();
    s.start();
    sockets[0]!.open();
    expect(sockets[0]!.sent).toEqual(['{"type":"hello"}']);
    sockets[0]!.frame(delta(41));
    sockets[0]!.frame(delta(42));
    sockets[0]!.drop();

    expect(s.status.state).toBe("waiting");
    vi.advanceTimersByTime(s.status.nextRetryAt! - Date.now());
    sockets[1]!.open();
    expect(sockets[1]!.sent).toEqual(['{"type":"hello","resumeAfter":42}']);
    sockets[1]!.frame(delta(43));
    expect(frames.map((f) => f.frameSeq)).toEqual([41, 42, 43]);
    expect(s.status).toMatchObject({ reconnects: 1, resumes: 1, snapshots: 0 });
  });

  it("counts a snapshot when the server couldn't resume", () => {
    const { s } = make();
    s.start();
    sockets[0]!.open();
    sockets[0]!.frame(delta(5));
    sockets[0]!.drop();
    vi.runOnlyPendingTimers();
    sockets[1]!.open();
    sockets[1]!.frame({ ...delta(900), type: FrameType.Snapshot });
    expect(s.status).toMatchObject({ resumes: 0, snapshots: 1 });
  });

  it("backs off exponentially while connections keep failing", () => {
    const { s } = make(() => 0.999);
    s.start();
    const waits: number[] = [];
    for (let i = 0; i < 6; i++) {
      sockets.at(-1)!.drop(); // fails before ever opening
      waits.push(Math.round(s.status.nextRetryAt! - Date.now()));
      vi.runOnlyPendingTimers();
    }
    expect(waits).toEqual([999, 1998, 3996, 7992, 14985, 14985]); // 0.999 × 500 × 2^n, capped at 15 s
  });

  it("starts the backoff over after a connection that stayed up", () => {
    const { s } = make(() => 0.999);
    s.start();
    for (let i = 0; i < 3; i++) {
      sockets.at(-1)!.drop();
      vi.runOnlyPendingTimers();
    }
    expect(s.status.attempt).toBe(3);
    const socket = sockets.at(-1)!;
    socket.open();
    for (let seq = 0; seq < 120; seq++) {
      vi.advanceTimersByTime(100);
      socket.frame(delta(seq)); // 12 s of healthy frames
    }
    socket.drop();
    expect(s.status.attempt).toBe(0);
  });

  it("gives up on a connection that goes silent, without waiting for it to close", () => {
    const { s } = make();
    s.start();
    const socket = sockets[0]!;
    socket.open();
    socket.frame(delta(1));
    vi.advanceTimersByTime(2001);
    expect(socket.closed).toEqual({ code: 4000, reason: "silent" });
    expect(s.status.state).toBe("waiting");
  });

  it("counts and skips bytes that aren't a frame", () => {
    const { s, frames } = make();
    s.start();
    sockets[0]!.open();
    sockets[0]!.onmessage?.({ data: new Uint8Array([1, 2, 3]).buffer });
    sockets[0]!.frame(delta(7));
    expect(s.status.badFrames).toBe(1);
    expect(frames).toHaveLength(1);
  });

  it("stays stopped after stop()", () => {
    const { s } = make();
    s.start();
    sockets[0]!.open();
    s.stop();
    expect(sockets[0]!.closed?.code).toBe(1000);
    vi.advanceTimersByTime(60_000);
    expect(sockets).toHaveLength(1);
  });
});

// ─── Demo mode and the Worker core ──────────────────────────────────────────

describe("demo source and worker core", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
  });
  afterEach(() => vi.useRealTimers());

  it("paces the simulator to the clock, and every frame has crossed the codec", () => {
    const sim = new Simulation(lagos, { seed: 3, vehicleCount: 50, startTime: T0 });
    const twin = new Simulation(lagos, { seed: 3, vehicleCount: 50, startTime: T0 });
    const frames: Frame[] = [];
    const source = new DemoSource(sim);
    source.start((f) => frames.push(f));
    vi.advanceTimersByTime(3000);
    source.stop();

    expect(frames).toHaveLength(30);
    // What arrived is what the same simulation produces, after quantisation by the wire format.
    const expected = twin.advance(3000);
    expect(frames).toEqual(expected.map((f) => ({ ...f, pings: f.pings.map(quantize) })));
  });

  it("posts a status and a transferable snapshot twice a second", () => {
    const sim = new Simulation(lagos, { seed: 4, vehicleCount: 80, startTime: T0 });
    const posted: { message: WorkerToMain; transfer?: Transferable[] }[] = [];
    const core = new FleetCore(new DemoSource(sim), (message, transfer) => posted.push({ message, transfer }));
    core.start();
    vi.advanceTimersByTime(5000);
    core.stop();

    const snapshots = posted.filter((p) => p.message.type === "snapshot");
    const statuses = posted.filter((p) => p.message.type === "status");
    expect(snapshots).toHaveLength(10);
    expect(statuses).toHaveLength(10);
    const last = snapshots.at(-1)!;
    if (last.message.type !== "snapshot") throw new Error("unreachable");
    expect(last.message.snapshot.count).toBeGreaterThan(70);
    expect(last.transfer).toHaveLength(7);
    expect(new Set(last.transfer).size).toBe(7); // seven distinct buffers, nothing shared
  });
});

describe("snapshot", () => {
  it("lays out every known truck as parallel typed arrays", () => {
    const feed = new Feed();
    const sim = new Simulation(lagos, { seed: 5, vehicleCount: 30, startTime: T0 });
    for (const f of sim.advance(20_000)) feed.ingest(f);
    const snap = buildSnapshot(feed);
    const ids = [...feed.vehicleIds()].sort((a, b) => a - b);

    expect(Array.from(snap.ids)).toEqual(ids);
    for (const array of [snap.lat, snap.lon, snap.heading, snap.speed, snap.mode, snap.ageMs]) expect(array.length).toBe(ids.length);
    const i = 3;
    const e = feed.estimate(ids[i]!, snap.displayTime)!;
    expect(snap.lat[i]).toBe(e.lat);
    expect(snap.mode[i]).toBe(MODE_CODES[e.mode]);
    expect(snapshotTransfer(snap)).toHaveLength(7);
  });
});

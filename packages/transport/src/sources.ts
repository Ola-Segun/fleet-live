import { decodeFrame, encodeFrame, type Frame } from "@fleet/protocol";
import type { Simulation, VehicleInfo } from "@fleet/sim";
import { ReconnectingSocket, type ConnectionStatus, type ReconnectOptions } from "./connection";
import { Pacer } from "./pacer";

/** Anything that produces frames: the real socket, or the simulator running locally. */
export interface FrameSource {
  readonly mode: "network" | "demo";
  start(onFrame: (frame: Frame) => void): void;
  stop(): void;
  status(): ConnectionStatus;
  /** Plate and driver for every vehicle. Frames carry only ids, so the page needs this once. */
  vehicles(): Promise<VehicleInfo[]>;
}

export class SocketSource implements FrameSource {
  readonly mode = "network" as const;
  private socket: ReconnectingSocket | undefined;

  constructor(private readonly options: ReconnectOptions) {}

  start(onFrame: (frame: Frame) => void): void {
    this.socket = new ReconnectingSocket(this.options, { onFrame });
    this.socket.start();
  }

  stop(): void {
    this.socket?.stop();
  }

  status(): ConnectionStatus {
    return this.socket ? { ...this.socket.status } : idle("stopped");
  }

  /** The server lists its fleet at `/vehicles` on the same host: ws://host/stream → http://host/vehicles. */
  async vehicles(): Promise<VehicleInfo[]> {
    const url = new URL(this.options.url);
    url.protocol = url.protocol === "wss:" ? "https:" : "http:";
    url.pathname = "/vehicles";
    const res = await fetch(url);
    if (!res.ok) throw new Error(`vehicle list: HTTP ${res.status}`);
    return (await res.json()) as VehicleInfo[];
  }
}

/**
 * Demo mode: the simulator runs in this thread (the Worker), paced to the wall
 * clock, so the public link works with no server at all.
 *
 * **Every frame is encoded to bytes and decoded again**, exactly as if it had
 * crossed the network. It costs a little, and it means demo mode runs the same
 * codec path as network mode, not a shortcut around it.
 */
export class DemoSource implements FrameSource {
  readonly mode = "demo" as const;
  private timer: ReturnType<typeof setInterval> | undefined;
  private readonly pacer: Pacer;
  private lastFrameSeq: number | undefined;
  private lastFrameAt: number | undefined;

  constructor(
    private readonly sim: Simulation,
    private readonly now: () => number = Date.now,
    private readonly tickMs = 100,
  ) {
    this.pacer = new Pacer(sim, now);
  }

  async vehicles(): Promise<VehicleInfo[]> {
    return this.sim.info();
  }

  start(onFrame: (frame: Frame) => void): void {
    this.pacer.start();
    this.timer = setInterval(() => {
      for (const frame of this.pacer.tick()) {
        const result = decodeFrame(encodeFrame(frame));
        if (!result.ok) throw new Error(`demo frame failed to round-trip: ${result.error.message}`);
        this.lastFrameSeq = result.frame.frameSeq;
        this.lastFrameAt = this.now();
        onFrame(result.frame);
      }
    }, this.tickMs);
  }

  stop(): void {
    clearInterval(this.timer);
    this.timer = undefined;
  }

  status(): ConnectionStatus {
    return { ...idle(this.timer ? "open" : "stopped"), lastFrameSeq: this.lastFrameSeq, lastFrameAt: this.lastFrameAt };
  }
}

function idle(state: ConnectionStatus["state"]): ConnectionStatus {
  return {
    state,
    attempt: 0,
    nextRetryAt: undefined,
    lastFrameAt: undefined,
    lastFrameSeq: undefined,
    reconnects: 0,
    resumes: 0,
    snapshots: 0,
    badFrames: 0,
  };
}

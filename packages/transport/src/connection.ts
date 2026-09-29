import { FrameType, decodeFrame, type Frame } from "@fleet/protocol";
import { backoffDelay } from "./backoff";
import { encodeHello } from "./control";

/** The parts of the standard WebSocket this uses, so tests can supply a fake. */
export interface SocketLike {
  binaryType: string;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: ((event: { code: number; reason: string }) => void) | null;
  onerror: ((event: unknown) => void) | null;
}

export type ConnectionState = "connecting" | "open" | "waiting" | "stopped";

export interface ConnectionStatus {
  state: ConnectionState;
  /** Consecutive failed attempts. Reset once a connection has stayed up for `stableAfterMs`. */
  attempt: number;
  /** When the next attempt will start, while `waiting`. */
  nextRetryAt: number | undefined;
  lastFrameAt: number | undefined;
  lastFrameSeq: number | undefined;
  reconnects: number;
  /** Reconnects that resumed from history, with no frames lost. */
  resumes: number;
  /** Reconnects where the server sent a snapshot because history had moved on. */
  snapshots: number;
  /** Binary messages that failed to decode. They are counted and skipped, never fatal. */
  badFrames: number;
}

export interface ReconnectOptions {
  url: string;
  baseDelayMs?: number;
  maxDelayMs?: number;
  /** A connection up this long counts as healthy, and the backoff starts over. */
  stableAfterMs?: number;
  /**
   * No frame for this long means the connection is dead even if the socket
   * hasn't noticed. The server sends 10 frames a second, even empty ones.
   */
  silenceTimeoutMs?: number;
  random?: () => number;
  now?: () => number;
  createSocket?: (url: string) => SocketLike;
}

export interface ConnectionHandlers {
  onFrame(frame: Frame): void;
  onStatus?(status: ConnectionStatus): void;
}

/**
 * A WebSocket that reconnects by itself and resumes where it left off.
 *
 *   connecting → open → (drop) → waiting → connecting → …
 *
 * - On open it sends `hello` with the last frame number it saw, so the server
 *   can replay exactly what was missed.
 * - A drop schedules a retry with jittered exponential backoff. A connection
 *   that stayed up long enough resets the backoff.
 * - A silence watchdog catches connections that are dead but not closed: a
 *   laptop waking from sleep, or a proxy that swallowed the FIN. It tears them
 *   down without waiting for the browser's slow close handshake.
 */
export class ReconnectingSocket {
  private socket: SocketLike | undefined;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private silenceTimer: ReturnType<typeof setTimeout> | undefined;
  private openedAt = 0;
  private sentResume = false;
  private readonly o: Required<ReconnectOptions>;
  readonly status: ConnectionStatus = {
    state: "stopped",
    attempt: 0,
    nextRetryAt: undefined,
    lastFrameAt: undefined,
    lastFrameSeq: undefined,
    reconnects: 0,
    resumes: 0,
    snapshots: 0,
    badFrames: 0,
  };

  constructor(options: ReconnectOptions, private readonly handlers: ConnectionHandlers) {
    this.o = {
      baseDelayMs: 500,
      maxDelayMs: 15_000,
      stableAfterMs: 10_000,
      silenceTimeoutMs: 2000,
      random: Math.random,
      now: Date.now,
      createSocket: (url) => {
        const ws = new WebSocket(url);
        return ws as unknown as SocketLike;
      },
      ...options,
    };
  }

  start(): void {
    if (this.status.state !== "stopped") return;
    this.connect();
  }

  stop(): void {
    this.status.state = "stopped";
    clearTimeout(this.retryTimer);
    clearTimeout(this.silenceTimer);
    const socket = this.socket;
    this.socket = undefined;
    if (socket) {
      detach(socket);
      socket.close(1000, "client stopped");
    }
    this.emit();
  }

  private emit(): void {
    this.handlers.onStatus?.({ ...this.status });
  }

  private connect(): void {
    this.status.state = "connecting";
    this.status.nextRetryAt = undefined;
    this.emit();

    const socket = this.o.createSocket(this.o.url);
    this.socket = socket;
    socket.binaryType = "arraybuffer";

    socket.onopen = () => {
      this.openedAt = this.o.now();
      this.sentResume = this.status.lastFrameSeq !== undefined;
      socket.send(encodeHello(this.status.lastFrameSeq));
      this.status.state = "open";
      this.armSilence();
      this.emit();
    };

    socket.onmessage = (event) => {
      if (!(event.data instanceof ArrayBuffer)) return; // the server only sends binary frames
      const result = decodeFrame(event.data);
      if (!result.ok) {
        this.status.badFrames++;
        return;
      }
      const frame = result.frame;
      if (this.sentResume) {
        // The first frame after a resume tells us which way the server went.
        if (frame.type === FrameType.Snapshot) this.status.snapshots++;
        else this.status.resumes++;
        this.sentResume = false;
      }
      this.status.lastFrameSeq = frame.frameSeq;
      this.status.lastFrameAt = this.o.now();
      this.armSilence();
      this.handlers.onFrame(frame);
    };

    socket.onerror = () => {
      // Always followed by close, which does the work.
    };
    socket.onclose = () => this.dropped();
  }

  private armSilence(): void {
    clearTimeout(this.silenceTimer);
    this.silenceTimer = setTimeout(() => {
      // Dead but not closed. Don't wait for a close handshake that may never finish.
      const socket = this.socket;
      if (socket) {
        detach(socket);
        socket.close(4000, "silent");
      }
      this.dropped();
    }, this.o.silenceTimeoutMs);
  }

  private dropped(): void {
    clearTimeout(this.silenceTimer);
    if (this.socket) detach(this.socket);
    this.socket = undefined;
    if (this.status.state === "stopped") return;

    const wasOpen = this.status.state === "open";
    const stable = wasOpen && this.o.now() - this.openedAt >= this.o.stableAfterMs;
    this.status.attempt = stable ? 0 : this.status.attempt + 1;
    this.status.reconnects++;
    const delay = backoffDelay(this.status.attempt, this.o.baseDelayMs, this.o.maxDelayMs, this.o.random);
    this.status.state = "waiting";
    this.status.nextRetryAt = this.o.now() + delay;
    this.emit();
    this.retryTimer = setTimeout(() => this.connect(), delay);
  }
}

function detach(socket: SocketLike): void {
  socket.onopen = null;
  socket.onmessage = null;
  socket.onclose = null;
  socket.onerror = null;
}

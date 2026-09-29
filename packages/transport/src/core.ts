import { Feed, type FeedStats } from "@fleet/feed";
import { FLOATS_PER_VEHICLE, packVehicle } from "@fleet/gl";
import type { ConnectionStatus } from "./connection";
import { buildSnapshot, snapshotTransfer, type FleetSnapshot } from "./snapshot";
import type { FrameSource } from "./sources";

/**
 * Rows for the GPU: every vehicle whose track changed since the last message,
 * packed exactly as the sample texture stores it (see @fleet/gl layout.ts), and
 * the clock the page needs to pick a display time between messages.
 */
export interface RowsMessage {
  type: "rows";
  /** Session epoch, ms. Sample times in `data` are seconds since this. */
  epoch: number;
  serverTime: number;
  delayMs: number;
  /** Slots in use. A vehicle's slot never changes, so its texture row never moves. */
  count: number;
  slots: Uint32Array;
  data: Float32Array;
  /** Vehicle ids for newly assigned slots, in slot order, starting at slot `count − newIds.length`. */
  newIds: number[];
}

/** Messages from the Worker to the page. */
export type WorkerToMain =
  | { type: "status"; mode: FrameSource["mode"]; connection: ConnectionStatus; feed: FeedStats; delayMs: number }
  | { type: "snapshot"; snapshot: FleetSnapshot }
  | RowsMessage;

export type Post = (message: WorkerToMain, transfer?: Transferable[]) => void;

/**
 * What runs inside the Worker: a frame source feeding the Layer 4 feed, and two
 * timers: a status report and a snapshot `snapshotHz` times a second (for the
 * page's UI), and GPU rows `rowsHz` times a second (for the truck layer).
 *
 * It takes `post` as a function rather than calling `self.postMessage`, so it
 * runs unchanged in a Node test. The Worker entry (Layer 6) is a few lines
 * that wire `self.postMessage` and `self.onmessage` to this.
 */
export class FleetCore {
  readonly feed: Feed;
  private timer: ReturnType<typeof setInterval> | undefined;
  private rowsTimer: ReturnType<typeof setInterval> | undefined;
  private readonly slots = new Map<number, number>();
  private epoch: number | undefined;

  constructor(
    private readonly source: FrameSource,
    private readonly post: Post,
    private readonly snapshotHz = 2,
    feed?: Feed,
    private readonly rowsHz = 10,
  ) {
    this.feed = feed ?? new Feed();
  }

  start(): void {
    this.source.start((frame) => this.feed.ingest(frame));
    this.timer = setInterval(() => this.publish(), 1000 / this.snapshotHz);
    this.rowsTimer = setInterval(() => this.publishRows(), 1000 / this.rowsHz);
  }

  stop(): void {
    clearInterval(this.timer);
    clearInterval(this.rowsTimer);
    this.timer = undefined;
    this.rowsTimer = undefined;
    this.source.stop();
  }

  publish(): void {
    this.post({
      type: "status",
      mode: this.source.mode,
      connection: this.source.status(),
      feed: { ...this.feed.stats },
      delayMs: this.feed.delayMs,
    });
    const snapshot = buildSnapshot(this.feed);
    this.post({ type: "snapshot", snapshot }, snapshotTransfer(snapshot));
  }

  /** Rows for the GPU: only the vehicles that changed since the last call. */
  publishRows(): void {
    if (this.feed.serverTime === 0) return; // nothing received yet
    // Fixed at the first report, in whole seconds, so float32 sample times start small.
    this.epoch ??= Math.floor(this.feed.serverTime / 1000) * 1000;
    const changed = this.feed.drainChanged();
    const newIds: number[] = [];
    const slots = new Uint32Array(changed.size);
    const data = new Float32Array(changed.size * FLOATS_PER_VEHICLE);
    let i = 0;
    for (const id of changed) {
      let slot = this.slots.get(id);
      if (slot === undefined) {
        slot = this.slots.size;
        this.slots.set(id, slot);
        newIds.push(id);
      }
      slots[i] = slot;
      packVehicle(this.feed.track(id)!.resolve(), this.epoch, data, i * FLOATS_PER_VEHICLE);
      i++;
    }
    this.post(
      {
        type: "rows",
        epoch: this.epoch,
        serverTime: this.feed.serverTime,
        delayMs: this.feed.delayMs,
        count: this.slots.size,
        slots,
        data,
        newIds,
      },
      [slots.buffer, data.buffer],
    );
  }
}

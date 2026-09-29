import { Feed, type FeedStats } from "@fleet/feed";
import type { ConnectionStatus } from "./connection";
import { buildSnapshot, snapshotTransfer, type FleetSnapshot } from "./snapshot";
import type { FrameSource } from "./sources";

/** Messages from the Worker to the page. */
export type WorkerToMain =
  | { type: "status"; mode: FrameSource["mode"]; connection: ConnectionStatus; feed: FeedStats; delayMs: number }
  | { type: "snapshot"; snapshot: FleetSnapshot };

export type Post = (message: WorkerToMain, transfer?: Transferable[]) => void;

/**
 * What runs inside the Worker: a frame source feeding the Layer 4 feed, and a
 * timer that posts the page a snapshot and a status report `snapshotHz` times a
 * second.
 *
 * It takes `post` as a function rather than calling `self.postMessage`, so it
 * runs unchanged in a Node test. The Worker entry (Layer 6) is a few lines
 * that wire `self.postMessage` and `self.onmessage` to this.
 */
export class FleetCore {
  readonly feed: Feed;
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(
    private readonly source: FrameSource,
    private readonly post: Post,
    private readonly snapshotHz = 2,
    feed?: Feed,
  ) {
    this.feed = feed ?? new Feed();
  }

  start(): void {
    this.source.start((frame) => this.feed.ingest(frame));
    this.timer = setInterval(() => this.publish(), 1000 / this.snapshotHz);
  }

  stop(): void {
    clearInterval(this.timer);
    this.timer = undefined;
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
}

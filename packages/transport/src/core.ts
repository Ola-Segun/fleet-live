import { AlertEngine, type Alert, type ZoneSpec } from "@fleet/alerts";
import { Feed, type FeedStats } from "@fleet/feed";
import { History, ReplayView } from "@fleet/replay";
import { FLOATS_PER_VEHICLE, packVehicle } from "@fleet/gl";
import type { VehicleInfo } from "@fleet/sim";
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

/**
 * The open alerts, sent whenever they or the zone counts change (at most at the
 * snapshot rate), and straight after the dispatcher acts on one. A few hundred
 * small objects at most: cheap to clone, unlike the fleet snapshot.
 */
export interface AlertsMessage {
  type: "alerts";
  alerts: Alert[];
  zoneCounts: Array<[zoneId: string, trucksInside: number]>;
  /** Ids raised (or raised again) since the last message: what to announce. */
  raised: number[];
}

/**
 * Replay as the page asked for it: the data time `at` it showed at wall-clock
 * time `wall` (Date.now()), advancing at `speed` × real time while playing.
 * Page and Worker each run this same clock, so neither waits for the other.
 */
export interface ReplayRequest {
  at: number;
  wall: number;
  speed: number;
  playing: boolean;
}

/** What replay can reach, and what it costs to keep. */
export interface HistoryStatus {
  from: number;
  to: number;
  bytes: number;
}

/** Messages from the Worker to the page. */
export type WorkerToMain =
  | {
      type: "status";
      mode: FrameSource["mode"];
      connection: ConnectionStatus;
      feed: FeedStats;
      delayMs: number;
      /** Undefined until two frames are recorded. */
      history: HistoryStatus | undefined;
      /** The replay time the Worker is drawing, or undefined when live. */
      replayAt: number | undefined;
    }
  | AlertsMessage
  | { type: "snapshot"; snapshot: FleetSnapshot }
  | { type: "vehicles"; vehicles: VehicleInfo[] }
  | { type: "error"; message: string }
  | RowsMessage;

export type Post = (message: WorkerToMain, transfer?: Transferable[]) => void;

/**
 * What runs inside the Worker: a frame source feeding the Layer 4 feed, and two
 * timers: a status report and a snapshot `snapshotHz` times a second (for the
 * page's UI), and GPU rows `rowsHz` times a second (for the truck layer).
 *
 * Alerts (Layer 8b) are evaluated on each snapshot, before it is posted: the
 * snapshot's buffers are transferred, so after posting they are gone.
 *
 * Replay (Layer 9): every 5 s of display time the fleet is recorded into the
 * history. In replay, the rows and the snapshot come from the history at the
 * replay time instead of the live feed, through the same message types, so the
 * page's renderer, list and details panel don't know the difference. Alerts
 * and recording carry on live underneath.
 *
 * It takes `post` as a function rather than calling `self.postMessage`, so it
 * runs unchanged in a Node test. The Worker entry (Layer 6) is a few lines
 * that wire `self.postMessage` and `self.onmessage` to this.
 */
export class FleetCore {
  readonly feed: Feed;
  readonly alerts: AlertEngine;
  private timer: ReturnType<typeof setInterval> | undefined;
  private rowsTimer: ReturnType<typeof setInterval> | undefined;
  private readonly slots = new Map<number, number>();
  private epoch: number | undefined;
  readonly history: History;
  private replay: ReplayRequest | undefined;
  private view: ReplayView | undefined;
  /** After replay, every truck's live row must be sent again: the page's rows are replay's. */
  private repackAll = false;

  constructor(
    private readonly source: FrameSource,
    private readonly post: Post,
    private readonly snapshotHz = 2,
    feed?: Feed,
    private readonly rowsHz = 10,
    alerts?: AlertEngine,
    history?: History,
    private readonly now: () => number = Date.now,
  ) {
    this.feed = feed ?? new Feed();
    this.alerts = alerts ?? new AlertEngine();
    this.history = history ?? new History();
  }

  /** Enter replay, change it (scrub, speed, pause), or leave it with `undefined`. */
  setReplay(request: ReplayRequest | undefined): void {
    if (request && this.epoch === undefined) return; // nothing drawn yet, so nothing to replay
    if (request && !this.view) {
      this.view = new ReplayView(this.history, this.epoch!);
    }
    if (!request && this.view) {
      this.view = undefined;
      this.repackAll = true;
    }
    // A jump or a new speed: every packed window may be for the wrong time now.
    this.view?.invalidateAll();
    this.replay = request;
  }

  /** The data time replay is at, kept inside what the history holds. */
  replayTime(): number | undefined {
    const r = this.replay;
    const range = this.history.range();
    if (!r || !range) return undefined;
    const t = r.at + (r.playing ? (this.now() - r.wall) * r.speed : 0);
    return Math.min(range.to, Math.max(range.from, t));
  }

  start(): void {
    this.source.start((frame) => this.feed.ingest(frame));
    // Plates and drivers, once. A failure is reported, not fatal: the map still works with ids.
    this.source.vehicles().then(
      (vehicles) => this.post({ type: "vehicles", vehicles }),
      (error: unknown) => this.post({ type: "error", message: `Couldn't load vehicle details: ${(error as Error).message}` }),
    );
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
    const range = this.history.range();
    const replayAt = this.replayTime();
    this.post({
      type: "status",
      mode: this.source.mode,
      connection: this.source.status(),
      feed: { ...this.feed.stats },
      delayMs: this.feed.delayMs,
      history: range && { ...range, bytes: this.history.stats().bytes },
      replayAt,
    });
    const live = buildSnapshot(this.feed);
    if (live.count > 0 && this.alerts.evaluate(live)) this.publishAlerts();
    // Record the fleet when display time crosses the next grid time (every 5 s).
    const due = live.count > 0 ? this.history.due(live.displayTime) : undefined;
    if (due !== undefined) this.history.record(due === live.displayTime ? live : buildSnapshot(this.feed, due));

    const snapshot: FleetSnapshot =
      this.view && replayAt !== undefined
        ? { ...this.view.snapshot(replayAt, this.slots), serverTime: this.feed.serverTime, delayMs: this.feed.delayMs }
        : live;
    this.post({ type: "snapshot", snapshot }, snapshotTransfer(snapshot));
  }

  publishAlerts(): void {
    this.post({ type: "alerts", alerts: this.alerts.alerts(), zoneCounts: this.alerts.zoneCounts(), raised: this.alerts.drainRaised().map((a) => a.id) });
  }

  setZones(zones: readonly ZoneSpec[]): void {
    this.alerts.setZones(zones);
    this.publishAlerts();
  }

  /** The dispatcher acted on an alert. Answered at once, not at the next snapshot, so the list responds to the click. */
  actOnAlert(action: "acknowledge" | "resolve" | "resolve-cleared", id?: number): void {
    if (action === "resolve-cleared") this.alerts.resolveCleared();
    else if (id !== undefined) this.alerts[action](id);
    this.publishAlerts();
  }

  /**
   * Rows for the GPU. Live: only the vehicles that changed since the last call
   * (all of them, just after replay). Replay: only the trucks whose packed
   * samples no longer cover the replay time.
   */
  publishRows(): void {
    if (this.feed.serverTime === 0) return; // nothing received yet
    // Fixed at the first report, in whole seconds, so float32 sample times start small.
    this.epoch ??= Math.floor(this.feed.serverTime / 1000) * 1000;
    const changed = this.feed.drainChanged();
    const newIds: number[] = [];
    for (const id of changed) {
      if (this.slots.has(id)) continue;
      this.slots.set(id, this.slots.size);
      newIds.push(id);
    }
    const replayAt = this.replayTime();
    let slots: Uint32Array;
    let data: Float32Array;
    if (this.view && replayAt !== undefined) {
      ({ slots, data } = this.view.update(replayAt, this.slots));
    } else {
      const ids = this.repackAll ? [...this.feed.vehicleIds()] : [...changed];
      this.repackAll = false;
      slots = new Uint32Array(ids.length);
      data = new Float32Array(ids.length * FLOATS_PER_VEHICLE);
      ids.forEach((id, i) => {
        slots[i] = this.slots.get(id)!;
        packVehicle(this.feed.track(id)!.resolve(), this.epoch!, data, i * FLOATS_PER_VEHICLE);
      });
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

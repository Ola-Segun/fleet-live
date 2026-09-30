import { ALL_GROUPS, DisplayClock, SampleMirror, VEHICLES_PER_ROW, modeMask, slotEstimate, textureHeight, type StatusGroup } from "@fleet/gl";
import type { RowsMessage } from "@fleet/transport";

/**
 * Everything the truck layer draws from, owned by the page from the Worker's
 * first message, not by the layer.
 *
 * Rows carry only the vehicles that *changed*. The map finishes loading after
 * the Worker has already started sending, so a layer that collected rows
 * itself would miss the early ones: parked trucks would stay invisible until
 * their next report, 30 s away, and the slot-to-vehicle list would be wrong.
 * Keeping this state outside the layer means it doesn't matter when the layer
 * is added, removed or rebuilt after a lost WebGL context.
 */
export class FleetGpuState {
  readonly mirror = new SampleMirror(1000);
  readonly clock = new DisplayClock();
  /** Vehicle id for each slot, in slot order. */
  readonly slotIds: number[] = [];
  /** And the other way round. */
  readonly slotOf = new Map<number, number>();
  epoch: number | undefined;
  /** Display time of the last frame drawn (server clock, ms). Picking and following read it, so they match the pixels. */
  lastDisplay: number | undefined;
  /**
   * The selected vehicle, by id. Its slot is looked up when drawing, because a
   * truck selected from the URL may not have a slot yet: its first rows may
   * still be on the way.
   */
  selectedId: number | undefined;
  /** Status filter as a bit mask over mode codes (see @fleet/gl modeMask). */
  mask = modeMask(ALL_GROUPS);
  /** Dark basemap: the selection ring is drawn light instead of navy, or it would vanish. */
  dark = false;
  rowsReceived = 0;
  /** Vehicles with an active alert, drawn as diamonds above the rest. */
  private alertIds: ReadonlySet<number> = new Set();
  private alertBytes = new Uint8Array(0);
  private alertsDirty = true;
  /** Bumped whenever the alert texture's bytes change, so the layer uploads only then. */
  alertVersion = 0;
  alertCount = 0;
  /**
   * Replay (Layer 9): the data time `at` shown at local time `local`
   * (performance.now()), advancing at `speed` × real time while playing.
   * While set, it replaces the live display clock for drawing, picking and
   * following. The Worker runs the same clock to choose which rows to send.
   */
  replay: { at: number; local: number; speed: number; playing: boolean } | undefined;
  /** Called after every update, so a mounted layer can ask for a repaint. */
  onChange: (() => void) | undefined;

  apply(message: RowsMessage, localNow: number): void {
    if (this.epoch !== undefined && message.epoch !== this.epoch) {
      // A new session (the Worker restarted): the old sample times mean nothing now.
      this.mirror.data.fill(0);
      this.mirror.count = 0;
      this.slotIds.length = 0;
      this.slotOf.clear();
      this.alertsDirty = true;
    }
    this.epoch = message.epoch;
    for (const id of message.newIds) {
      this.slotOf.set(id, this.slotIds.length);
      this.slotIds.push(id);
      // An alert can arrive before the truck's first rows: mark it once it has a slot.
      if (this.alertIds.has(id)) this.alertsDirty = true;
    }
    this.mirror.apply(message.slots, message.data, message.count);
    this.clock.report(message.serverTime, message.delayMs, localNow);
    this.rowsReceived += message.slots.length;
    this.onChange?.();
  }

  /** Slot of the selected truck, or -1. The shader draws it larger, on top. */
  get selectedSlot(): number {
    return this.selectedId === undefined ? -1 : (this.slotOf.get(this.selectedId) ?? -1);
  }

  select(vehicleId: number | undefined): void {
    this.selectedId = vehicleId;
    this.onChange?.();
  }

  filter(groups: readonly StatusGroup[]): void {
    this.mask = modeMask(groups);
    this.onChange?.();
  }

  /** Where vehicle `id` is drawn right now, or undefined if it isn't known yet. */
  where(vehicleId: number): { lat: number; lon: number; heading: number; mode: number } | undefined {
    const slot = this.slotOf.get(vehicleId);
    if (slot === undefined || this.epoch === undefined || this.lastDisplay === undefined) return undefined;
    return slotEstimate(this.mirror.data, slot, (this.lastDisplay - this.epoch) / 1000);
  }

  setAlerting(ids: ReadonlySet<number>): void {
    this.alertIds = ids;
    this.alertsDirty = true;
    this.onChange?.();
  }

  /**
   * One byte per slot (255 = alerting), laid out like the sample texture's rows
   * so the shader finds a slot the same way. Rebuilt only when alerts or slots
   * changed: a few hundred ids against 5,000 slots, twice a second at most.
   */
  alertTexture(): { data: Uint8Array; width: number; height: number; version: number } {
    const height = textureHeight(this.mirror.capacity);
    if (this.alertBytes.length !== VEHICLES_PER_ROW * height) {
      this.alertBytes = new Uint8Array(VEHICLES_PER_ROW * height);
      this.alertsDirty = true;
    }
    if (this.alertsDirty) {
      this.alertBytes.fill(0);
      let n = 0;
      for (const id of this.alertIds) {
        const slot = this.slotOf.get(id);
        if (slot === undefined) continue;
        this.alertBytes[slot] = 255;
        n++;
      }
      this.alertCount = n;
      this.alertsDirty = false;
      this.alertVersion++;
    }
    return { data: this.alertBytes, width: VEHICLES_PER_ROW, height, version: this.alertVersion };
  }

  setReplay(replay: FleetGpuState["replay"]): void {
    this.replay = replay;
    this.onChange?.();
  }

  /** The time to draw at local time `localNow`: the replay clock while replaying, the live display clock otherwise. */
  displayTime(localNow: number): number | undefined {
    const r = this.replay;
    if (r) return r.at + (r.playing ? (localNow - r.local) * r.speed : 0);
    return this.clock.now(localNow);
  }

  setDark(dark: boolean): void {
    this.dark = dark;
    this.onChange?.();
  }

  /** Is this mode shown under the current filter? */
  visible(mode: number): boolean {
    return ((this.mask >> mode) & 1) === 1;
  }
}

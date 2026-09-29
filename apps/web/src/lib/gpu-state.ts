import { DisplayClock, SampleMirror } from "@fleet/gl";
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
  epoch: number | undefined;
  rowsReceived = 0;
  /** Called after every update, so a mounted layer can ask for a repaint. */
  onChange: (() => void) | undefined;

  apply(message: RowsMessage, localNow: number): void {
    if (this.epoch !== undefined && message.epoch !== this.epoch) {
      // A new session (the Worker restarted): the old sample times mean nothing now.
      this.mirror.data.fill(0);
      this.mirror.count = 0;
      this.slotIds.length = 0;
    }
    this.epoch = message.epoch;
    this.slotIds.push(...message.newIds);
    this.mirror.apply(message.slots, message.data, message.count);
    this.clock.report(message.serverTime, message.delayMs, localNow);
    this.rowsReceived += message.slots.length;
    this.onChange?.();
  }
}

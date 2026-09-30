import { FLOATS_PER_VEHICLE, SAMPLES_PER_VEHICLE, SampleMirror, slotEstimate, slotOffset } from "@fleet/gl";
import type { History } from "./history";

/** Rows for the GPU, in the same shape the live path sends. */
export interface ReplayRows {
  slots: Uint32Array;
  data: Float32Array;
}

/** The fleet at a replay time, shaped like the live snapshot so the list and details panel work unchanged. */
export interface ReplaySnapshot {
  displayTime: number;
  count: number;
  ids: Uint32Array;
  lat: Float64Array;
  lon: Float64Array;
  heading: Float32Array;
  speed: Float32Array;
  mode: Uint8Array;
  ageMs: Float32Array;
  ignition: Uint8Array;
}

export interface ReplayStats {
  /** Trucks whose samples were packed again, over the view's life. */
  repacked: number;
  updates: number;
}

/**
 * The fleet at a replay time, as the same GPU rows the live path sends.
 *
 * Each truck's texture row holds up to 8 recorded frames around the replay
 * time, and the shader interpolates between them exactly as it does live.
 * A truck is packed again only when replay time leaves the span its samples
 * cover, so steady playback repacks each truck once every several frames'
 * worth of time, not every tick.
 *
 * The view keeps its own copy of what it sent (a SampleMirror, as the page
 * has). The replay snapshot for the list and details panel is computed from it
 * with `slotEstimate`, the shader's algorithm in TypeScript, so the list says
 * what the map draws.
 */
export class ReplayView {
  readonly stats: ReplayStats = { repacked: 0, updates: 0 };
  readonly mirror = new SampleMirror(1000);
  private validFrom = new Float64Array(0);
  private validTo = new Float64Array(0);

  constructor(
    private readonly history: History,
    private readonly epoch: number,
  ) {}

  /** Forget every packed window: the next update repacks the whole fleet (on entering replay, or a jump). */
  invalidateAll(): void {
    this.validFrom.fill(Infinity);
    this.validTo.fill(-Infinity);
  }

  /**
   * Rows for every truck whose packed samples don't cover `time`. `slots` maps
   * vehicle id to GPU slot (the live path's), so replay writes the same rows.
   */
  update(time: number, slots: ReadonlyMap<number, number>): ReplayRows {
    this.stats.updates++;
    this.ensure(slots.size);
    const stale: [id: number, slot: number][] = [];
    for (const [id, slot] of slots) if (!(time >= this.validFrom[slot]! && time < this.validTo[slot]!)) stale.push([id, slot]);

    const out: ReplayRows = { slots: new Uint32Array(stale.length), data: new Float32Array(stale.length * FLOATS_PER_VEHICLE) };
    stale.forEach(([id, slot], i) => {
      const valid = this.history.packInto(id, time, this.epoch, out.data, i * FLOATS_PER_VEHICLE);
      out.slots[i] = slot;
      this.validFrom[slot] = valid.validFrom;
      this.validTo[slot] = valid.validTo;
    });
    this.mirror.apply(out.slots, out.data, slots.size);
    this.stats.repacked += stale.length;
    return out;
  }

  /** Every truck drawn at `time`, from the rows last sent: exactly what the map shows. */
  snapshot(time: number, slots: ReadonlyMap<number, number>): ReplaySnapshot {
    const seconds = (time - this.epoch) / 1000;
    const order = this.byId(slots);
    const n = order.length / 2;
    const snap: ReplaySnapshot = {
      displayTime: time,
      count: 0,
      ids: new Uint32Array(n),
      lat: new Float64Array(n),
      lon: new Float64Array(n),
      heading: new Float32Array(n),
      speed: new Float32Array(n),
      mode: new Uint8Array(n),
      ageMs: new Float32Array(n),
      ignition: new Uint8Array(n),
    };
    let i = 0;
    for (let k = 0; k < order.length; k += 2) {
      const id = order[k]!;
      const slot = order[k + 1]!;
      const e = slotEstimate(this.mirror.data, slot, seconds);
      if (!e) continue; // not drawn at this time: not in the list either
      snap.ids[i] = id;
      snap.lat[i] = e.lat;
      snap.lon[i] = e.lon;
      snap.heading[i] = e.heading;
      snap.mode[i] = e.mode;
      // Speed, age and ignition from the newest packed sample at or before `time`.
      const base = slotOffset(slot);
      let s = SAMPLES_PER_VEHICLE - 1;
      while (s > 0 && this.mirror.data[base + s * 4 + 2]! > seconds) s--;
      const sampleTime = this.epoch + this.mirror.data[base + s * 4 + 2]! * 1000;
      snap.ageMs[i] = time - sampleTime;
      const recorded = this.history.recordedAt(id, sampleTime);
      if (recorded) {
        snap.speed[i] = recorded.speed;
        snap.ignition[i] = recorded.ignition ? 1 : 0;
      }
      i++;
    }
    snap.count = i;
    return snap;
  }

  /** (id, slot) pairs sorted by id, as the snapshot's consumers expect (the details panel binary-searches ids). Kept until the fleet changes. */
  private order = new Uint32Array(0);
  private byId(slots: ReadonlyMap<number, number>): Uint32Array {
    if (this.order.length !== slots.size * 2) {
      const pairs = [...slots].sort((a, b) => a[0] - b[0]);
      this.order = Uint32Array.from(pairs.flat());
    }
    return this.order;
  }

  private ensure(count: number): void {
    if (count <= this.validFrom.length) return;
    const size = Math.max(count, this.validFrom.length * 2, 256);
    const from = new Float64Array(size).fill(Infinity);
    const to = new Float64Array(size).fill(-Infinity);
    from.set(this.validFrom);
    to.set(this.validTo);
    this.validFrom = from;
    this.validTo = to;
  }
}

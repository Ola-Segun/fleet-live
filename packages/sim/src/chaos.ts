import type { Ping } from "@fleet/protocol";
import type { Rng } from "./random";

/**
 * What the mobile network does to a ping between the truck and our server.
 * Each misbehaviour is one knob, so a test can switch on exactly one at a time.
 */
export interface ChaosConfig {
  /** Every delivery takes at least this long. */
  baseLatencyMs: number;
  /** Mean of an exponential extra delay: most pings are quick, a few are slow. */
  jitterMeanMs: number;
  /** Chance a ping is delivered a second time, as a mobile retry does. */
  duplicateRate: number;
  /** Chance a ping is never delivered. */
  dropRate: number;
  /** Chance a ping is held back long enough to arrive after later ones. */
  reorderRate: number;
  /** A held-back ping arrives 1 s to this much later than it otherwise would. */
  reorderWindowMs: number;
}

/** A perfect network: every ping once, instantly, in order. */
export const NO_CHAOS: ChaosConfig = {
  baseLatencyMs: 0,
  jitterMeanMs: 0,
  duplicateRate: 0,
  dropRate: 0,
  reorderRate: 0,
  reorderWindowMs: 0,
};

/** Assumed defaults for a Lagos mobile network. Plausible, not measured. */
export const DEFAULT_CHAOS: ChaosConfig = {
  baseLatencyMs: 120,
  jitterMeanMs: 80,
  duplicateRate: 0.03,
  dropRate: 0.01,
  reorderRate: 0.02,
  reorderWindowMs: 3000,
};

export interface ChaosStats {
  sent: number;
  delivered: number;
  duplicated: number;
  dropped: number;
  heldBack: number;
}

interface InFlight {
  deliverAt: number;
  /** Tie-breaker, so equal delivery times always come out in the same order. */
  order: number;
  ping: Ping;
}

/**
 * Pings in flight, ordered by delivery time. A binary min-heap: pushing and
 * popping are O(log n) with thousands of pings in flight, where a sorted array
 * would cost O(n) per insert.
 */
class DeliveryQueue {
  private heap: InFlight[] = [];

  get size(): number {
    return this.heap.length;
  }

  private less(a: InFlight, b: InFlight): boolean {
    return a.deliverAt < b.deliverAt || (a.deliverAt === b.deliverAt && a.order < b.order);
  }

  push(item: InFlight): void {
    const h = this.heap;
    h.push(item);
    let i = h.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!this.less(h[i]!, h[parent]!)) break;
      [h[i], h[parent]] = [h[parent]!, h[i]!];
      i = parent;
    }
  }

  peek(): InFlight | undefined {
    return this.heap[0];
  }

  pop(): InFlight | undefined {
    const h = this.heap;
    const top = h[0];
    const last = h.pop();
    if (h.length > 0 && last) {
      h[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let smallest = i;
        if (l < h.length && this.less(h[l]!, h[smallest]!)) smallest = l;
        if (r < h.length && this.less(h[r]!, h[smallest]!)) smallest = r;
        if (smallest === i) break;
        [h[i], h[smallest]] = [h[smallest]!, h[i]!];
        i = smallest;
      }
    }
    return top;
  }
}

/**
 * The network between the fleet and the server. Devices `send`, the server
 * `receive`s whatever has arrived by a given time, in arrival order, with
 * duplicates, gaps and reordering already applied.
 *
 * Its randomness is its own stream, so turning a knob here changes which pings
 * arrive when, and never where any truck actually drove.
 */
export class ChaosChannel {
  private readonly queue = new DeliveryQueue();
  private order = 0;
  readonly stats: ChaosStats = { sent: 0, delivered: 0, duplicated: 0, dropped: 0, heldBack: 0 };

  constructor(
    private readonly config: ChaosConfig,
    private readonly rng: Rng,
  ) {}

  private latency(): number {
    const { baseLatencyMs, jitterMeanMs, reorderRate, reorderWindowMs } = this.config;
    // Exponential: −mean · ln(U), with U in (0, 1].
    let ms = baseLatencyMs + (jitterMeanMs > 0 ? -jitterMeanMs * Math.log(1 - this.rng.next()) : 0);
    if (reorderRate > 0 && this.rng.chance(reorderRate)) {
      this.stats.heldBack++;
      ms += this.rng.range(1000, Math.max(1000, reorderWindowMs));
    }
    return ms;
  }

  send(ping: Ping, sentAt: number): void {
    this.stats.sent++;
    if (this.config.dropRate > 0 && this.rng.chance(this.config.dropRate)) {
      this.stats.dropped++;
      return;
    }
    this.queue.push({ deliverAt: sentAt + this.latency(), order: this.order++, ping });
    if (this.config.duplicateRate > 0 && this.rng.chance(this.config.duplicateRate)) {
      this.stats.duplicated++;
      // A retry: the device resends after it gave up waiting for an acknowledgement.
      const retryAfter = this.rng.range(300, 2000);
      this.queue.push({ deliverAt: sentAt + retryAfter + this.latency(), order: this.order++, ping: { ...ping } });
    }
  }

  /** Every ping that has arrived by `now`, in arrival order. */
  receive(now: number): Ping[] {
    const arrived: Ping[] = [];
    while (this.queue.size > 0 && this.queue.peek()!.deliverAt <= now) {
      arrived.push(this.queue.pop()!.ping);
    }
    this.stats.delivered += arrived.length;
    return arrived;
  }

  get inFlight(): number {
    return this.queue.size;
  }
}

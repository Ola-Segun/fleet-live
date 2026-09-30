/**
 * Gathers items that arrive at any rate and hands them on in batches, at most
 * once every `everyMs`: the first batch at once, the rest as soon as the
 * interval allows. Used for alert announcements, so a screen reader hears one
 * sentence for a burst, not one per alert.
 *
 * It owns a single timer, independent of how often items arrive. The first
 * version kept its timer in a React effect that re-ran on every alerts message
 * (twice a second, whether or not anything new was raised) and cancelled the
 * pending announcement each time. After the first announcement, the rest were
 * almost never spoken. Layer 10's browser check found it.
 */
export class Gather<T> {
  private queue: T[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;
  private last = -Infinity;

  constructor(
    private readonly everyMs: number,
    private readonly emit: (items: T[]) => void,
    private readonly now: () => number = Date.now,
  ) {}

  push(items: readonly T[]): void {
    if (items.length === 0) return;
    this.queue.push(...items);
    this.timer ??= setTimeout(this.flush, Math.max(0, this.last + this.everyMs - this.now()));
  }

  private readonly flush = () => {
    this.timer = undefined;
    const items = this.queue;
    this.queue = [];
    this.last = this.now();
    this.emit(items);
  };

  dispose(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.queue = [];
  }
}

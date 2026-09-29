/**
 * The page's display clock: what time the map is drawing, updated every
 * animation frame between the Worker's 10 Hz reports.
 *
 * The Worker says "server time was S, draw D ms behind it" ten times a second,
 * and each report arrives a little late, by a varying amount. Snapping to each
 * report would make display time stutter back and forth, and trucks would
 * visibly shudder. So:
 *
 *   - the clock runs on the local high-resolution clock between reports;
 *   - reports only *steer* it, by at most `maxSlew` of real time (10%), so a
 *     correction is spread over many frames;
 *   - it never goes backwards. A truck that moves backwards for one frame
 *     looks like a bug even when the arithmetic says it's fine.
 *
 * A jump larger than `resyncMs` (a Worker restart, or coming back from a
 * sleeping laptop) is taken at once. Slewing through minutes would replay them.
 */
export class DisplayClock {
  private offset: number | undefined; // server time − local time, as currently believed
  private delay = 0;
  private targetOffset = 0;
  private targetDelay = 0;
  private lastLocal = 0;
  private lastDisplay = -Infinity;

  constructor(
    private readonly maxSlew = 0.1,
    private readonly resyncMs = 5000,
  ) {}

  /** A report from the Worker, received at local time `localNow` (ms). */
  report(serverTime: number, delayMs: number, localNow: number): void {
    const target = serverTime - localNow;
    if (this.offset === undefined || Math.abs(target - this.offset) > this.resyncMs) {
      this.offset = target;
      this.delay = delayMs;
      this.lastDisplay = -Infinity;
    }
    this.targetOffset = target;
    this.targetDelay = delayMs;
  }

  /** Display time (server clock, ms) for local time `localNow`. Undefined before the first report. */
  now(localNow: number): number | undefined {
    if (this.offset === undefined) return undefined;
    const dt = Math.max(0, localNow - this.lastLocal);
    this.lastLocal = localNow;
    const budget = dt * this.maxSlew;
    this.offset += clamp(this.targetOffset - this.offset, -budget, budget);
    this.delay += clamp(this.targetDelay - this.delay, -budget, budget);
    const display = Math.max(this.lastDisplay, localNow + this.offset - this.delay);
    this.lastDisplay = display;
    return display;
  }
}

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

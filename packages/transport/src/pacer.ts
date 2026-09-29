import type { Frame } from "@fleet/protocol";
import type { Simulation } from "@fleet/sim";

/**
 * Drives a simulation in real time: each `tick()` advances it to wherever the
 * wall clock says it should be, in whole simulation steps.
 *
 * **It never catches up more than `maxCatchUpMs` at once.** A browser throttles
 * timers in a hidden tab. Without a cap, coming back after five minutes would
 * mean simulating five minutes of 5,000 trucks in one tick, freezing the
 * Worker, then flooding the feed with a burst. Instead, simulated time pauses
 * while the tab is hidden and resumes when it's visible again. The feed uses
 * frame times, not the wall clock, so nothing downstream is confused.
 */
export class Pacer {
  private anchorWall = 0;
  private anchorSim = 0;

  constructor(
    private readonly sim: Simulation,
    private readonly now: () => number = Date.now,
    private readonly maxCatchUpMs = 1000,
  ) {}

  start(): void {
    this.anchorWall = this.now();
    this.anchorSim = this.sim.now;
  }

  tick(): Frame[] {
    const target = this.anchorSim + (this.now() - this.anchorWall);
    let behind = target - this.sim.now;
    if (behind > this.maxCatchUpMs) {
      // Let simulated time fall behind the wall clock rather than burst.
      this.anchorSim -= behind - this.maxCatchUpMs;
      behind = this.maxCatchUpMs;
    }
    const step = this.sim.stepMs;
    const ms = Math.floor(behind / step) * step;
    return ms > 0 ? this.sim.advance(ms) : [];
  }
}

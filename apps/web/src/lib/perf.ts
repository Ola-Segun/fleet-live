/**
 * Main-thread cost of each snapshot refresh, and long tasks while the map runs.
 *
 * Recorded on `window.__fleetPerf` so a Playwright script can read the numbers
 * from a real browser. They are what Layer 7's WebGL layer must beat, so they
 * are measured in the running app, not estimated.
 */
export interface RefreshSample {
  /** Building the data for the map, ms. */
  build: number;
  /** Handing it to the map (for the baseline, MapLibre's setData), ms. */
  hand: number;
  count: number;
}

export interface FleetPerf {
  /** Baseline layer only: one entry per snapshot refresh. */
  refreshes: RefreshSample[];
  longTasks: number[];
  /** WebGL layer only: its live counters (frames, render ms, uploads, context restores). */
  layer?: { frames: number; renderMs: number; uploads: number; contextRestores: number; layersAdded: number; skipped: number };
  /** How long the last click took to find the truck under it, ms. */
  lastPickMs?: number;
  /** Where truck `id` was drawn in the last frame, and at what display time: lets a browser check compare replay with live. Read-only. */
  probe?: (id: number) => { at: number; lat: number; lon: number; mode: number } | undefined;
}

declare global {
  interface Window {
    __fleetPerf?: FleetPerf;
  }
}

export function fleetPerf(): FleetPerf {
  if (!window.__fleetPerf) {
    const perf: FleetPerf = { refreshes: [], longTasks: [] };
    window.__fleetPerf = perf;
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) perf.longTasks.push(entry.duration);
      }).observe({ type: "longtask", buffered: true });
    } catch {
      // Long-task timing is Chromium-only. The refresh timings still work everywhere.
    }
  }
  return window.__fleetPerf;
}

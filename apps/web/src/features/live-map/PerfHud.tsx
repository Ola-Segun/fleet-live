"use client";

import { useEffect, useState } from "react";
import type { FleetGpuState } from "@/lib/gpu-state";

interface Reading {
  fps: number;
  renderMs: number;
  uploadsPerS: number;
  rowsPerS: number;
  vehicles: number;
}

/**
 * `?hud=1`: frame rate, the truck layer's CPU time per frame, and data rates,
 * so performance is visible in the walkthrough video rather than claimed.
 * Reads counters twice a second; it never touches the render loop.
 */
export function PerfHud({ gpu }: { gpu: FleetGpuState }) {
  const [reading, setReading] = useState<Reading | null>(null);

  useEffect(() => {
    let frames = 0;
    let raf = requestAnimationFrame(function count() {
      frames++;
      raf = requestAnimationFrame(count);
    });
    let last = { t: performance.now(), frames: 0, uploads: 0, rows: gpu.rowsReceived };
    const timer = setInterval(() => {
      const now = performance.now();
      const layer = window.__fleetPerf?.layer;
      const dt = (now - last.t) / 1000;
      setReading({
        fps: (frames - last.frames) / dt,
        renderMs: layer?.renderMs ?? 0,
        uploadsPerS: ((layer?.uploads ?? 0) - last.uploads) / dt,
        rowsPerS: (gpu.rowsReceived - last.rows) / dt,
        vehicles: gpu.mirror.count,
      });
      last = { t: now, frames, uploads: layer?.uploads ?? 0, rows: gpu.rowsReceived };
    }, 500);
    return () => {
      cancelAnimationFrame(raf);
      clearInterval(timer);
    };
  }, [gpu]);

  if (!reading) return null;
  return (
    <dl className="pointer-events-none absolute bottom-8 left-2 grid grid-cols-[auto_auto] gap-x-3 rounded bg-zinc-900/80 px-3 py-2 font-mono text-xs text-zinc-100">
      <dt>fps</dt>
      <dd>{reading.fps.toFixed(0)}</dd>
      <dt>truck layer</dt>
      {/* Without cross-origin isolation Chrome coarsens performance.now() to 0.1 ms, so below that we can only say "under". */}
      <dd>{reading.renderMs < 0.1 ? "< 0.1" : reading.renderMs.toFixed(1)} ms/frame</dd>
      <dt>uploads</dt>
      <dd>{reading.uploadsPerS.toFixed(1)} /s</dd>
      <dt>rows</dt>
      <dd>{reading.rowsPerS.toFixed(0)} /s</dd>
      <dt>trucks</dt>
      <dd>{reading.vehicles.toLocaleString("en-NG")}</dd>
    </dl>
  );
}

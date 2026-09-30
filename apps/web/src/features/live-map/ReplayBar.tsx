"use client";

import { useEffect, useState } from "react";
import type { HistoryStatus } from "@fleet/transport";
import { lagosTime } from "@/lib/alert-text";

export interface ReplayState {
  /** Data time shown at local time `local` (performance.now()). */
  at: number;
  local: number;
  speed: number;
  playing: boolean;
}

/** The replay time now, from the state's anchor. */
export function replayNow(r: ReplayState, localNow = performance.now()): number {
  return r.at + (r.playing ? (localNow - r.local) * r.speed : 0);
}

export const SPEEDS = [1, 10, 60] as const;

interface Props {
  history: HistoryStatus | undefined;
  replay: ReplayState | null;
  /** Start replay (at a time), or change it: scrub, play, pause, speed. */
  onChange: (next: { at: number; speed: number; playing: boolean }) => void;
  onLive: () => void;
}

const button = "min-h-9 rounded-md border border-control bg-surface px-3 text-sm font-medium focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-60";

/** "12 min ago", "40 s ago": how far back a replay time is from the newest recorded moment. */
function ago(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 90 ? `${s} s ago` : `${Math.round(s / 60)} min ago`;
}

/**
 * Replay controls: go back up to an hour, scrub, play at 1×, 10× or 60×, and
 * return to live. Every control is a native button, range or select, so the
 * keyboard and screen readers get their standard behaviour: arrow keys move
 * the slider by 5 s, Page Up and Page Down by a minute, and the slider
 * announces its value as a time, not a number.
 */
export function ReplayBar({ history, replay, onChange, onLive }: Props) {
  // The shown time ticks four times a second while playing: enough for a clock, cheap for React.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!replay?.playing) return;
    const timer = setInterval(() => setTick((n) => n + 1), 250);
    return () => clearInterval(timer);
  }, [replay]);

  const recorded = history ? history.to - history.from : 0;

  if (!replay) {
    const ready = recorded >= 30_000;
    return (
      <div data-replay-bar className="flex items-center gap-2 rounded-lg border border-line bg-surface p-2 shadow-lg">
        <button
          type="button"
          disabled={!ready}
          // Five minutes back, or half way back while less than ten minutes are recorded.
          onClick={() => history && onChange({ at: history.to - Math.min(5 * 60_000, (history.to - history.from) / 2), speed: 1, playing: false })}
          className={button}
        >
          Replay
        </button>
        <span className="text-xs text-muted">
          {ready ? `The last ${ago(recorded).replace(" ago", "")} can be replayed` : "Recording for replay…"}
        </span>
      </div>
    );
  }

  const now = history ? Math.min(history.to, Math.max(history.from, replayNow(replay))) : replay.at;
  const set = (patch: Partial<{ at: number; speed: number; playing: boolean }>) =>
    onChange({ at: patch.at ?? now, speed: patch.speed ?? replay.speed, playing: patch.playing ?? replay.playing });

  return (
    <div data-replay-bar role="group" aria-label="Replay" className="flex flex-wrap items-center gap-2 rounded-lg border-2 border-accent bg-surface p-2 shadow-lg">
      <button type="button" onClick={onLive} className={`${button} border-accent`}>
        Back to live
      </button>
      <button type="button" onClick={() => set({ playing: !replay.playing })} className={button} aria-label={replay.playing ? "Pause" : "Play"}>
        <span aria-hidden>{replay.playing ? "❚❚" : "▶"}</span>
      </button>
      <label className="flex min-w-40 flex-1 items-center gap-2 text-xs">
        <span className="sr-only">Replay time</span>
        <input
          type="range"
          min={history?.from ?? now}
          max={history?.to ?? now}
          step={5000}
          value={now}
          aria-valuetext={`${lagosTime(now)}, ${ago((history?.to ?? now) - now)}`}
          onChange={(e) => set({ at: Number(e.target.value) })}
          onKeyDown={(e) => {
            // Page Up / Page Down: a minute at a time. (Arrows are the native 5 s step.)
            if (e.key === "PageUp" || e.key === "PageDown") {
              e.preventDefault();
              set({ at: now + (e.key === "PageUp" ? 60_000 : -60_000) });
            }
          }}
          className="w-full accent-[var(--accent)]"
        />
      </label>
      <span className="text-sm font-medium tabular-nums">{lagosTime(now)}</span>
      <span className="text-xs text-muted tabular-nums">{ago((history?.to ?? now) - now)}</span>
      <label className="flex items-center gap-1 text-xs">
        Speed
        <select
          aria-label="Playback speed"
          value={replay.speed}
          onChange={(e) => set({ speed: Number(e.target.value) })}
          className="rounded border border-control bg-surface px-1 py-0.5"
        >
          {SPEEDS.map((s) => (
            <option key={s} value={s}>
              {s}×
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import type { VehicleInfo } from "@fleet/sim";
import type { FleetSnapshot } from "@fleet/transport";
import { MODE_LABEL } from "@/lib/fleet-view";
import { StatusIcon } from "./StatusIcon";
import type { SnapshotListener } from "./use-fleet";

const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
const compass = (heading: number) => COMPASS[Math.round(heading / 45) % 8];

/** Index of `id` in a snapshot. Snapshot ids are sorted, so this is a binary search. */
function indexOf(s: FleetSnapshot, id: number): number {
  let lo = 0;
  let hi = s.count - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const v = s.ids[mid]!;
    if (v === id) return mid;
    if (v < id) lo = mid + 1;
    else hi = mid - 1;
  }
  return -1;
}

interface Props {
  vehicleId: number;
  info: VehicleInfo | undefined;
  subscribe: (listener: SnapshotListener) => () => void;
  follow: boolean;
  onFollow: (follow: boolean) => void;
  onClose: () => void;
}

/** One truck: who's driving, what it's doing, how fresh the data is, and a follow switch. */
export function VehicleDrawer({ vehicleId, info, subscribe, follow, onFollow, onClose }: Props) {
  const [snapshot, setSnapshot] = useState<FleetSnapshot | null>(null);
  useEffect(() => subscribe(setSnapshot), [subscribe]);

  const i = snapshot ? indexOf(snapshot, vehicleId) : -1;
  const mode = i >= 0 ? snapshot!.mode[i]! : undefined;
  const speed = i >= 0 ? snapshot!.speed[i]! * 3.6 : 0;
  const heading = i >= 0 ? snapshot!.heading[i]! : 0;
  const age = i >= 0 ? Math.max(0, snapshot!.ageMs[i]! / 1000) : undefined;

  return (
    <section aria-labelledby="drawer-title" className="rounded-lg border border-zinc-200 bg-white p-4 shadow-lg">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 id="drawer-title" className="font-mono text-lg font-semibold">
            {info?.plate ?? `#${vehicleId}`}
          </h2>
          <p className="text-sm text-zinc-600">{info?.driver ?? "Driver details loading…"}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close truck details"
          className="grid h-8 w-8 place-items-center rounded-md text-zinc-600 hover:bg-zinc-100 focus-visible:ring-2 focus-visible:ring-blue-600"
        >
          ✕
        </button>
      </div>

      {mode === undefined ? (
        <p className="mt-3 text-sm text-zinc-600">Waiting for the first report from this truck…</p>
      ) : (
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <dt className="text-zinc-600">Status</dt>
          <dd className="flex items-center gap-1.5">
            <StatusIcon mode={mode} heading={heading} />
            {MODE_LABEL[mode]}
          </dd>
          <dt className="text-zinc-600">Speed</dt>
          <dd className="tabular-nums">{Math.round(speed)} km/h</dd>
          <dt className="text-zinc-600">Heading</dt>
          <dd className="tabular-nums">
            {compass(heading)} ({Math.round(heading)}°)
          </dd>
          <dt className="text-zinc-600">Last report</dt>
          <dd className="tabular-nums">{age === undefined ? "–" : age < 1 ? "just now" : `${Math.round(age)} s ago`}</dd>
        </dl>
      )}

      <button
        type="button"
        aria-pressed={follow}
        onClick={() => onFollow(!follow)}
        className="mt-4 w-full rounded-md border px-3 py-2 text-sm font-medium aria-pressed:border-blue-700 aria-pressed:bg-blue-700 aria-pressed:text-white aria-[pressed=false]:border-zinc-300 focus-visible:ring-2 focus-visible:ring-blue-600"
      >
        {follow ? "Following · press F to stop" : "Follow on map  ( F )"}
      </button>
    </section>
  );
}

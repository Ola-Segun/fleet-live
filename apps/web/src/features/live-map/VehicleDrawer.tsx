"use client";

import { startTransition, useEffect, useState } from "react";
import type { Alert } from "@fleet/alerts";
import type { VehicleInfo } from "@fleet/sim";
import type { FleetSnapshot } from "@fleet/transport";
import { alertStatus, alertText, type AlertNames } from "@/lib/alert-text";
import { MODE_LABEL } from "@/lib/fleet-view";
import type { AlertAction } from "./AlertsPanel";
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
  /** This truck's open alerts: the drawer's "alerting" state. */
  alerts: readonly Alert[];
  names: AlertNames;
  onAct: (action: AlertAction, id?: number) => void;
}

/** One truck: who's driving, what it's doing, how fresh the data is, and a follow switch. */
export function VehicleDrawer({ vehicleId, info, subscribe, follow, onFollow, onClose, alerts, names, onAct }: Props) {
  const [snapshot, setSnapshot] = useState<FleetSnapshot | null>(null);
  useEffect(() => subscribe((s) => startTransition(() => setSnapshot(s))), [subscribe]);

  const i = snapshot ? indexOf(snapshot, vehicleId) : -1;
  const mode = i >= 0 ? snapshot!.mode[i]! : undefined;
  const speed = i >= 0 ? snapshot!.speed[i]! * 3.6 : 0;
  const heading = i >= 0 ? snapshot!.heading[i]! : 0;
  const age = i >= 0 ? Math.max(0, snapshot!.ageMs[i]! / 1000) : undefined;

  return (
    <section aria-labelledby="drawer-title" className="rounded-lg border border-line bg-surface p-4 shadow-lg [contain:content]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 id="drawer-title" className="font-mono text-lg font-semibold">
            {info?.plate ?? `#${vehicleId}`}
          </h2>
          <p className="text-sm text-muted">{info?.driver ?? "Driver details loading…"}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close truck details"
          className="grid h-8 w-8 place-items-center rounded-md text-muted hover:bg-hover focus-visible:ring-2 focus-visible:ring-accent"
        >
          ✕
        </button>
      </div>

      {mode === undefined ? (
        <p className="mt-3 text-sm text-muted">Waiting for the first report from this truck…</p>
      ) : (
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <dt className="text-muted">Status</dt>
          <dd className="flex items-center gap-1.5">
            <StatusIcon mode={mode} heading={heading} />
            {MODE_LABEL[mode]}
          </dd>
          <dt className="text-muted">Speed</dt>
          <dd className="tabular-nums">{Math.round(speed)} km/h</dd>
          <dt className="text-muted">Heading</dt>
          <dd className="tabular-nums">
            {compass(heading)} ({Math.round(heading)}°)
          </dd>
          <dt className="text-muted">Last report</dt>
          <dd className="tabular-nums">{age === undefined ? "–" : age < 1 ? "just now" : `${Math.round(age)} s ago`}</dd>
        </dl>
      )}

      {alerts.length > 0 && (
        <div className="mt-3 border-t border-line pt-3">
          <h3 className="text-sm font-medium">Alerts</h3>
          <ul className="mt-1 space-y-2">
            {alerts.map((a) => (
              <li key={a.id} className={`border-l-4 pl-2 ${a.active ? "border-l-danger" : "border-l-line"}`}>
                <p id={`drawer-alert-${a.id}`} className="text-sm">
                  {alertText(a, names)}
                </p>
                <p className="text-xs text-muted">{alertStatus(a)}</p>
                <div className="mt-1 flex gap-1.5">
                  {a.acknowledgedAt === undefined && (
                    <button
                      type="button"
                      aria-describedby={`drawer-alert-${a.id}`}
                      onClick={() => onAct("acknowledge", a.id)}
                      className="min-h-8 rounded-md border border-control px-2 text-xs focus-visible:ring-2 focus-visible:ring-accent"
                    >
                      Acknowledge
                    </button>
                  )}
                  <button
                    type="button"
                    aria-describedby={`drawer-alert-${a.id}`}
                    onClick={() => onAct("resolve", a.id)}
                    className="min-h-8 rounded-md border border-control px-2 text-xs focus-visible:ring-2 focus-visible:ring-accent"
                  >
                    Resolve
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <button
        type="button"
        aria-pressed={follow}
        onClick={() => onFollow(!follow)}
        className="mt-4 w-full rounded-md border px-3 py-2 text-sm font-medium aria-pressed:border-accent aria-pressed:bg-accent aria-pressed:text-accent-fg aria-[pressed=false]:border-control focus-visible:ring-2 focus-visible:ring-accent"
      >
        {follow ? "Following" : "Follow on map"}
      </button>
    </section>
  );
}

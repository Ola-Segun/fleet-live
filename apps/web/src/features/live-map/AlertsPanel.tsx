"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Alert } from "@fleet/alerts";
import { alertStatus, alertText, type AlertNames } from "@/lib/alert-text";

/** Rendering is capped: past this, the oldest are summarised. The engine caps what it keeps at 500. */
const SHOWN = 100;

export type AlertAction = "acknowledge" | "resolve" | "resolve-cleared";

interface Props {
  alerts: readonly Alert[];
  names: AlertNames;
  onShow: (vehicleId: number) => void;
  onAct: (action: AlertAction, id?: number) => void;
}

const KIND_GLYPH: Record<Alert["kind"], string> = { "zone-enter": "⇥", "zone-exit": "⇤", speeding: "⏵⏵", offline: "⌀" };

/**
 * The open alerts, newest first. Each can be shown on the map, acknowledged
 * ("I've seen it") or resolved ("dealt with", which removes it).
 *
 * Resolving removes the row that had focus. Left alone, focus would fall to
 * the top of the page, the same trap the detail panel's close button had, so
 * it moves to the next alert, or to the panel's summary if none is left.
 *
 * **The order holds still while you're using it.** New alerts go on top, which
 * pushed every row down, so a click aimed at one alert's button could land on
 * another's. The browser check caught exactly that. While the pointer is over
 * the list or focus is inside it, the order is frozen. New alerts wait behind
 * a "Show N new" button in the header, which doesn't move the rows.
 */
export function AlertsPanel({ alerts, names, onShow, onAct }: Props) {
  // Ids in the order they were shown when the person started interacting, or null for live order.
  const [pinned, setPinned] = useState<number[] | null>(null);
  const pointerInside = useRef(false);
  const freeze = () => setPinned((p) => p ?? alerts.map((a) => a.id));
  const thaw = () => setPinned(null);
  const shown = useMemo(() => {
    if (!pinned) return alerts;
    const byId = new Map(alerts.map((a) => [a.id, a]));
    return pinned.flatMap((id) => byId.get(id) ?? []);
  }, [alerts, pinned]);
  const waiting = pinned ? alerts.length - shown.length : 0;

  const active = alerts.filter((a) => a.active).length;
  const ended = alerts.length - active;
  const listRef = useRef<HTMLUListElement>(null);
  const summaryRef = useRef<HTMLParagraphElement>(null);
  const focusAfter = useRef<number | null>(null);

  // Runs when the Worker's answer arrives: the resolved alert is gone, so focus its successor.
  useEffect(() => {
    const index = focusAfter.current;
    if (index === null) return;
    focusAfter.current = null;
    const buttons = listRef.current?.querySelectorAll<HTMLButtonElement>("li [data-first]");
    const next = buttons?.[Math.min(index, buttons.length - 1)];
    (next ?? summaryRef.current)?.focus();
  }, [alerts]);

  return (
    <div
      className="flex h-full min-h-0 flex-col"
      onPointerEnter={() => {
        pointerInside.current = true;
        freeze();
      }}
      onPointerLeave={(e) => {
        pointerInside.current = false;
        if (!e.currentTarget.contains(document.activeElement)) thaw();
      }}
      onFocus={freeze}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null) && !pointerInside.current) thaw();
      }}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line p-3">
        <p ref={summaryRef} tabIndex={-1} className="text-sm outline-none">
          {alerts.length === 0 ? "No open alerts" : `${alerts.length} open: ${active} active, ${ended} ended`}
        </p>
        {waiting > 0 && (
          <button
            type="button"
            onClick={() => setPinned(alerts.map((a) => a.id))}
            className="min-h-8 rounded-md border border-accent px-2 text-xs font-medium text-accent focus-visible:ring-2 focus-visible:ring-accent"
          >
            Show {waiting} new
          </button>
        )}
        <button
          type="button"
          disabled={ended === 0}
          onClick={() => onAct("resolve-cleared")}
          className="min-h-8 rounded-md border border-control px-2 text-xs focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-60"
        >
          Resolve all ended
        </button>
      </div>

      {alerts.length === 0 ? (
        <p className="p-4 text-sm text-muted">
          Trucks over 60 km/h for 10 seconds, trucks that stop reporting for 2 minutes (10 when parked), and entries to
          and exits from your zones appear here.
        </p>
      ) : (
        <ul ref={listRef} aria-label="Open alerts" className="min-h-0 flex-1 overflow-y-auto [contain:content]">
          {shown.slice(0, SHOWN).map((a, index) => {
            const textId = `alert-${a.id}`;
            const unseen = a.active && a.acknowledgedAt === undefined;
            return (
              <li key={a.id} className={`border-b border-l-4 border-b-line px-3 py-2.5 ${a.active ? "border-l-danger" : "border-l-transparent"}`}>
                <div className="flex items-start gap-2">
                  <span aria-hidden className={`w-6 shrink-0 text-center ${a.active ? "text-danger" : "text-muted"}`}>
                    {KIND_GLYPH[a.kind]}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p id={textId} className={`text-sm ${unseen ? "font-semibold" : ""}`}>
                      {alertText(a, names)}
                    </p>
                    <p className="text-xs text-muted">{alertStatus(a)}</p>
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5 pl-8">
                  <button
                    type="button"
                    data-first
                    aria-describedby={textId}
                    onClick={() => onShow(a.vehicleId)}
                    className="min-h-8 rounded-md border border-control px-2 text-xs focus-visible:ring-2 focus-visible:ring-accent"
                  >
                    Show truck
                  </button>
                  {a.acknowledgedAt === undefined && (
                    <button
                      type="button"
                      aria-describedby={textId}
                      onClick={() => onAct("acknowledge", a.id)}
                      className="min-h-8 rounded-md border border-control px-2 text-xs focus-visible:ring-2 focus-visible:ring-accent"
                    >
                      Acknowledge
                    </button>
                  )}
                  <button
                    type="button"
                    aria-describedby={textId}
                    onClick={() => {
                      focusAfter.current = index;
                      onAct("resolve", a.id);
                    }}
                    className="min-h-8 rounded-md border border-control px-2 text-xs focus-visible:ring-2 focus-visible:ring-accent"
                  >
                    Resolve
                  </button>
                </div>
              </li>
            );
          })}
          {shown.length > SHOWN && (
            <li className="p-3 text-xs text-muted">
              and {shown.length - SHOWN} older. Resolve some to see them.
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

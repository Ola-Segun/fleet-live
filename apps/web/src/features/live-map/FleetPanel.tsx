"use client";

import { startTransition, useEffect, useMemo, useRef, useState } from "react";
import { ALL_GROUPS, type StatusGroup } from "@fleet/gl";
import type { VehicleInfo } from "@fleet/sim";
import type { FleetSnapshot } from "@fleet/transport";
import { MODE_LABEL, buildOrder, countGroups, indexVehicles, rowAt, windowRange, type SortKey } from "@/lib/fleet-view";
import type { UiState } from "@/lib/ui-url";
import { StatusIcon } from "./StatusIcon";
import type { SnapshotListener } from "./use-fleet";

const ROW = 44;
const GROUP_LABEL: Record<StatusGroup, string> = { moving: "Moving", parked: "Parked", stale: "Stale" };
const number = new Intl.NumberFormat("en-NG");

interface Props {
  subscribe: (listener: SnapshotListener) => () => void;
  vehicles: ReadonlyMap<number, VehicleInfo>;
  ui: UiState;
  onUi: (patch: Partial<UiState>) => void;
  onSelect: (id: number | undefined) => void;
}

/**
 * Search, status filters and the fleet list: the accessible way to everything
 * the map shows. Every truck on the canvas is reachable here by keyboard and
 * screen reader.
 *
 * The list re-renders at the snapshot rate (2 Hz), and only for the ~20 rows on
 * screen. Filters use the same status groups as the shader, so the list and
 * the map always agree.
 */
export function FleetPanel({ subscribe, vehicles, ui, onUi, onSelect }: Props) {
  const [snapshot, setSnapshot] = useState<FleetSnapshot | null>(null);
  const [sort, setSort] = useState<SortKey>("status");
  // Keyboard focus follows a *truck*, not a row number. The default sort reorders live, twice a
  // second, so an index would slide to a different truck under the user's cursor, and Enter
  // could open a truck they never saw highlighted. Found by a flaky browser check.
  const [activeId, setActiveId] = useState<number | undefined>(undefined);
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(400);
  const listRef = useRef<HTMLDivElement>(null);

  // A transition, so React can render the refreshed list in slices and yield to animation
  // frames. Rendered in one go, it landed 4–10 ms of script plus layout in a single frame,
  // which is what the frame trace showed dropping frames (scripts/profile-frames.mts).
  useEffect(() => subscribe((s) => startTransition(() => setSnapshot(s))), [subscribe]);
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setHeight(el.clientHeight));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Computed once per vehicle list, not per snapshot: plate ranks and search text.
  const index = useMemo(() => indexVehicles(vehicles), [vehicles]);
  // Display order as snapshot indices; row objects are built only for what's on screen.
  const order = useMemo(
    () => (snapshot ? buildOrder(snapshot, index, ui.query, ui.groups, sort) : new Int32Array(0)),
    [snapshot, index, ui.query, ui.groups, sort],
  );
  const rows = useMemo(
    () => ({
      length: order.length,
      at: (k: number) => (snapshot && k >= 0 && k < order.length ? rowAt(snapshot, index, order[k]!) : undefined),
    }),
    [order, snapshot, index],
  );
  const counts = useMemo(() => (snapshot ? countGroups(snapshot) : { moving: 0, parked: 0, stale: 0 }), [snapshot]);

  // The count is announced only when the *person* changes the search or filters, once they pause.
  // As a live region on the count itself, it spoke on every refresh that shifted the numbers:
  // twice a second with a filter on.
  const [countAnnouncement, setCountAnnouncement] = useState("");
  const lengthRef = useRef(0);
  useEffect(() => {
    lengthRef.current = rows.length;
  }, [rows.length]);
  useEffect(() => {
    const timer = setTimeout(() => setCountAnnouncement(`${number.format(lengthRef.current)} trucks shown`), 700);
    return () => clearTimeout(timer);
  }, [ui.query, ui.groups]);
  const activeIndex = useMemo(() => {
    if (activeId === undefined || !snapshot) return 0;
    for (let k = 0; k < order.length; k++) if (snapshot.ids[order[k]!] === activeId) return k;
    return 0; // filtered out or gone: fall back to the top
  }, [activeId, order, snapshot]);
  const { start, end } = windowRange(scrollTop, height, ROW, rows.length);

  const moveActive = (index: number) => {
    const next = Math.max(0, Math.min(rows.length - 1, index));
    setActiveId(rows.at(next)?.id);
    // Keep the active row in view: virtualised rows off screen don't exist to scroll to.
    const el = listRef.current;
    if (!el) return;
    if (next * ROW < el.scrollTop) el.scrollTop = next * ROW;
    else if ((next + 1) * ROW > el.scrollTop + el.clientHeight) el.scrollTop = (next + 1) * ROW - el.clientHeight;
  };

  const onListKey = (e: React.KeyboardEvent) => {
    const step = { ArrowDown: 1, ArrowUp: -1, PageDown: 10, PageUp: -10 }[e.key];
    if (step !== undefined) moveActive(activeIndex + step);
    else if (e.key === "Home") moveActive(0);
    else if (e.key === "End") moveActive(rows.length - 1);
    else if (e.key === "Enter" && rows.at(activeIndex)) onSelect(rows.at(activeIndex)!.id);
    else return;
    e.preventDefault();
  };

  const toggleGroup = (g: StatusGroup) => {
    const on = ui.groups.includes(g);
    onUi({
      groups: on ? ui.groups.filter((x) => x !== g) : ALL_GROUPS.filter((x) => x === g || ui.groups.includes(x)),
    });
  };

  return (
    <section aria-label="Fleet" className="flex h-full min-h-0 flex-col">
      <div className="space-y-2 border-b border-line p-3">
        <label htmlFor="fleet-search" className="sr-only">
          Search trucks by plate or driver
        </label>
        <input
          id="fleet-search"
          type="search"
          value={ui.query}
          onChange={(e) => onUi({ query: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === "Enter" && rows.at(0)) onSelect(rows.at(0)!.id);
            if (e.key === "ArrowDown") {
              e.preventDefault();
              listRef.current?.focus();
            }
          }}
          placeholder="Search plate or driver"
          autoComplete="off"
          className="w-full rounded-md border border-control px-3 py-2 text-sm outline-none placeholder:text-muted focus-visible:ring-2 focus-visible:ring-accent"
        />
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Show statuses">
          {ALL_GROUPS.map((g) => (
            <button
              key={g}
              type="button"
              aria-pressed={ui.groups.includes(g)}
              onClick={() => toggleGroup(g)}
              className="inline-flex min-h-8 items-center gap-1.5 rounded-full border px-2.5 text-xs aria-pressed:border-chip aria-pressed:bg-chip aria-pressed:text-chip-fg aria-[pressed=false]:border-control aria-[pressed=false]:text-muted"
            >
              {GROUP_LABEL[g]} <span className="tabular-nums">{number.format(counts[g])}</span>
            </button>
          ))}
        </div>
        <div className="flex items-center justify-between text-xs text-muted">
          <span>
            {snapshot ? `${number.format(rows.length)} of ${number.format(snapshot.count)} trucks` : "Loading trucks…"}
          </span>
          <span className="sr-only" aria-live="polite">
            {countAnnouncement}
          </span>
          <label className="flex items-center gap-1">
            Sort
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as SortKey)}
              className="rounded border border-control bg-surface px-1 py-0.5"
            >
              <option value="status">Needs attention</option>
              <option value="plate">Plate</option>
              <option value="speed">Speed</option>
            </select>
          </label>
        </div>
      </div>

      <div
        ref={listRef}
        role="listbox"
        aria-label="Trucks"
        tabIndex={0}
        aria-activedescendant={rows.at(activeIndex) ? `truck-${rows.at(activeIndex)!.id}` : undefined}
        onKeyDown={onListKey}
        onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
        // Containment: updating rows can't make the browser re-lay-out anything outside the list.
        className="relative min-h-0 flex-1 overflow-y-auto outline-none [contain:strict] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
      >
        <div style={{ height: rows.length * ROW }} className="relative">
          {/* The rows on screen, plus the keyboard-active row wherever it is. The live sort can move
              the active truck out of the window, and aria-activedescendant must always point at an
              element that exists, or a screen reader has nothing to announce. */}
          {[
            ...Array.from({ length: end - start }, (_, i) => start + i),
            ...(activeIndex < start || activeIndex >= end ? [activeIndex] : []),
          ].map((index) => {
            const row = rows.at(index);
            if (!row) return null;
            const selected = row.id === ui.vehicle;
            return (
              <div
                key={row.id}
                id={`truck-${row.id}`}
                role="option"
                aria-selected={selected}
                aria-setsize={rows.length}
                aria-posinset={index + 1}
                onClick={() => {
                  setActiveId(row.id);
                  onSelect(row.id);
                }}
                style={{ top: index * ROW, height: ROW }}
                className={`absolute inset-x-0 flex cursor-pointer items-center gap-3 border-b border-line px-3 text-sm ${
                  selected ? "bg-selected" : index === activeIndex ? "bg-hover" : "hover:bg-hover"
                }`}
              >
                <StatusIcon mode={row.mode} />
                <span className="w-24 shrink-0 font-mono font-medium">{row.plate}</span>
                <span className="min-w-0 flex-1 truncate text-muted">{row.driver}</span>
                <span className="w-24 shrink-0 text-right text-xs text-muted">
                  {/* The icon is decorative (aria-hidden) and moving rows show speed, so a screen reader
                      needs the status in words, or "moving" and "projected" would be sight-only. */}
                  {row.group === "moving" && <span className="sr-only">{MODE_LABEL[row.mode]}, </span>}
                  {row.group === "moving" ? `${Math.round(row.speedKmh)} km/h` : MODE_LABEL[row.mode]}
                </span>
              </div>
            );
          })}
        </div>
        {snapshot && rows.length === 0 && (
          <p className="p-4 text-sm text-muted">No trucks match. Clear the search or turn a status back on.</p>
        )}
      </div>
    </section>
  );
}

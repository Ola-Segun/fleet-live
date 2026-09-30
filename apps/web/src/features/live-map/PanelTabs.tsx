"use client";

import { useRef, type ReactNode } from "react";

export type PanelTab = "trucks" | "alerts" | "zones";
const TABS: readonly PanelTab[] = ["trucks", "alerts", "zones"];

interface Props {
  tab: PanelTab;
  onTab: (tab: PanelTab) => void;
  /** Active, unacknowledged alerts: shown on the tab so they're visible from the truck list. */
  unseen: number;
  children: ReactNode;
}

/**
 * The side panel's three views, as an ARIA tab set: arrow keys move between
 * tabs (and select them, since each view is cheap to show), Home and End jump
 * to the ends, Tab moves into the panel.
 */
export function PanelTabs({ tab, onTab, unseen, children }: Props) {
  const refs = useRef<Partial<Record<PanelTab, HTMLButtonElement | null>>>({});
  const label: Record<PanelTab, string> = { trucks: "Trucks", alerts: "Alerts", zones: "Zones" };

  const onKey = (e: React.KeyboardEvent) => {
    const i = TABS.indexOf(tab);
    const next = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: TABS.length - 1 }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    const t = TABS[(next + TABS.length) % TABS.length]!;
    onTab(t);
    refs.current[t]?.focus();
  };

  return (
    <div id="side-panel" tabIndex={-1} className="flex h-full min-h-0 flex-col outline-none">
      <div role="tablist" aria-label="Panel" onKeyDown={onKey} className="flex shrink-0 border-b border-line">
        {TABS.map((t) => (
          <button
            key={t}
            ref={(el) => {
              refs.current[t] = el;
            }}
            id={`tab-${t}`}
            type="button"
            role="tab"
            aria-selected={tab === t}
            // Only the selected tab's panel exists; pointing at a missing id is an ARIA error.
            aria-controls={tab === t ? `panel-${t}` : undefined}
            tabIndex={tab === t ? 0 : -1}
            onClick={() => onTab(t)}
            className="flex min-h-11 flex-1 items-center justify-center gap-1.5 border-b-2 text-sm aria-selected:border-accent aria-selected:font-semibold aria-[selected=false]:border-transparent aria-[selected=false]:text-muted focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
          >
            {label[t]}
            {t === "alerts" && unseen > 0 && (
              <span className="rounded-full bg-danger px-1.5 text-xs font-semibold tabular-nums text-surface">
                {unseen}
                <span className="sr-only"> new</span>
              </span>
            )}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className="min-h-0 flex-1">
        {children}
      </div>
    </div>
  );
}

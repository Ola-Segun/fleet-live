"use client";

import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_CAMERA, parseCamera } from "@/lib/camera-url";
import { useMediaQuery } from "@/lib/use-media-query";
import { MODE_LABEL } from "@/lib/fleet-view";
import { parseUi, writeUi, type UiState } from "@/lib/ui-url";
import { setShortcutsOn, useShortcutsOn } from "@/lib/shortcuts-setting";
import { configFromSearch } from "@/lib/worker-messages";
import { FleetPanel } from "./FleetPanel";
import type { TruckLayerKind } from "./LiveMap";
import { PerfHud } from "./PerfHud";
import { StatusBar } from "./StatusBar";
import { VehicleDrawer } from "./VehicleDrawer";
import { useFleet } from "./use-fleet";

// MapLibre needs `window` and WebGL, so the map is client-only. The page shell
// still renders on the server; only this component waits for the browser.
const LiveMap = dynamic(() => import("./LiveMap"), {
  ssr: false,
  loading: () => <div className="absolute inset-0 animate-pulse bg-zinc-100" aria-hidden />,
});

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.tagName === "INPUT" ||
    target.tagName === "SELECT" ||
    target.tagName === "TEXTAREA" ||
    target.isContentEditable);

export function FleetApp() {
  const params = useSearchParams();
  // Read once: afterwards the map owns the camera and this component owns the view, and both write back to the URL.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const initialCamera = useMemo(() => parseCamera(params.get("c")) ?? DEFAULT_CAMERA, []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const config = useMemo(() => configFromSearch(new URLSearchParams(params.toString())), []);
  const [ui, setUi] = useState<UiState>(() => parseUi(new URLSearchParams(params.toString())));
  const { status, error, subscribe, gpu, vehicles } = useFleet(config);
  const layer: TruckLayerKind =
    params.get("trucks") === "off" ? "off" : params.get("layer") === "baseline" ? "baseline" : "gl";
  const [announcement, setAnnouncement] = useState("");
  const [sheetOpen, setSheetOpen] = useState(false);
  const hud = params.get("hud") === "1";
  // Tailwind's `md` breakpoint. Decides which layout *exists*, so there is only ever one fleet panel.
  const desktop = useMediaQuery("(min-width: 768px)", true);
  // Single-key shortcuts can be switched off (WCAG 2.1.4).
  const shortcuts = useShortcutsOn();

  const patch = useCallback(
    (p: Partial<UiState>) =>
      setUi((u) => ({ ...u, ...p, follow: (p.follow ?? u.follow) && (p.vehicle ?? u.vehicle) !== undefined })),
    [],
  );

  // The view goes to the URL (without a navigation) and to the GPU (selection ring, status mask).
  useEffect(() => {
    window.history.replaceState(window.history.state, "", writeUi(new URL(window.location.href), ui));
    gpu.select(ui.vehicle);
    gpu.filter(ui.groups);
  }, [ui, gpu]);

  const select = useCallback(
    (id: number | undefined) => {
      // Closing the detail panel removes the element that had focus. Left alone, focus falls to the
      // top of the page and a keyboard or screen-reader user loses their place: send it to the list.
      if (id === undefined && document.activeElement?.closest("[aria-labelledby=drawer-title]")) {
        requestAnimationFrame(() => document.querySelector<HTMLElement>('[role="listbox"]')?.focus());
      }
      patch({ vehicle: id, follow: id === undefined ? false : undefined });
      if (id !== undefined) setSheetOpen(true);
    },
    [patch],
  );

  // Announce a selection once, politely, with what a sighted user sees in the drawer.
  const lastAnnounced = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (ui.vehicle === undefined || ui.vehicle === lastAnnounced.current) return;
    lastAnnounced.current = ui.vehicle;
    const plate = vehicles.get(ui.vehicle)?.plate ?? `Truck ${ui.vehicle}`;
    const where = gpu.where(ui.vehicle);
    setAnnouncement(`${plate} selected${where ? `, ${MODE_LABEL[where.mode] ?? ""}` : ""}.`);
  }, [ui.vehicle, vehicles, gpu]);

  // Keyboard: "/" search, "F" follow (both switchable off), "Escape" clear (not a character key).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isTyping(e.target)) {
        select(undefined);
        return;
      }
      if (!shortcuts) return;
      if (e.key === "/" && !isTyping(e.target)) {
        e.preventDefault();
        setSheetOpen(true);
        document.getElementById("fleet-search")?.focus();
      } else if ((e.key === "f" || e.key === "F") && !isTyping(e.target) && !e.ctrlKey && !e.metaKey) {
        setUi((u) => (u.vehicle === undefined ? u : { ...u, follow: !u.follow }));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [select, shortcuts]);

  const panel = <FleetPanel subscribe={subscribe} vehicles={vehicles} ui={ui} onUi={patch} onSelect={select} />;
  const drawer =
    ui.vehicle !== undefined ? (
      <VehicleDrawer
        vehicleId={ui.vehicle}
        info={vehicles.get(ui.vehicle)}
        subscribe={subscribe}
        follow={ui.follow}
        onFollow={(follow) => patch({ follow })}
        onClose={() => select(undefined)}
      />
    ) : null;

  return (
    <div className="flex h-dvh flex-col">
      <a
        href="#fleet-search"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-white focus:px-3 focus:py-2 focus:shadow"
      >
        Skip to truck search
      </a>
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-200 bg-white px-4 py-2">
        <div className="flex items-center gap-3">
          <h1 className="text-base font-semibold">Fleet Live</h1>
          <button
            type="button"
            aria-pressed={shortcuts}
            onClick={() => setShortcutsOn(!shortcuts)}
            className="min-h-8 rounded-md border border-zinc-500 px-2 text-xs text-zinc-700 focus-visible:ring-2 focus-visible:ring-blue-600"
          >
            Single-key shortcuts: {shortcuts ? "on" : "off"}
          </button>
        </div>
        <StatusBar status={status} error={error} subscribe={subscribe} />
      </header>

      <div className="relative flex min-h-0 flex-1">
        {/* Desktop: the list beside the map. Phone: a bottom sheet over the map (below). */}
        {desktop && (
          <aside className="w-[22rem] shrink-0 border-r border-zinc-200 bg-white [contain:content]">{panel}</aside>
        )}

        <main className="relative min-w-0 flex-1">
          <LiveMap
            initialCamera={initialCamera}
            subscribe={subscribe}
            gpu={gpu}
            layer={layer}
            selected={ui.vehicle}
            follow={ui.follow}
            onPick={select}
            onUserMove={() => patch({ follow: false })}
          />
          {desktop && drawer && <div className="absolute right-3 top-3 z-10 w-80">{drawer}</div>}
          {hud && <PerfHud gpu={gpu} />}
        </main>

        {!desktop && (
          <div
            className={`absolute inset-x-0 bottom-0 z-20 flex flex-col rounded-t-2xl border-t border-zinc-200 bg-white shadow-2xl ${
              sheetOpen ? "h-[60dvh]" : "h-16"
            }`}
          >
            <button
              type="button"
              aria-expanded={sheetOpen}
              aria-controls="fleet-sheet"
              onClick={() => setSheetOpen((o) => !o)}
              className="flex min-h-12 items-center justify-center gap-2 text-sm font-medium"
            >
              <span aria-hidden className="h-1 w-10 rounded-full bg-zinc-300" />
              {sheetOpen ? "Hide trucks" : "Show trucks"}
            </button>
            {sheetOpen && (
              <div id="fleet-sheet" className="flex min-h-0 flex-1 flex-col">
                {drawer && <div className="px-3 pb-2">{drawer}</div>}
                <div className="min-h-0 flex-1">{panel}</div>
              </div>
            )}
          </div>
        )}
      </div>

      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>
    </div>
  );
}

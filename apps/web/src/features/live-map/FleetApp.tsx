"use client";

import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Alert } from "@fleet/alerts";
import { announcement as alertAnnouncement, lagosTime, type AlertNames } from "@/lib/alert-text";
import { Gather } from "@/lib/gather";
import { useZones } from "@/lib/zones";
import { DEFAULT_CAMERA, parseCamera } from "@/lib/camera-url";
import { useMediaQuery } from "@/lib/use-media-query";
import { MODE_LABEL } from "@/lib/fleet-view";
import { parseUi, writeUi, type UiState } from "@/lib/ui-url";
import { setShortcutsOn, useShortcutsOn } from "@/lib/shortcuts-setting";
import { setTheme, useDarkTheme } from "@/lib/theme-setting";
import { configFromSearch } from "@/lib/worker-messages";
import { AlertsPanel, type AlertAction } from "./AlertsPanel";
import { FleetPanel } from "./FleetPanel";
import { PanelTabs, type PanelTab } from "./PanelTabs";
import { ReplayBar, replayNow, type ReplayState } from "./ReplayBar";
import { ZonesPanel, type DrawState } from "./ZonesPanel";
import type { TruckLayerKind } from "./LiveMap";
import { PerfHud } from "./PerfHud";
import { StatusBar } from "./StatusBar";
import { VehicleDrawer } from "./VehicleDrawer";
import { useFleet } from "./use-fleet";

// MapLibre needs `window` and WebGL, so the map is client-only. The page shell
// still renders on the server; only this component waits for the browser.
const LiveMap = dynamic(() => import("./LiveMap"), {
  ssr: false,
  loading: () => <div className="absolute inset-0 animate-pulse bg-hover" aria-hidden />,
});

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.tagName === "INPUT" ||
    target.tagName === "SELECT" ||
    target.tagName === "TEXTAREA" ||
    target.isContentEditable);

/** At most one alert announcement this often: more are gathered into the next one. */
const ANNOUNCE_EVERY_MS = 5000;
const NO_ALERTS: readonly Alert[] = [];

export function FleetApp() {
  const params = useSearchParams();
  // Read once: afterwards the map owns the camera and this component owns the view, and both write back to the URL.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const initialCamera = useMemo(() => parseCamera(params.get("c")) ?? DEFAULT_CAMERA, []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const config = useMemo(() => configFromSearch(new URLSearchParams(params.toString())), []);
  const [ui, setUi] = useState<UiState>(() => parseUi(new URLSearchParams(params.toString())));
  const { status, error, subscribe, gpu, vehicles, alerts: alertsMessage, send } = useFleet(config);
  const zones = useZones();
  const [tab, setTab] = useState<PanelTab>("trucks");
  const [draft, setDraft] = useState<[number, number][] | null>(null);
  const [draw, setDraw] = useState<DrawState>({ step: "idle" });
  const [focusZone, setFocusZone] = useState<{ id: string; token: number } | null>(null);
  const centre = useRef<[number, number] | null>(null);
  // Replay (Layer 9). The page and the Worker run the same clock from this anchor.
  const [replay, setReplay] = useState<ReplayState | null>(null);
  const replaying = useRef(false);
  const history = status?.history;
  const layer: TruckLayerKind =
    params.get("trucks") === "off" ? "off" : params.get("layer") === "baseline" ? "baseline" : "gl";
  const [announcement, setAnnouncement] = useState("");
  const [sheetOpen, setSheetOpen] = useState(false);
  const hud = params.get("hud") === "1";
  // Tailwind's `md` breakpoint. Decides which layout *exists*, so there is only ever one fleet panel.
  const desktop = useMediaQuery("(min-width: 768px)", true);
  // The system's scheme until the person picks one with the header button.
  const dark = useDarkTheme();
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

  // The Worker evaluates alerts against the zones, so it gets every change to them.
  useEffect(() => send({ type: "zones", zones: [...zones] }), [zones, send]);

  const alerts = alertsMessage?.alerts ?? NO_ALERTS;
  const zoneCounts = useMemo(() => new Map(alertsMessage?.zoneCounts ?? []), [alertsMessage]);
  // Trucks with an active alert: diamonds on the map, first in the list. The same Set object until its
  // members change: alert messages arrive up to twice a second (a zone count moving is enough), and a new
  // Set each time re-sorted and re-rendered the whole truck list for nothing. The frame trace showed it.
  const alertingKey = alerts
    .filter((a) => a.active)
    .map((a) => a.vehicleId)
    .sort((a, b) => a - b)
    .join(",");
  const alerting = useMemo(() => new Set(alertingKey ? alertingKey.split(",").map(Number) : []), [alertingKey]);
  useEffect(() => gpu.setAlerting(alerting), [alerting, gpu]);
  const unseen = alerts.filter((a) => a.active && a.acknowledgedAt === undefined).length;
  const names = useMemo<AlertNames>(() => {
    const zoneName = new Map(zones.map((z) => [z.id, z.name]));
    return {
      plate: (id) => vehicles.get(id)?.plate ?? `Truck ${id}`,
      zone: (id) => (id !== undefined ? zoneName.get(id) : undefined) ?? "a deleted zone",
    };
  }, [vehicles, zones]);
  const act = useCallback(
    (action: AlertAction, id?: number) =>
      send(action === "resolve-cleared" ? { type: "alert", action } : { type: "alert", action, id: id! }),
    [send],
  );

  // New alerts are announced politely, gathered so a burst is one sentence, never more than one
  // every 5 s: a screen reader reading every alert as it lands would talk over everything else.
  const namesRef = useRef(names);
  useEffect(() => {
    namesRef.current = names;
  }, [names]);
  const gather = useRef<Gather<Alert> | null>(null);
  useEffect(() => {
    const g = new Gather<Alert>(ANNOUNCE_EVERY_MS, (items) => setAnnouncement(alertAnnouncement(items, namesRef.current)));
    gather.current = g;
    return () => g.dispose();
  }, []);
  useEffect(() => {
    if (!alertsMessage || alertsMessage.raised.length === 0) return;
    const byId = new Map(alertsMessage.alerts.map((a) => [a.id, a]));
    gather.current?.push(alertsMessage.raised.flatMap((id) => byId.get(id) ?? []));
  }, [alertsMessage]);

  const changeReplay = useCallback(
    (next: { at: number; speed: number; playing: boolean }) => {
      const r: ReplayState = { ...next, local: performance.now() };
      if (!replaying.current) setAnnouncement(`Replay at ${lagosTime(next.at)}, paused. The map, list and details show that time. Alerts stay live.`);
      replaying.current = true;
      setReplay(r);
      gpu.setReplay(r);
      send({ type: "replay", at: next.at, wall: Date.now(), speed: next.speed, playing: next.playing });
    },
    [gpu, send],
  );
  const goLive = useCallback(
    (reason = "Back to live.") => {
      replaying.current = false;
      setReplay(null);
      gpu.setReplay(undefined);
      send({ type: "live" });
      setAnnouncement(reason);
    },
    [gpu, send],
  );
  // Playing forwards reaches the newest recorded moment: that's live, so go there.
  useEffect(() => {
    if (!replay?.playing || !history) return;
    const timer = setInterval(() => {
      if (replayNow(replay) >= history.to) goLive("Caught up with live.");
    }, 250);
    return () => clearInterval(timer);
  }, [replay, history, goLive]);

  // Drawing a zone: corners from map clicks or the map centre, then name it in the Zones panel.
  const addCorner = useCallback((c: [number, number]) => setDraft((d) => (d ? [...d, c] : d)), []);
  // While a draft exists the panel shows the drawing step; otherwise `draw` (idle or naming) decides.
  const drawView: DrawState = draft !== null ? { step: "drawing", corners: draft.length } : draw;
  const startDraw = useCallback(() => {
    setTab("zones");
    setDraft([]);
  }, []);
  const cancelDraw = useCallback(() => {
    setDraft(null);
    setDraw({ step: "idle" });
  }, []);
  const finishDraw = useCallback(() => {
    if (!draft || draft.length < 3) return;
    setDraw({ step: "naming", shape: [[[...draft, draft[0]!]]] });
    setDraft(null);
  }, [draft]);

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
      // While drawing: Enter closes the shape, Backspace removes a corner, Escape cancels.
      if (draft !== null && !isTyping(e.target)) {
        const onButton = e.target instanceof HTMLButtonElement;
        if (e.key === "Escape") cancelDraw();
        else if (e.key === "Backspace") setDraft((d) => (d ? d.slice(0, -1) : d));
        else if (e.key === "Enter" && !onButton) finishDraw();
        else return;
        e.preventDefault();
        return;
      }
      if (e.key === "Escape" && !isTyping(e.target)) {
        select(undefined);
        return;
      }
      if (!shortcuts) return;
      if (e.key === "/" && !isTyping(e.target)) {
        e.preventDefault();
        setSheetOpen(true);
        const search = document.getElementById("fleet-search");
        if (search) search.focus();
        else {
          // On another tab (or a closed sheet) the search box doesn't exist until the next render.
          setTab("trucks");
          requestAnimationFrame(() => document.getElementById("fleet-search")?.focus());
        }
      } else if ((e.key === "f" || e.key === "F") && !isTyping(e.target) && !e.ctrlKey && !e.metaKey) {
        setUi((u) => (u.vehicle === undefined ? u : { ...u, follow: !u.follow }));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [select, shortcuts, draft, cancelDraw, finishDraw]);

  const showTruck = useCallback(
    (id: number) => {
      select(id);
      if (!desktop) setTab("trucks");
    },
    [select, desktop],
  );
  const drawerAlerts = useMemo(() => alerts.filter((a) => a.vehicleId === ui.vehicle), [alerts, ui.vehicle]);
  const panel = (
    <PanelTabs tab={tab} onTab={setTab} unseen={unseen}>
      {tab === "trucks" && <FleetPanel subscribe={subscribe} vehicles={vehicles} ui={ui} onUi={patch} onSelect={select} alerting={alerting} />}
      {tab === "alerts" && <AlertsPanel alerts={alerts} names={names} onShow={showTruck} onAct={act} replaying={replay !== null} />}
      {tab === "zones" && (
        <ZonesPanel
          zones={zones}
          counts={zoneCounts}
          draw={drawView}
          onStartDraw={startDraw}
          onAddCentre={() => centre.current && addCorner(centre.current)}
          onUndoCorner={() => setDraft((d) => (d ? d.slice(0, -1) : d))}
          onFinishDraw={finishDraw}
          onCancelDraw={cancelDraw}
          onShowZone={(id) => setFocusZone((f) => ({ id, token: (f?.token ?? 0) + 1 }))}
        />
      )}
    </PanelTabs>
  );
  const drawer =
    ui.vehicle !== undefined ? (
      <VehicleDrawer
        vehicleId={ui.vehicle}
        info={vehicles.get(ui.vehicle)}
        subscribe={subscribe}
        alerts={drawerAlerts}
        names={names}
        onAct={act}
        follow={ui.follow}
        onFollow={(follow) => patch({ follow })}
        onClose={() => select(undefined)}
      />
    ) : null;

  return (
    <div className="flex h-dvh flex-col">
      {/* To the side panel, which exists on every tab. It pointed at the search box, which only the
          Trucks tab has: on the others the link led nowhere (axe: skip-link, region). */}
      <a
        href="#side-panel"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-surface focus:px-3 focus:py-2 focus:shadow"
      >
        Skip to the side panel
      </a>
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-surface px-4 py-2">
        <div className="flex items-center gap-3">
          <h1 className="text-base font-semibold">Fleet Live</h1>
          <button
            type="button"
            aria-pressed={shortcuts}
            onClick={() => setShortcutsOn(!shortcuts)}
            className="min-h-8 rounded-md border border-control px-2 text-xs text-muted focus-visible:ring-2 focus-visible:ring-accent"
          >
            Single-key shortcuts: {shortcuts ? "on" : "off"}
          </button>
          <button
            type="button"
            aria-pressed={dark}
            onClick={() => setTheme(dark ? "light" : "dark")}
            className="inline-flex min-h-8 items-center gap-1.5 rounded-md border border-control px-2 text-xs text-muted focus-visible:ring-2 focus-visible:ring-accent"
          >
            <span aria-hidden>{dark ? "☾" : "☀"}</span>
            Dark mode
          </button>
        </div>
        <StatusBar status={status} error={error} subscribe={subscribe} />
      </header>

      <div className="relative flex min-h-0 flex-1">
        {/* Desktop: the list beside the map. Phone: a bottom sheet over the map (below). */}
        {desktop && (
          <aside className="w-[22rem] shrink-0 border-r border-line bg-surface [contain:content]">{panel}</aside>
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
            dark={dark}
            zones={zones}
            draft={draft}
            onDraftCorner={addCorner}
            onCentre={(c) => {
              centre.current = c;
            }}
            focusZone={focusZone}
          />
          {desktop && drawer && <div className="absolute right-3 top-3 z-10 w-80">{drawer}</div>}
          {/* Desktop: along the bottom, above the map's attribution line (the data licences require it be
              visible; the README screenshot showed the bar covering it) and clear of the zoom controls.
              Phone: along the top, clear of the sheet. */}
          <div className={`absolute z-10 ${desktop ? "bottom-10 left-3 right-16 max-w-3xl" : "inset-x-3 top-3"}`}>
            <ReplayBar history={history} replay={replay} onChange={changeReplay} onLive={() => goLive()} />
          </div>
          {hud && <PerfHud gpu={gpu} />}
        </main>

        {!desktop && (
          <div
            className={`absolute inset-x-0 bottom-0 z-20 flex flex-col rounded-t-2xl border-t border-line bg-surface shadow-2xl ${
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
              <span aria-hidden className="h-1 w-10 rounded-full bg-control" />
              {sheetOpen ? "Hide panel" : "Show trucks, alerts and zones"}
              {!sheetOpen && unseen > 0 && (
                <span className="rounded-full bg-danger px-1.5 text-xs font-semibold tabular-nums text-surface">
                  {unseen}
                  <span className="sr-only"> new alerts</span>
                </span>
              )}
            </button>
            {sheetOpen && (
              // A landmark, like the desktop side panel: the tab bar would otherwise sit outside every landmark.
              <aside id="fleet-sheet" className="flex min-h-0 flex-1 flex-col">
                {drawer && <div className="px-3 pb-2">{drawer}</div>}
                <div className="min-h-0 flex-1">{panel}</div>
              </aside>
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

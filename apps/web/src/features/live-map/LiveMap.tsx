"use client";

import { useEffect, useRef } from "react";
import type { Feature, FeatureCollection } from "geojson";
import maplibregl, { type GeoJSONSource, type Map as MapLibreMap } from "maplibre-gl";
import { zonesToGeoJSON, type ZoneSpec } from "@fleet/alerts";
import { slotEstimate } from "@fleet/gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { formatCamera, type Camera } from "@/lib/camera-url";
import type { FleetGpuState } from "@/lib/gpu-state";
import { pickNearest } from "@/lib/fleet-view";
import { fleetPerf } from "@/lib/perf";
import { snapshotToGeoJSON } from "@/lib/snapshot-geojson";
import type { SnapshotListener } from "./use-fleet";
import { VehicleLayer, type VehicleLayerStats } from "./vehicle-layer";

export type TruckLayerKind = "gl" | "baseline" | "off";

/** OpenFreeMap: free, no API key, commercial use allowed; attribution required (shown by MapLibre's control). */
const styleUrl = (dark: boolean) => `https://tiles.openfreemap.org/styles/${dark ? "dark" : "positron"}`;

/**
 * Add the truck layer once MapLibre will accept it. MapLibre drops custom layers
 * whenever it rebuilds the style: after a lost WebGL context, and after a style
 * swap (the dark/light switch). `isStyleLoaded()` also waits for every tile, and
 * `styledata` stops firing before tiles finish, so waiting on both never
 * succeeded. Adding a layer needs only the style: try on each style and idle
 * event until it takes.
 */
function ensureVehicleLayer(map: MapLibreMap, gpu: FleetGpuState, stats: VehicleLayerStats): void {
  const attempt = () => {
    try {
      if (!map.getLayer("fleet-vehicles")) {
        map.addLayer(new VehicleLayer(gpu, stats));
        stats.layersAdded++;
      }
      map.off("styledata", attempt);
      map.off("idle", attempt);
    } catch {
      // "Style is not done loading": wait for the next event.
    }
  };
  map.on("styledata", attempt);
  map.on("idle", attempt);
  attempt();
}

/** A draft zone as it's drawn: the corners so far, and the outline closing back to the first. */
function draftGeoJSON(corners: readonly (readonly [number, number])[]): FeatureCollection {
  const features: Feature[] = corners.map((c) => ({ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [...c] } }));
  if (corners.length >= 2) {
    const ring = corners.length >= 3 ? [...corners, corners[0]!] : corners;
    features.push({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: ring.map((c) => [...c]) } });
  }
  return { type: "FeatureCollection", features };
}

const ZONE_COLOUR = ["match", ["get", "kind"], "restricted", "#dc2626", "#2563eb"] as const;

/**
 * Zones and the draft outline, drawn with stock MapLibre layers: a handful of
 * polygons that change only when someone edits them, which is exactly what
 * GeoJSON sources are good at (unlike 5,000 moving trucks). They sit below the
 * truck layer. A style swap drops them, like the truck layer, so this runs on
 * every `style.load`.
 *
 * Restricted areas have a solid edge and depots a dashed one, so the kind
 * isn't told by colour alone.
 */
function addZoneLayers(map: MapLibreMap, zones: readonly ZoneSpec[], draft: readonly (readonly [number, number])[], dark: boolean): void {
  if (!map.getSource("zones")) map.addSource("zones", { type: "geojson", data: zonesToGeoJSON(zones) as FeatureCollection });
  if (!map.getSource("zone-draft")) map.addSource("zone-draft", { type: "geojson", data: draftGeoJSON(draft) });
  const before = map.getLayer("fleet-vehicles") ? "fleet-vehicles" : undefined;
  const add = (layer: Parameters<MapLibreMap["addLayer"]>[0]) => {
    if (!map.getLayer(layer.id)) map.addLayer(layer, before);
  };
  add({ id: "zones-fill", type: "fill", source: "zones", paint: { "fill-color": ZONE_COLOUR as never, "fill-opacity": dark ? 0.2 : 0.12 } });
  add({ id: "zones-edge-restricted", type: "line", source: "zones", filter: ["==", ["get", "kind"], "restricted"], paint: { "line-color": "#dc2626", "line-width": 2 } });
  add({
    id: "zones-edge-depot",
    type: "line",
    source: "zones",
    filter: ["==", ["get", "kind"], "depot"],
    paint: { "line-color": dark ? "#60a5fa" : "#2563eb", "line-width": 2, "line-dasharray": [2, 1.5] },
  });
  add({
    id: "zones-label",
    type: "symbol",
    source: "zones",
    layout: { "text-field": ["get", "name"], "text-font": ["Noto Sans Regular"], "text-size": 12 },
    paint: { "text-color": dark ? "#fafafa" : "#18181b", "text-halo-color": dark ? "#18181b" : "#ffffff", "text-halo-width": 1.5 },
  });
  add({ id: "zone-draft-line", type: "line", source: "zone-draft", paint: { "line-color": "#7c3aed", "line-width": 2, "line-dasharray": [1, 1] } });
  add({
    id: "zone-draft-corners",
    type: "circle",
    source: "zone-draft",
    filter: ["==", ["geometry-type"], "Point"],
    paint: { "circle-radius": 5, "circle-color": "#7c3aed", "circle-stroke-color": "#ffffff", "circle-stroke-width": 2 },
  });
}

interface Props {
  initialCamera: Camera;
  subscribe: (listener: SnapshotListener) => () => void;
  gpu: FleetGpuState;
  /**
   * `gl` (default): the WebGL layer, interpolating on the GPU every frame.
   * `baseline` (`?layer=baseline`): the stock GeoJSON layer from Layer 6, kept to compare against.
   * `off` (`?trucks=off`): the map alone, so each layer's cost can be measured by difference.
   */
  layer: TruckLayerKind;
  selected: number | undefined;
  follow: boolean;
  /** A click on the map: the truck under it, or undefined for empty map. */
  onPick: (id: number | undefined) => void;
  /** The dispatcher dragged the map themselves, so following should stop. */
  onUserMove: () => void;
  /** The system's colour scheme: picks the basemap, and the selection ring's colour. */
  dark: boolean;
  zones: readonly ZoneSpec[];
  /** Corners of the zone being drawn ([lng, lat]), or null when not drawing. Clicks add corners instead of picking trucks. */
  draft: readonly (readonly [number, number])[] | null;
  onDraftCorner: (lngLat: [number, number]) => void;
  /** The map's centre whenever it settles: "Add corner at map centre" uses it. */
  onCentre: (lngLat: [number, number]) => void;
  /** Fit the map to this zone. The token makes the same zone showable twice in a row. */
  focusZone: { id: string; token: number } | null;
}

/** Pick radius, CSS px: about a fingertip, and the WCAG 2.2 minimum target size. */
const PICK_RADIUS = 24;

/**
 * The truck under a click, found only when someone clicks. It uses the same
 * estimate the GPU draws (`slotEstimate` on the page's texture copy), so what
 * you click is what you see. Trucks outside the click's box are rejected in
 * degrees before anything is projected to the screen.
 */
function pickAt(map: MapLibreMap, gpu: FleetGpuState, point: { x: number; y: number }): number | undefined {
  if (gpu.epoch === undefined || gpu.lastDisplay === undefined) return undefined;
  const time = (gpu.lastDisplay - gpu.epoch) / 1000;
  const a = map.unproject([point.x - PICK_RADIUS, point.y - PICK_RADIUS]);
  const b = map.unproject([point.x + PICK_RADIUS, point.y + PICK_RADIUS]);
  const [south, north] = [Math.min(a.lat, b.lat), Math.max(a.lat, b.lat)];
  const [west, east] = [Math.min(a.lng, b.lng), Math.max(a.lng, b.lng)];
  const near: { id: number; x: number; y: number }[] = [];
  for (let slot = 0; slot < gpu.mirror.count; slot++) {
    const e = slotEstimate(gpu.mirror.data, slot, time);
    if (!e || !gpu.visible(e.mode)) continue;
    if (e.lat < south || e.lat > north || e.lon < west || e.lon > east) continue;
    const p = map.project([e.lon, e.lat]);
    near.push({ id: gpu.slotIds[slot]!, x: p.x, y: p.y });
  }
  return pickNearest(near, point.x, point.y, PICK_RADIUS);
}

/**
 * The base map and the truck layer: the WebGL layer by default, or the stock
 * GeoJSON baseline it replaced, kept so the two can be compared on the same page.
 */
export default function LiveMap({ initialCamera, subscribe, gpu, layer, selected, follow, onPick, onUserMove, dark, zones, draft, onDraftCorner, onCentre, focusZone }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const statsRef = useRef<VehicleLayerStats | null>(null);
  const darkAtCreation = useRef(dark);
  // Latest callbacks in refs, so the map is created once and never re-created by a re-render.
  const handlers = useRef({ onPick, onUserMove, onDraftCorner, onCentre });
  // Read by map events and style reloads, which outlive any one render.
  const overlay = useRef({ zones, draft, dark });
  useEffect(() => {
    handlers.current = { onPick, onUserMove, onDraftCorner, onCentre };
    overlay.current = { zones, draft, dark };
  });

  useEffect(() => {
    if (!container.current) return;
    // Start observing before the map exists, so start-up and the no-trucks comparison are both measured.
    const perf = fleetPerf();
    perf.probe = (id) => {
      const w = gpu.where(id);
      return w && gpu.lastDisplay !== undefined ? { at: gpu.lastDisplay, lat: w.lat, lon: w.lon, mode: w.mode } : undefined;
    };
    const map = new maplibregl.Map({
      container: container.current,
      style: styleUrl(darkAtCreation.current),
      center: [initialCamera.lng, initialCamera.lat],
      zoom: initialCamera.zoom,
      attributionControl: { compact: true },
    });
    // Bottom-right: the truck detail panel occupies the top-right corner, and covered these controls there.
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), "bottom-right");

    mapRef.current = map;

    // Keep the camera in the URL without a navigation, so a copied link reopens this view.
    // At most once a second: follow mode moves the camera every frame, and Chrome throttles
    // history.replaceState after about 100 calls in 10 seconds.
    let cameraTimer: ReturnType<typeof setTimeout> | undefined;
    map.on("moveend", () => {
      if (cameraTimer) return;
      cameraTimer = setTimeout(() => {
        cameraTimer = undefined;
        const c = map.getCenter();
        const url = new URL(window.location.href);
        url.searchParams.set("c", formatCamera({ lat: c.lat, lng: c.lng, zoom: map.getZoom() }));
        window.history.replaceState(window.history.state, "", url);
      }, 1000);
    });

    const reportCentre = () => {
      const c = map.getCenter();
      handlers.current.onCentre([c.lng, c.lat]);
    };
    map.on("load", reportCentre);
    map.on("moveend", reportCentre);
    // Zones go back on after every style load: the first, and each dark/light swap.
    map.on("style.load", () => {
      const { zones, draft, dark } = overlay.current;
      addZoneLayers(map, zones, draft ?? [], dark);
    });

    map.on("click", (e) => {
      if (overlay.current.draft) {
        handlers.current.onDraftCorner([e.lngLat.lng, e.lngLat.lat]);
        return;
      }
      const t0 = performance.now();
      const id = pickAt(map, gpu, e.point);
      perf.lastPickMs = performance.now() - t0;
      handlers.current.onPick(id);
    });
    // A drag by a person (not by follow mode's own camera moves) hands control back to them.
    map.on("dragstart", (e) => {
      if (e.originalEvent) handlers.current.onUserMove();
    });

    let unsubscribe: (() => void) | undefined;
    map.on("load", () => {
      if (layer === "off") return;
      if (layer === "gl") {
        const stats: VehicleLayerStats = { frames: 0, renderMs: 0, uploads: 0, contextRestores: 0, layersAdded: 1, skipped: 0, alerting: 0 };
        perf.layer = stats;
        statsRef.current = stats;
        map.addLayer(new VehicleLayer(gpu, stats));
        // MapLibre 5 destroys the style when the WebGL context is lost, and does not
        // restore custom layers. Once it has reloaded the style, add a fresh one.
        map.on("webglcontextrestored", () => {
          stats.contextRestores++;
          ensureVehicleLayer(map, gpu, stats);
        });
        return;
      }
      map.addSource("vehicles", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({
        id: "vehicles",
        type: "circle",
        source: "vehicles",
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 9, 1.5, 13, 4, 17, 7],
          "circle-color": [
            "match",
            ["get", "mode"],
            "interpolated", "#2563eb",
            "extrapolated", "#d97706",
            "holding", "#ea580c",
            "parked", "#6b7280",
            "stale", "#dc2626",
            "#9ca3af",
          ],
          "circle-stroke-width": 0.5,
          "circle-stroke-color": "#ffffff",
        },
      });

      const source = map.getSource("vehicles") as GeoJSONSource;
      unsubscribe = subscribe((snapshot) => {
        const t0 = performance.now();
        const data = snapshotToGeoJSON(snapshot);
        const t1 = performance.now();
        source.setData(data);
        const t2 = performance.now();
        perf.refreshes.push({ build: t1 - t0, hand: t2 - t1, count: snapshot.count });
      });
    });

    return () => {
      clearTimeout(cameraTimer);
      unsubscribe?.();
      mapRef.current = null;
      map.remove();
    };
    // The initial camera is read once; after that the map owns it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subscribe, gpu, layer]);

  // The system theme changed mid-session: swap the basemap, then put the truck layer back
  // (a style swap drops custom layers, like a lost context does).
  useEffect(() => {
    const map = mapRef.current;
    gpu.setDark(dark);
    if (!map || dark === darkAtCreation.current) return;
    darkAtCreation.current = dark;
    map.setStyle(styleUrl(dark), { diff: false });
    if (layer === "gl" && statsRef.current) ensureVehicleLayer(map, gpu, statsRef.current);
  }, [dark, gpu, layer]);

  // Zones and the draft outline follow their props. Cheap: a few polygons, only when edited.
  useEffect(() => {
    (mapRef.current?.getSource("zones") as GeoJSONSource | undefined)?.setData(zonesToGeoJSON(zones) as FeatureCollection);
  }, [zones]);
  const drawing = draft !== null;
  useEffect(() => {
    const map = mapRef.current;
    (map?.getSource("zone-draft") as GeoJSONSource | undefined)?.setData(draftGeoJSON(draft ?? []));
  }, [draft]);
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    // While drawing, a double click would zoom as well as add a corner.
    if (drawing) map.doubleClickZoom.disable();
    else map.doubleClickZoom.enable();
    map.getCanvas().style.cursor = drawing ? "crosshair" : "";
  }, [drawing]);

  useEffect(() => {
    const map = mapRef.current;
    const zone = focusZone && overlay.current.zones.find((z) => z.id === focusZone.id);
    if (!map || !zone) return;
    const bounds = new maplibregl.LngLatBounds();
    for (const polygon of zone.coordinates) for (const [lng, lat] of polygon[0]!) bounds.extend([lng!, lat!]);
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    map.fitBounds(bounds, { padding: 60, maxZoom: 16, duration: reduce ? 0 : 700 });
  }, [focusZone]);

  // Selecting a truck from the list or search brings it into view, unless follow mode will.
  // It runs when the *selection* changes, never when follow changes: a drag switches follow off,
  // and flying back to the truck at that moment cancelled the drag (easeTo stops gestures) and
  // turned its release into a click on empty map, which cleared the selection. Found in Chrome.
  const followRef = useRef(follow);
  useEffect(() => {
    followRef.current = follow;
  }, [follow]);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || selected === undefined || followRef.current) return;
    const target = gpu.where(selected);
    if (!target) return;
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    map.easeTo({ center: [target.lon, target.lat], zoom: Math.max(map.getZoom(), 14), duration: reduce ? 0 : 700 });
  }, [selected, gpu]);

  // Follow: keep the selected truck centred, every frame, exactly where the GPU draws it.
  // Every MapLibre camera call stops gestures in progress, so re-centring while the person is
  // zooming or dragging would cancel their gesture (the first version did: drags were cut off
  // and their release read as a click). Follow gives way: it only re-centres when the map is
  // still and no pointer is down. Zooming in on a followed truck works; a drag hands control
  // back (dragstart, above).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || selected === undefined || !follow) return;
    if (map.getZoom() < 14) map.jumpTo({ zoom: 15 });
    // A drag isn't "moving" until the pointer has travelled a few pixels, so a re-centre in that
    // window would still cancel it before it starts. Give way from the moment the pointer is down.
    let pointerDown = false;
    const canvas = map.getCanvasContainer();
    const down = () => (pointerDown = true);
    const up = () => (pointerDown = false);
    canvas.addEventListener("pointerdown", down);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    let raf = 0;
    const tick = () => {
      const target = gpu.where(selected);
      if (target && !pointerDown && !map.isMoving()) map.jumpTo({ center: [target.lon, target.lat] });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      canvas.removeEventListener("pointerdown", down);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
  }, [selected, follow, gpu]);

  // MapLibre adds `.maplibregl-map { position: relative }` to its container, which
  // overrode `absolute inset-0` and collapsed it to 0 px tall: a blank map with a
  // working status bar. The wrapper owns the positioning; MapLibre's div just fills it.
  return (
    <div className="absolute inset-0">
      <div ref={container} className="h-full w-full" role="region" aria-label="Map of the fleet" />
      {/* Drawing without a pointer: the corner "Add corner at map centre" will place. */}
      {drawing && (
        <div aria-hidden className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-2xl leading-none text-[#7c3aed] [text-shadow:0_0_2px_#fff]">
          +
        </div>
      )}
    </div>
  );
}

"use client";

import { useEffect, useRef } from "react";
import maplibregl, { type GeoJSONSource, type Map as MapLibreMap } from "maplibre-gl";
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

/** Free, no API key, commercial use allowed; attribution required (shown by MapLibre's control). */
const STYLE_URL = "https://tiles.openfreemap.org/styles/positron";

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
export default function LiveMap({ initialCamera, subscribe, gpu, layer, selected, follow, onPick, onUserMove }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  // Latest callbacks in refs, so the map is created once and never re-created by a re-render.
  const handlers = useRef({ onPick, onUserMove });
  useEffect(() => {
    handlers.current = { onPick, onUserMove };
  });

  useEffect(() => {
    if (!container.current) return;
    // Start observing before the map exists, so start-up and the no-trucks comparison are both measured.
    const perf = fleetPerf();
    const map = new maplibregl.Map({
      container: container.current,
      style: STYLE_URL,
      center: [initialCamera.lng, initialCamera.lat],
      zoom: initialCamera.zoom,
      attributionControl: { compact: true },
    });
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), "top-right");

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

    map.on("click", (e) => {
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
        const stats: VehicleLayerStats = { frames: 0, renderMs: 0, uploads: 0, contextRestores: 0, layersAdded: 1, skipped: 0 };
        perf.layer = stats;
        map.addLayer(new VehicleLayer(gpu, stats));
        // MapLibre 5 destroys the style when the WebGL context is lost, and does not
        // restore custom layers. Once it has reloaded the style, add a fresh one.
        map.on("webglcontextrestored", () => {
          stats.contextRestores++;
          // `isStyleLoaded()` also waits for every tile, and `styledata` stops firing
          // before tiles finish, so waiting on both never succeeded. Adding a layer only
          // needs the style itself: try on each style and idle event until it takes.
          const readd = () => {
            try {
              if (!map.getLayer("fleet-vehicles")) {
                map.addLayer(new VehicleLayer(gpu, stats));
                stats.layersAdded++;
              }
              map.off("styledata", readd);
              map.off("idle", readd);
            } catch {
              // "Style is not done loading": wait for the next event.
            }
          };
          map.on("styledata", readd);
          map.on("idle", readd);
          readd();
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
    </div>
  );
}

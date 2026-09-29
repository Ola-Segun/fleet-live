"use client";

import { useEffect, useRef } from "react";
import maplibregl, { type GeoJSONSource } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { formatCamera, type Camera } from "@/lib/camera-url";
import type { FleetGpuState } from "@/lib/gpu-state";
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
}

/**
 * The base map and the truck layer: the WebGL layer by default, or the stock
 * GeoJSON baseline it replaced, kept so the two can be compared on the same page.
 */
export default function LiveMap({ initialCamera, subscribe, gpu, layer }: Props) {
  const container = useRef<HTMLDivElement>(null);

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

    // Keep the camera in the URL without a navigation, so a copied link reopens this view.
    map.on("moveend", () => {
      const c = map.getCenter();
      const url = new URL(window.location.href);
      url.searchParams.set("c", formatCamera({ lat: c.lat, lng: c.lng, zoom: map.getZoom() }));
      window.history.replaceState(window.history.state, "", url);
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
      unsubscribe?.();
      map.remove();
    };
    // The initial camera is read once; after that the map owns it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subscribe, gpu, layer]);

  // MapLibre adds `.maplibregl-map { position: relative }` to its container, which
  // overrode `absolute inset-0` and collapsed it to 0 px tall: a blank map with a
  // working status bar. The wrapper owns the positioning; MapLibre's div just fills it.
  return (
    <div className="absolute inset-0">
      <div ref={container} className="h-full w-full" role="region" aria-label="Map of the fleet" />
    </div>
  );
}

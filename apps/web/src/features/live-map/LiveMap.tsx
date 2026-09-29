"use client";

import { useEffect, useRef } from "react";
import maplibregl, { type GeoJSONSource } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { formatCamera, type Camera } from "@/lib/camera-url";
import { fleetPerf } from "@/lib/perf";
import { snapshotToGeoJSON } from "@/lib/snapshot-geojson";
import type { SnapshotListener } from "./use-fleet";

/** Free, no API key, commercial use allowed; attribution required (shown by MapLibre's control). */
const STYLE_URL = "https://tiles.openfreemap.org/styles/positron";

interface Props {
  initialCamera: Camera;
  subscribe: (listener: SnapshotListener) => () => void;
  /** `?trucks=off`: the map without the truck layer, so the layer's own cost can be measured by difference. */
  showTrucks: boolean;
}

/**
 * The base map, and the **baseline** truck layer.
 *
 * Trucks are drawn here the stock way: a GeoJSON source and a circle layer,
 * refreshed with `setData` twice a second. It works, and it exists to be
 * measured. Layer 7 replaces it with a WebGL layer that interpolates on the GPU
 * every frame, and has to beat these numbers.
 */
export default function LiveMap({ initialCamera, subscribe, showTrucks }: Props) {
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
      if (!showTrucks) return;
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
  }, [subscribe, showTrucks]);

  // MapLibre adds `.maplibregl-map { position: relative }` to its container, which
  // overrode `absolute inset-0` and collapsed it to 0 px tall: a blank map with a
  // working status bar. The wrapper owns the positioning; MapLibre's div just fills it.
  return (
    <div className="absolute inset-0">
      <div ref={container} className="h-full w-full" role="region" aria-label="Map of the fleet" />
    </div>
  );
}

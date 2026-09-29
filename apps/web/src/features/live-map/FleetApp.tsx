"use client";

import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { useMemo } from "react";
import { DEFAULT_CAMERA, parseCamera } from "@/lib/camera-url";
import { configFromSearch } from "@/lib/worker-messages";
import { PerfHud } from "./PerfHud";
import { StatusBar } from "./StatusBar";
import type { TruckLayerKind } from "./LiveMap";
import { useFleet } from "./use-fleet";

// MapLibre needs `window` and WebGL, so the map is client-only. The page shell
// still renders on the server; only this component waits for the browser.
const LiveMap = dynamic(() => import("./LiveMap"), {
  ssr: false,
  loading: () => <div className="absolute inset-0 animate-pulse bg-zinc-100" aria-hidden />,
});

export function FleetApp() {
  const params = useSearchParams();
  // Read once: afterwards the map owns the camera and writes it back to the URL itself.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const initialCamera = useMemo(() => parseCamera(params.get("c")) ?? DEFAULT_CAMERA, []);
  const config = useMemo(() => configFromSearch(new URLSearchParams(params.toString())), [params]);
  const { status, error, subscribe, gpu } = useFleet(config);
  const layer: TruckLayerKind = params.get("trucks") === "off" ? "off" : params.get("layer") === "baseline" ? "baseline" : "gl";

  return (
    <div className="flex h-dvh flex-col">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-200 bg-white px-4 py-2">
        <h1 className="text-base font-semibold">Fleet Live</h1>
        <StatusBar status={status} error={error} subscribe={subscribe} />
      </header>
      <main className="relative flex-1">
        <LiveMap initialCamera={initialCamera} subscribe={subscribe} gpu={gpu} layer={layer} />
        {params.get("hud") === "1" && <PerfHud gpu={gpu} />}
      </main>
    </div>
  );
}

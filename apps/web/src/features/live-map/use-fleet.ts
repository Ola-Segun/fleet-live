"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { VehicleInfo } from "@fleet/sim";
import type { AlertsMessage, FleetSnapshot, RowsMessage, WorkerToMain } from "@fleet/transport";
import { FleetGpuState } from "@/lib/gpu-state";
import type { FleetConfig, MainToWorker } from "@/lib/worker-messages";

export type FleetStatus = Extract<WorkerToMain, { type: "status" }>;
export type SnapshotListener = (snapshot: FleetSnapshot) => void;
export type RowsListener = (rows: RowsMessage, receivedAt: number) => void;

/**
 * Owns the fleet Worker for as long as the component is mounted.
 *
 * **Snapshots never enter React state.** They arrive twice a second with every
 * truck in them. Putting them in state would re-render whatever reads them,
 * 5,000 trucks at a time. Instead they go into a ref, and consumers that need
 * them (the map) `subscribe` and do their own imperative update. Only the small
 * status report is state, because the status bar genuinely renders it.
 */
export function useFleet(config: FleetConfig, enabled = true) {
  const [status, setStatus] = useState<FleetStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Plate and driver by vehicle id. Arrives once; the map works with ids until then.
  const [vehicles, setVehicles] = useState<ReadonlyMap<number, VehicleInfo>>(() => new Map());
  // Alerts are React state: a few hundred at most, changing at most twice a second, and rendered as a list.
  const [alerts, setAlerts] = useState<AlertsMessage | null>(null);
  const workerRef = useRef<Worker | null>(null);
  // Sent before the Worker exists (zones load from storage on the first render): queued, then flushed.
  const pending = useRef<MainToWorker[]>([]);
  // The zone list is state the Worker must always have: replayed to every new Worker (a new seed or mode starts one).
  const zones = useRef<MainToWorker | null>(null);
  const latest = useRef<FleetSnapshot | null>(null);
  const listeners = useRef(new Set<SnapshotListener>());
  const rowsListeners = useRef(new Set<RowsListener>());
  // Created once, fed from the first message: see FleetGpuState for why the layer doesn't own it.
  const [gpu] = useState(() => new FleetGpuState());
  const key = JSON.stringify(config);

  useEffect(() => {
    if (!enabled) return;
    const worker = new Worker(new URL("../../workers/fleet.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (event: MessageEvent<WorkerToMain>) => {
      const message = event.data;
      if (message.type === "rows") {
        // 10 Hz, straight to the truck layer. Never through React.
        const receivedAt = performance.now();
        gpu.apply(message, receivedAt);
        for (const listener of rowsListeners.current) listener(message, receivedAt);
      } else if (message.type === "snapshot") {
        latest.current = message.snapshot;
        for (const listener of listeners.current) listener(message.snapshot);
      } else if (message.type === "vehicles") {
        setVehicles(new Map(message.vehicles.map((v) => [v.id, v])));
      } else if (message.type === "alerts") {
        setAlerts(message);
      } else if (message.type === "error") {
        setError(message.message);
      } else {
        setStatus(message);
      }
    };
    worker.onerror = (event) => setError(event.message || "The fleet worker failed to start.");
    const start: MainToWorker = { type: "start", ...(JSON.parse(key) as FleetConfig) };
    worker.postMessage(start);
    if (zones.current) worker.postMessage(zones.current);
    for (const message of pending.current) if (message.type !== "zones") worker.postMessage(message);
    pending.current = [];
    workerRef.current = worker;
    return () => {
      workerRef.current = null;
      worker.postMessage({ type: "stop" } satisfies MainToWorker);
      worker.terminate();
    };
  }, [enabled, key, gpu]);

  const subscribe = useCallback((listener: SnapshotListener) => {
    listeners.current.add(listener);
    if (latest.current) listener(latest.current);
    return () => {
      listeners.current.delete(listener);
    };
  }, []);

  const subscribeRows = useCallback((listener: RowsListener) => {
    rowsListeners.current.add(listener);
    return () => {
      rowsListeners.current.delete(listener);
    };
  }, []);

  const send = useCallback((message: MainToWorker) => {
    if (message.type === "zones") zones.current = message;
    if (workerRef.current) workerRef.current.postMessage(message);
    else pending.current.push(message);
  }, []);

  return { status, error, subscribe, subscribeRows, gpu, vehicles, alerts, send };
}

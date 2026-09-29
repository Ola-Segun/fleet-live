"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { FleetSnapshot, WorkerToMain } from "@fleet/transport";
import type { FleetConfig, MainToWorker } from "@/lib/worker-messages";

export type FleetStatus = Extract<WorkerToMain, { type: "status" }>;
export type SnapshotListener = (snapshot: FleetSnapshot) => void;

/**
 * Owns the fleet Worker for as long as the component is mounted.
 *
 * **Snapshots never enter React state.** They arrive twice a second with every
 * truck in them. Putting them in state would re-render whatever reads them,
 * 5,000 trucks at a time. Instead they go into a ref, and consumers that need
 * them (the map) `subscribe` and do their own imperative update. Only the small
 * status report is state, because the status bar genuinely renders it.
 */
export function useFleet(config: FleetConfig) {
  const [status, setStatus] = useState<FleetStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef<FleetSnapshot | null>(null);
  const listeners = useRef(new Set<SnapshotListener>());
  const key = JSON.stringify(config);

  useEffect(() => {
    const worker = new Worker(new URL("../../workers/fleet.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (event: MessageEvent<WorkerToMain>) => {
      const message = event.data;
      if (message.type === "snapshot") {
        latest.current = message.snapshot;
        for (const listener of listeners.current) listener(message.snapshot);
      } else {
        setStatus(message);
      }
    };
    worker.onerror = (event) => setError(event.message || "The fleet worker failed to start.");
    const start: MainToWorker = { type: "start", ...(JSON.parse(key) as FleetConfig) };
    worker.postMessage(start);
    return () => {
      worker.postMessage({ type: "stop" } satisfies MainToWorker);
      worker.terminate();
    };
  }, [key]);

  const subscribe = useCallback((listener: SnapshotListener) => {
    listeners.current.add(listener);
    if (latest.current) listener(latest.current);
    return () => {
      listeners.current.delete(listener);
    };
  }, []);

  return { status, error, subscribe };
}

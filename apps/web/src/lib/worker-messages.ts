import type { ZoneSpec } from "@fleet/alerts";
import type { ReplayRequest, WorkerToMain } from "@fleet/transport";

/** Where the fleet comes from: the simulator in the Worker, or the socket server. */
export type FleetConfig =
  /** `startMinute`: minutes after midnight, Lagos time, to start the simulated day at; absent means now. */
  | { mode: "demo"; seed: string; vehicleCount: number; startMinute?: number }
  | { mode: "network"; url: string };

/**
 * Messages from the page to the fleet Worker. The start message is built from
 * the config by intersection, not `Omit`: `Omit` over a union isn't
 * distributive, and silently collapses it to the fields both variants share.
 */
export type MainToWorker =
  | ({ type: "start" } & FleetConfig)
  | { type: "stop" }
  /** The whole zone list, whenever it changes. Kept by the Worker across restarts. */
  | { type: "zones"; zones: ZoneSpec[] }
  | { type: "alert"; action: "acknowledge" | "resolve"; id: number }
  | { type: "alert"; action: "resolve-cleared" }
  /** Enter, move or change replay. */
  | ({ type: "replay" } & ReplayRequest)
  | { type: "live" };

export type { WorkerToMain };

const MAX_VEHICLES = 20_000;

/**
 * Reads the fleet configuration from the URL:
 *   (nothing)                                  demo mode, 5,000 trucks
 *   ?n=20000&seed=abc                          demo mode, stress size, another fleet
 *   ?at=2230                                   demo mode, starting at 22:30 Lagos time (light traffic, so speeding)
 *   ?mode=network&ws=ws://127.0.0.1:8787/stream network mode against the sim server
 * Untrusted input: a bad value falls back to the default, never to a broken app.
 */
export function configFromSearch(params: URLSearchParams): FleetConfig {
  if (params.get("mode") === "network") {
    const url = params.get("ws") ?? "ws://127.0.0.1:8787/stream";
    if (/^wss?:\/\//.test(url)) return { mode: "network", url };
  }
  const n = Number(params.get("n"));
  const vehicleCount = Number.isInteger(n) && n > 0 && n <= MAX_VEHICLES ? n : 5000;
  const config: FleetConfig = { mode: "demo", seed: params.get("seed") || "fleet-live", vehicleCount };
  const at = /^([01]\d|2[0-3])([0-5]\d)$/.exec(params.get("at") ?? "");
  if (at) config.startMinute = Number(at[1]) * 60 + Number(at[2]);
  return config;
}

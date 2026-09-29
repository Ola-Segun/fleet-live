import type { WorkerToMain } from "@fleet/transport";

/** Where the fleet comes from: the simulator in the Worker, or the socket server. */
export type FleetConfig =
  | { mode: "demo"; seed: string; vehicleCount: number }
  | { mode: "network"; url: string };

/**
 * Messages from the page to the fleet Worker. The start message is built from
 * the config by intersection, not `Omit`: `Omit` over a union isn't
 * distributive, and silently collapses it to the fields both variants share.
 */
export type MainToWorker = ({ type: "start" } & FleetConfig) | { type: "stop" };

export type { WorkerToMain };

const MAX_VEHICLES = 20_000;

/**
 * Reads the fleet configuration from the URL:
 *   (nothing)                                  demo mode, 5,000 trucks
 *   ?n=20000&seed=abc                          demo mode, stress size, another fleet
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
  return { mode: "demo", seed: params.get("seed") || "fleet-live", vehicleCount };
}

import type { FleetConfig } from "./worker-messages";

export type DemoConfig = Extract<FleetConfig, { mode: "demo" }>;

export const DEFAULT_DEMO_CONFIG: DemoConfig = {
  mode: "demo",
  seed: "fleet-live",
  vehicleCount: 5000,
};

export const MAX_VEHICLES = 20_000;
export const MIN_VEHICLES = 1;
export const MAX_SEED_LENGTH = 64;

const STORAGE_KEY = "fleet-live:simulation";

export function hasSimulationOverrides(params: URLSearchParams): boolean {
  return params.has("mode") || params.has("n") || params.has("seed") || params.has("at");
}

export function demoConfigHref(config: DemoConfig, base?: string | URL): string {
  const url = new URL(base ?? "/app", "http://fleet-live.local");
  url.pathname = "/app";
  url.searchParams.set("n", String(config.vehicleCount));
  url.searchParams.set("seed", config.seed);
  if (config.startMinute !== undefined) {
    const hours = Math.floor(config.startMinute / 60).toString().padStart(2, "0");
    const minutes = (config.startMinute % 60).toString().padStart(2, "0");
    url.searchParams.set("at", `${hours}${minutes}`);
  } else {
    url.searchParams.delete("at");
  }
  url.searchParams.delete("mode");
  url.searchParams.delete("ws");
  return `${url.pathname}${url.search}${url.hash}`;
}

export function decodeDemoConfig(raw: string | null): DemoConfig | null {
  if (!raw) return null;

  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null) return null;
    const config = value as Partial<DemoConfig>;
    if (
      config.mode !== "demo" ||
      typeof config.vehicleCount !== "number" ||
      !Number.isInteger(config.vehicleCount) ||
      (config.vehicleCount ?? 0) < MIN_VEHICLES ||
      (config.vehicleCount ?? MAX_VEHICLES + 1) > MAX_VEHICLES ||
      typeof config.seed !== "string" ||
      config.seed.trim().length === 0 ||
      config.seed.length > MAX_SEED_LENGTH ||
      (config.startMinute !== undefined &&
        (!Number.isInteger(config.startMinute) || config.startMinute < 0 || config.startMinute >= 1440))
    ) {
      return null;
    }

    return {
      mode: "demo",
      seed: config.seed.trim(),
      vehicleCount: config.vehicleCount,
      ...(config.startMinute === undefined ? {} : { startMinute: config.startMinute }),
    };
  } catch {
    return null;
  }
}

export function readDemoConfig(): { config: DemoConfig | null; available: boolean } {
  try {
    return { config: decodeDemoConfig(window.localStorage.getItem(STORAGE_KEY)), available: true };
  } catch {
    return { config: null, available: false };
  }
}

export function saveDemoConfig(config: DemoConfig): boolean {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
    return true;
  } catch {
    return false;
  }
}

import type { LatLon } from "@fleet/routes";

/*
 * OSRM's durations are free-flow car speeds (Layer 2 measured a median average
 * of 70 km/h). Lagos trucks don't move like that. This module is the layer of
 * assumptions that turns free-flow into believable: a truck's own cap, the time
 * of day, and places that are slow whatever the hour.
 *
 * Every number here is an assumption chosen to look plausible. None is measured
 * traffic data, and the README must say so.
 */

/** Lagos is UTC+1 all year (West Africa Time, no daylight saving). */
export const LAGOS_UTC_OFFSET_HOURS = 1;

/** A laden truck's practical cap, even on an empty expressway. */
export const TRUCK_MAX_SPEED_MS = 55 / 3.6;

export function lagosHour(epochMs: number): number {
  const hours = epochMs / 3_600_000 + LAGOS_UTC_OFFSET_HOURS;
  return ((hours % 24) + 24) % 24;
}

/*
 * Share of free-flow speed by Lagos hour, interpolated linearly. Two peaks:
 * the morning inbound crawl and a longer evening one.
 */
const DAY_CURVE: readonly [hour: number, factor: number][] = [
  [0, 1.0],
  [5, 0.95],
  [6.5, 0.6],
  [8, 0.35],
  [10, 0.55],
  [12, 0.6],
  [15, 0.55],
  [17.5, 0.3],
  [20, 0.5],
  [22, 0.85],
  [24, 1.0],
];

export function timeOfDayFactor(hour: number): number {
  for (let i = 1; i < DAY_CURVE.length; i++) {
    const [h1, f1] = DAY_CURVE[i]!;
    if (hour <= h1) {
      const [h0, f0] = DAY_CURVE[i - 1]!;
      return f0 + ((f1 - f0) * (hour - h0)) / (h1 - h0);
    }
  }
  return 1;
}

export interface CongestionZone {
  name: string;
  center: LatLon;
  radiusM: number;
  /** Multiplier on speed inside the zone, at any hour. */
  factor: number;
  /** Stop-and-go: trucks halt and creep rather than roll slowly. */
  stopAndGo: boolean;
}

export const CONGESTION_ZONES: readonly CongestionZone[] = [
  // The port access roads, where trucks queue for days to reach the terminals.
  { name: "Apapa go-slow", center: [6.445, 3.355], radiusM: 3500, factor: 0.15, stopAndGo: true },
  { name: "Oshodi", center: [6.555, 3.343], radiusM: 1500, factor: 0.5, stopAndGo: false },
  { name: "Ojota–Mile 12", center: [6.6, 3.39], radiusM: 1800, factor: 0.5, stopAndGo: false },
  { name: "Berger", center: [6.64, 3.369], radiusM: 1200, factor: 0.55, stopAndGo: false },
];

const METRES_PER_DEG = 111_195.08;

/**
 * True if `p` is within `radiusM` of `center`. A flat (equirectangular)
 * distance, compared squared: across a few kilometres at 6.5° N it differs
 * from the great-circle distance by far less than 0.1%, and it runs every
 * step for every truck, where haversine's inverse trig was a measured cost.
 */
export function withinRadius(p: LatLon, center: LatLon, radiusM: number): boolean {
  const dy = (p[0] - center[0]) * METRES_PER_DEG;
  const dx = (p[1] - center[1]) * METRES_PER_DEG * Math.cos((center[0] * Math.PI) / 180);
  return dx * dx + dy * dy <= radiusM * radiusM;
}

export function zoneAt(position: LatLon): CongestionZone | undefined {
  let slowest: CongestionZone | undefined;
  for (const zone of CONGESTION_ZONES) {
    if (withinRadius(position, zone.center, zone.radiusM) && (!slowest || zone.factor < slowest.factor)) {
      slowest = zone;
    }
  }
  return slowest;
}

/**
 * The speed a truck is trying to reach. Actual speed chases it under
 * acceleration limits, so this can change sharply without the truck jumping.
 */
export function targetSpeed(
  freeFlowMs: number,
  epochMs: number,
  zone: CongestionZone | undefined,
  driverFactor: number,
  capMs: number = TRUCK_MAX_SPEED_MS,
): number {
  const wanted = freeFlowMs * timeOfDayFactor(lagosHour(epochMs)) * (zone?.factor ?? 1) * driverFactor;
  // The cap applies last, so a heavy-footed driver (factor > 1) still can't exceed it.
  return Math.min(wanted, capMs);
}

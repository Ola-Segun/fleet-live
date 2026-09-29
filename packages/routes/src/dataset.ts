import { decodePolyline } from "./polyline";
import type { LatLon } from "./geo";
import type { Place } from "./places";

export interface RouteRecord {
  /** `<from>__<to>` */
  id: string;
  from: string;
  to: string;
  /** Metres, as OSRM reported it for the full-detail geometry. */
  distance: number;
  /** Seconds, the sum of `durations`. */
  duration: number;
  /** Simplified geometry, polyline6. */
  geometry: string;
  /** Per-segment driving time in deciseconds (0.1 s), integers. */
  durations: number[];
}

export interface RouteDataset {
  attribution: string;
  license: string;
  source: string;
  simplifyToleranceM: number;
  places: Place[];
  routes: RouteRecord[];
}

/** Lagos metro with the Ogun-border estates, Badagry and Lekki Port: roughly 2.8–4.1°E, 6.3–6.8°N. */
export const LAGOS_BOUNDS = { minLat: 6.3, maxLat: 6.8, minLon: 2.8, maxLon: 4.1 } as const;

/** Faster than this and a route has a bad segment, not a fast truck. */
export const MAX_PLAUSIBLE_KMH = 130;

export interface DecodedRoute extends RouteRecord {
  points: LatLon[];
}

/**
 * Checks a dataset the way a consumer would rely on it, and returns every
 * problem rather than stopping at the first. Run by the generator before it
 * writes, and by the test suite against the committed file.
 */
export function validateDataset(dataset: RouteDataset): string[] {
  const problems: string[] = [];
  const placeIds = new Set(dataset.places.map((p) => p.id));
  const routeIds = new Set<string>();

  for (const place of dataset.places) {
    const at: unknown = place.at;
    const valid =
      Array.isArray(at) &&
      at.length === 2 &&
      at.every((n) => typeof n === "number" && Number.isFinite(n)) &&
      at[0] >= LAGOS_BOUNDS.minLat && at[0] <= LAGOS_BOUNDS.maxLat &&
      at[1] >= LAGOS_BOUNDS.minLon && at[1] <= LAGOS_BOUNDS.maxLon;
    if (!valid) problems.push(`place ${place.id}: "at" must be [lat, lon] inside Lagos`);
  }

  for (const route of dataset.routes) {
    const where = `route ${route.id}`;
    if (routeIds.has(route.id)) problems.push(`${where}: duplicate id`);
    routeIds.add(route.id);
    if (!placeIds.has(route.from) || !placeIds.has(route.to)) problems.push(`${where}: unknown place`);

    let points: LatLon[];
    try {
      points = decodePolyline(route.geometry);
    } catch (error) {
      problems.push(`${where}: geometry does not decode (${(error as Error).message})`);
      continue;
    }
    if (points.length < 2) problems.push(`${where}: fewer than 2 points`);
    if (route.durations.length !== points.length - 1) {
      problems.push(`${where}: ${points.length} points but ${route.durations.length} durations`);
    }
    if (!route.durations.every((d) => Number.isInteger(d) && d >= 0)) {
      problems.push(`${where}: durations must be non-negative integer deciseconds`);
    }
    const total = route.durations.reduce((a, b) => a + b, 0) / 10;
    if (Math.abs(total - route.duration) > 0.05 * route.durations.length + 0.1) {
      problems.push(`${where}: durations sum to ${total} s, duration says ${route.duration} s`);
    }
    const outside = points.find(
      ([lat, lon]) =>
        lat < LAGOS_BOUNDS.minLat || lat > LAGOS_BOUNDS.maxLat || lon < LAGOS_BOUNDS.minLon || lon > LAGOS_BOUNDS.maxLon,
    );
    if (outside) problems.push(`${where}: point ${outside.join(",")} is outside Lagos`);
    const kmh = route.distance / 1000 / (route.duration / 3600);
    if (!(route.distance > 0 && route.duration > 0) || kmh > MAX_PLAUSIBLE_KMH) {
      problems.push(`${where}: implausible ${route.distance} m in ${route.duration} s`);
    }
  }
  return problems;
}

/**
 * The typed way in. A JSON import widens `[lat, lon]` to `number[]`, so the
 * compiler cannot vouch for the file's shape and a cast would only silence it.
 * This checks the shape at runtime and returns the typed dataset, or throws
 * with every problem listed.
 */
export function parseDataset(json: unknown): RouteDataset {
  const d = json as Partial<RouteDataset> | null;
  if (!d || typeof d !== "object" || !Array.isArray(d.places) || !Array.isArray(d.routes)) {
    throw new TypeError("route dataset must be an object with places[] and routes[]");
  }
  const problems = validateDataset(d as RouteDataset);
  if (problems.length > 0) throw new TypeError(`invalid route dataset:\n  ${problems.join("\n  ")}`);
  return d as RouteDataset;
}

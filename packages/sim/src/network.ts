import type { LatLon, RouteDataset } from "@fleet/routes";
import { decodePolyline, haversine } from "@fleet/routes";

/**
 * A route prepared for driving: coordinates and cumulative distances in typed
 * arrays, shared by every truck on it. A truck is then just a route and a
 * distance along it, so 5,000 trucks cost 5,000 small objects, not 5,000
 * copies of the geometry.
 */
export interface RoutePath {
  id: string;
  from: string;
  to: string;
  lat: Float64Array;
  lon: Float64Array;
  /** Metres from the start to each point. `cum[0]` is 0. */
  cum: Float64Array;
  /** Free-flow speed per segment, m/s, from OSRM's per-segment durations. */
  freeFlow: Float32Array;
  /**
   * Bearing of each segment, computed once here. It only changes when a truck
   * enters a new segment, so recomputing the trigonometry every step was waste.
   */
  heading: Float32Array;
  length: number;
}

export interface RoadNetwork {
  paths: RoutePath[];
  /** Routes leaving each place. Directed, so every entry starts where the truck is. */
  outgoing: ReadonlyMap<string, RoutePath[]>;
  places: RouteDataset["places"];
}

/** Used only if a segment has zero recorded duration, which OSRM can round to. */
const FALLBACK_FREE_FLOW_MS = 25;

export function buildNetwork(dataset: RouteDataset): RoadNetwork {
  const outgoing = new Map<string, RoutePath[]>();
  const paths = dataset.routes.map((route): RoutePath => {
    const points = decodePolyline(route.geometry);
    const n = points.length;
    const lat = new Float64Array(n);
    const lon = new Float64Array(n);
    const cum = new Float64Array(n);
    const freeFlow = new Float32Array(n - 1);
    const heading = new Float32Array(n - 1);
    points.forEach(([la, lo], i) => {
      lat[i] = la;
      lon[i] = lo;
      if (i > 0) {
        const segment = haversine(points[i - 1]!, points[i]!);
        cum[i] = cum[i - 1]! + segment;
        const seconds = route.durations[i - 1]! / 10;
        freeFlow[i - 1] = seconds > 0 ? segment / seconds : FALLBACK_FREE_FLOW_MS;
        heading[i - 1] = bearing(points[i - 1]!, points[i]!);
      }
    });
    const path = { id: route.id, from: route.from, to: route.to, lat, lon, cum, freeFlow, heading, length: cum[n - 1]! };
    const list = outgoing.get(route.from) ?? [];
    list.push(path);
    outgoing.set(route.from, list);
    return path;
  });
  return { paths, outgoing, places: dataset.places };
}

/** Initial bearing from a to b, degrees clockwise from north, in [0, 360). */
export function bearing(a: LatLon, b: LatLon): number {
  const rad = Math.PI / 180;
  const φ1 = a[0] * rad;
  const φ2 = b[0] * rad;
  const Δλ = (b[1] - a[1]) * rad;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return ((Math.atan2(y, x) / rad) % 360 + 360) % 360;
}

/** Index of the segment containing distance `s` (binary search over `cum`). */
export function segmentAt(path: RoutePath, s: number): number {
  let lo = 0;
  let hi = path.cum.length - 2;
  if (s <= 0) return 0;
  if (s >= path.length) return hi;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (path.cum[mid]! <= s) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

export interface PathPosition {
  lat: number;
  lon: number;
  heading: number;
  segment: number;
}

/**
 * Position `s` metres along the path, interpolating linearly in degrees.
 * Simplification leaves some straight segments kilometres long, and over those
 * a straight line in degrees and the true shortest path drift apart by
 * centimetres, not metres, this close to the equator. The geometry itself was
 * simplified with a 1.5 m tolerance, so this is not the limiting error.
 */
export function positionAt(path: RoutePath, s: number): PathPosition {
  const i = segmentAt(path, s);
  const start = path.cum[i]!;
  const span = path.cum[i + 1]! - start;
  const t = span > 0 ? Math.min(1, Math.max(0, (s - start) / span)) : 0;
  const lat0 = path.lat[i]!;
  const lon0 = path.lon[i]!;
  return {
    lat: lat0 + (path.lat[i + 1]! - lat0) * t,
    lon: lon0 + (path.lon[i + 1]! - lon0) * t,
    heading: path.heading[i]!,
    segment: i,
  };
}

import { distanceToSegment, toLocalMetres, type LatLon } from "./geo";

export interface TimedPath {
  points: LatLon[];
  /** Seconds to drive each segment: `durations[i]` is points[i] → points[i + 1]. */
  durations: number[];
}

/**
 * Ramer–Douglas–Peucker: drop points that sit within `toleranceM` metres of
 * the line through their neighbours. OSRM's full geometry has a vertex at every
 * bend in the OSM way, and many are redundant at the scale a truck is drawn.
 *
 * The one addition to the textbook version is that segment durations are
 * carried along: when points are dropped, the durations of the segments they
 * joined are summed. Total driving time is therefore conserved exactly, and a
 * slow stretch stays slow even after its shape is simplified.
 *
 * Iterative, not recursive, so a 20,000-point route can't overflow the stack.
 */
export function simplifyTimedPath(path: TimedPath, toleranceM: number): TimedPath {
  const { points, durations } = path;
  if (durations.length !== points.length - 1) {
    throw new RangeError(`${points.length} points need ${points.length - 1} durations, got ${durations.length}`);
  }
  if (points.length <= 2) return { points: [...points], durations: [...durations] };

  const origin = points[0]!;
  const flat = points.map((p) => toLocalMetres(origin, p));
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;

  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [first, last] = stack.pop()!;
    let farthest = -1;
    let farthestDistance = 0;
    for (let i = first + 1; i < last; i++) {
      const d = distanceToSegment(flat[i]!, flat[first]!, flat[last]!);
      if (d > farthestDistance) {
        farthest = i;
        farthestDistance = d;
      }
    }
    if (farthest !== -1 && farthestDistance > toleranceM) {
      keep[farthest] = 1;
      stack.push([first, farthest], [farthest, last]);
    }
  }

  const outPoints: LatLon[] = [];
  const outDurations: number[] = [];
  let pending = 0;
  for (let i = 0; i < points.length; i++) {
    if (i > 0) pending += durations[i - 1]!;
    if (keep[i]) {
      if (i > 0) {
        outDurations.push(pending);
        pending = 0;
      }
      outPoints.push(points[i]!);
    }
  }
  return { points: outPoints, durations: outDurations };
}

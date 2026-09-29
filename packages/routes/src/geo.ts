/** [lat, lon] in degrees. Latitude first, as OSRM's polyline encoding orders it. */
export type LatLon = readonly [lat: number, lon: number];

/** IUGG mean Earth radius, metres. */
export const EARTH_RADIUS_M = 6_371_008.8;

const RAD = Math.PI / 180;

/** Great-circle distance in metres. */
export function haversine(a: LatLon, b: LatLon): number {
  const dLat = (b[0] - a[0]) * RAD;
  const dLon = (b[1] - a[1]) * RAD;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * RAD) * Math.cos(b[0] * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Flat x/y metres around an origin (equirectangular). Across a metro area the
 * size of Lagos the error is a small fraction of a percent, which is plenty
 * for deciding whether a point is within a metre or two of a line.
 */
export function toLocalMetres(origin: LatLon, p: LatLon): [x: number, y: number] {
  return [
    (p[1] - origin[1]) * RAD * EARTH_RADIUS_M * Math.cos(origin[0] * RAD),
    (p[0] - origin[0]) * RAD * EARTH_RADIUS_M,
  ];
}

/** Distance in metres from p to the segment a–b, all in the same flat frame. */
export function distanceToSegment(p: [number, number], a: [number, number], b: [number, number]): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lengthSq = dx * dx + dy * dy;
  const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / lengthSq));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

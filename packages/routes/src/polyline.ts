import type { LatLon } from "./geo";

/*
 * Google's encoded polyline format, which OSRM returns. Each coordinate is the
 * delta from the previous one, scaled to an integer, zig-zag encoded so the
 * sign lives in the lowest bit, then split into 5-bit chunks offset by 63 into
 * printable ASCII. OSRM's `polyline6` uses a scale of 1e6 rather than 1e5.
 *
 * Integers are kept as `lat * factor` and deltas are taken between integers,
 * never between floats, so encode → decode → encode is exact.
 */

export function decodePolyline(encoded: string, precision = 6): LatLon[] {
  const factor = 10 ** precision;
  const points: LatLon[] = [];
  let index = 0;
  let lat = 0;
  let lon = 0;

  const next = (): number => {
    let result = 0;
    let shift = 0;
    let byte: number;
    do {
      if (index >= encoded.length) throw new SyntaxError("polyline ends mid-value");
      byte = encoded.charCodeAt(index++) - 63;
      if (byte < 0 || byte > 63) throw new SyntaxError(`invalid polyline character at ${index - 1}`);
      // Multiply rather than `<<`: a 5-bit chunk shifted past bit 31 would overflow an int32.
      result += (byte & 0x1f) * 2 ** shift;
      shift += 5;
    } while (byte >= 0x20);
    // Zig-zag: an odd value is negative.
    return result % 2 === 1 ? -(result + 1) / 2 : result / 2;
  };

  while (index < encoded.length) {
    lat += next();
    lon += next();
    points.push([lat / factor, lon / factor]);
  }
  return points;
}

export function encodePolyline(points: readonly LatLon[], precision = 6): string {
  const factor = 10 ** precision;
  let out = "";
  let prevLat = 0;
  let prevLon = 0;

  const write = (delta: number) => {
    let value = delta < 0 ? -delta * 2 - 1 : delta * 2;
    while (value >= 0x20) {
      out += String.fromCharCode(((value % 0x20) | 0x20) + 63);
      value = Math.floor(value / 0x20);
    }
    out += String.fromCharCode(value + 63);
  };

  for (const [latDeg, lonDeg] of points) {
    const lat = Math.round(latDeg * factor);
    const lon = Math.round(lonDeg * factor);
    write(lat - prevLat);
    write(lon - prevLon);
    prevLat = lat;
    prevLon = lon;
  }
  return out;
}

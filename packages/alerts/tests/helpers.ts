import { MODE_CODES, METRES_PER_DEG, type ModeName } from "@fleet/gl";
import type { FleetFrame, MultiPolygonCoords, ZoneSpec } from "../src";

export const LAT0 = 6.5;
export const LON0 = 3.4;
const KX = METRES_PER_DEG * Math.cos((LAT0 * Math.PI) / 180);

/** A point `east` and `north` metres from (6.5° N, 3.4° E). */
export function at(east: number, north: number): [lat: number, lon: number] {
  return [LAT0 + north / METRES_PER_DEG, LON0 + east / KX];
}

/** A square `side` metres wide, its south-west corner at the origin, as GeoJSON coordinates. */
export function square(side: number, x0 = 0, y0 = 0): MultiPolygonCoords {
  const corners = [
    at(x0, y0),
    at(x0 + side, y0),
    at(x0 + side, y0 + side),
    at(x0, y0 + side),
    at(x0, y0),
  ];
  return [[corners.map(([lat, lon]) => [lon, lat])]];
}

export function zone(id: string, coordinates: MultiPolygonCoords, overrides: Partial<ZoneSpec> = {}): ZoneSpec {
  return { id, name: id, kind: "restricted", alertOnEnter: true, alertOnExit: false, coordinates, ...overrides };
}

export interface TruckAt {
  id: number;
  east?: number;
  north?: number;
  kmh?: number;
  mode?: ModeName;
  ageMs?: number;
  /** Defaults to off when parked, on otherwise. */
  ignition?: boolean;
}

/** A fleet frame at time `t` (ms) from a few trucks described in metres. */
export function frame(t: number, trucks: readonly TruckAt[]): FleetFrame {
  const n = trucks.length;
  const f: FleetFrame = {
    displayTime: t,
    count: n,
    ids: new Uint32Array(n),
    lat: new Float64Array(n),
    lon: new Float64Array(n),
    speed: new Float32Array(n),
    mode: new Uint8Array(n),
    ageMs: new Float32Array(n),
    ignition: new Uint8Array(n),
  };
  trucks.forEach((truck, i) => {
    const [lat, lon] = at(truck.east ?? 0, truck.north ?? 0);
    f.ids[i] = truck.id;
    f.lat[i] = lat;
    f.lon[i] = lon;
    f.speed[i] = (truck.kmh ?? 30) / 3.6;
    f.mode[i] = MODE_CODES[truck.mode ?? "interpolated"];
    f.ageMs[i] = truck.ageMs ?? 500;
    f.ignition[i] = (truck.ignition ?? truck.mode !== "parked") ? 1 : 0;
  });
  return f;
}

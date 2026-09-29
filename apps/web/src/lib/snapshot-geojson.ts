import { MODES, type FleetSnapshot } from "@fleet/transport";

export interface VehicleFeature {
  type: "Feature";
  id: number;
  geometry: { type: "Point"; coordinates: [number, number] };
  properties: { mode: string; heading: number };
}

export interface VehicleCollection {
  type: "FeatureCollection";
  features: VehicleFeature[];
}

/**
 * The baseline: a snapshot as GeoJSON for a stock MapLibre circle layer.
 *
 * This is the naive way to draw the fleet, and it exists to be measured.
 * Every refresh builds 5,000 objects on the main thread, and MapLibre then
 * serialises them to its own worker and re-tiles them. Layer 7's WebGL layer
 * has to beat this number, not an assumption about it.
 */
export function snapshotToGeoJSON(s: FleetSnapshot): VehicleCollection {
  const features: VehicleFeature[] = new Array(s.count);
  for (let i = 0; i < s.count; i++) {
    features[i] = {
      type: "Feature",
      id: s.ids[i]!,
      geometry: { type: "Point", coordinates: [s.lon[i]!, s.lat[i]!] },
      properties: { mode: MODES[s.mode[i]!] ?? "waiting", heading: s.heading[i]! },
    };
  }
  return { type: "FeatureCollection", features };
}

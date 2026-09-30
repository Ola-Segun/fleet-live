import { METRES_PER_DEG } from "@fleet/gl";
import type { MultiPolygonCoords } from "./geometry";
import type { ZoneKind, ZoneSpec } from "./engine";

/** A zone as imported or drawn, before the page gives it an id. */
export type ZoneDraft = Omit<ZoneSpec, "id">;

export type ImportResult = { ok: true; zones: ZoneDraft[]; warnings: string[] } | { ok: false; errors: string[] };

/** Limits that keep one pasted file from stalling the Worker: 2 Hz × 5,000 trucks × every vertex adds up. */
export const IMPORT_LIMITS = { maxZones: 50, maxVerticesPerZone: 5_000, maxExtentM: 100_000, maxNameLength: 60 } as const;

export function defaultAlerts(kind: ZoneKind): { alertOnEnter: boolean; alertOnExit: boolean } {
  // A restricted area matters when a truck goes in. A depot is watched for trucks leaving it.
  return kind === "restricted" ? { alertOnEnter: true, alertOnExit: false } : { alertOnEnter: false, alertOnExit: true };
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Zones from GeoJSON (RFC 7946): a FeatureCollection, a Feature, or a bare
 * Polygon or MultiPolygon. Untrusted input: every failure is an error message
 * naming where in the file it is, never an exception.
 *
 * Read from each feature's properties when present: `name`, `kind`
 * ("restricted" or "depot"), `alertOnEnter`, `alertOnExit`.
 *
 * Lenient where it's harmless: an unclosed ring is closed (the RFC requires
 * closed rings, but many hand-written files forget), with a warning. Strict
 * where it isn't: coordinates must be real longitudes and latitudes, and a
 * zone can't be larger than 100 km, where the flat-plane geometry would stop
 * being accurate.
 */
export function parseZones(input: unknown): ImportResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const zones: ZoneDraft[] = [];

  let features: Array<{ where: string; geometry: unknown; properties: unknown }>;
  if (!isRecord(input)) return { ok: false, errors: ["Not a GeoJSON object."] };
  if (input.type === "FeatureCollection") {
    if (!Array.isArray(input.features)) return { ok: false, errors: ["FeatureCollection has no features array."] };
    features = input.features.map((f, i) => ({ where: `features[${i}]`, geometry: isRecord(f) ? f.geometry : undefined, properties: isRecord(f) ? f.properties : undefined }));
  } else if (input.type === "Feature") {
    features = [{ where: "feature", geometry: input.geometry, properties: input.properties }];
  } else if (input.type === "Polygon" || input.type === "MultiPolygon") {
    features = [{ where: "geometry", geometry: input, properties: undefined }];
  } else {
    return { ok: false, errors: [`Unsupported GeoJSON type ${JSON.stringify(input.type)}. Use a FeatureCollection, Feature, Polygon or MultiPolygon.`] };
  }
  if (features.length === 0) return { ok: false, errors: ["No features to import."] };
  if (features.length > IMPORT_LIMITS.maxZones) return { ok: false, errors: [`${features.length} features: at most ${IMPORT_LIMITS.maxZones} zones can be imported at once.`] };

  features.forEach(({ where, geometry, properties }, index) => {
    const props = isRecord(properties) ? properties : {};
    if (!isRecord(geometry)) {
      errors.push(`${where}: no geometry.`);
      return;
    }
    let polygons: unknown[];
    if (geometry.type === "Polygon") polygons = [geometry.coordinates];
    else if (geometry.type === "MultiPolygon" && Array.isArray(geometry.coordinates)) polygons = geometry.coordinates;
    else {
      errors.push(`${where}: ${JSON.stringify(geometry.type)} isn't an area. Only Polygon and MultiPolygon can be zones.`);
      return;
    }

    const coords: MultiPolygonCoords = [];
    let vertices = 0;
    let closedAny = false;
    const bad = polygons.some((polygon, p) => {
      const at = geometry.type === "Polygon" ? `${where}.geometry` : `${where}.geometry.coordinates[${p}]`;
      if (!Array.isArray(polygon) || polygon.length === 0) {
        errors.push(`${at}: a polygon needs at least one ring.`);
        return true;
      }
      const rings: number[][][] = [];
      for (let r = 0; r < polygon.length; r++) {
        const ring: unknown = polygon[r];
        const ringAt = `${at} ring ${r}`;
        if (!Array.isArray(ring)) {
          errors.push(`${ringAt}: not an array of positions.`);
          return true;
        }
        const points: number[][] = [];
        for (let k = 0; k < ring.length; k++) {
          const pos: unknown = ring[k];
          if (!Array.isArray(pos) || pos.length < 2 || typeof pos[0] !== "number" || typeof pos[1] !== "number" || !Number.isFinite(pos[0]) || !Number.isFinite(pos[1])) {
            errors.push(`${ringAt}, position ${k}: expected [longitude, latitude] numbers.`);
            return true;
          }
          const [lon, lat] = pos as [number, number];
          if (lon < -180 || lon > 180 || lat < -90 || lat > 90) {
            errors.push(`${ringAt}, position ${k}: [${lon}, ${lat}] isn't a longitude and latitude. (GeoJSON puts longitude first.)`);
            return true;
          }
          points.push([lon, lat]);
        }
        const first = points[0];
        const last = points.at(-1);
        if (first && last && (first[0] !== last[0] || first[1] !== last[1])) {
          points.push([first[0]!, first[1]!]);
          closedAny = true;
        }
        const distinct = new Set(points.map(([x, y]) => `${x},${y}`)).size;
        if (distinct < 3) {
          errors.push(`${ringAt}: a ring needs at least 3 different positions, found ${distinct}.`);
          return true;
        }
        vertices += points.length;
        rings.push(points);
      }
      coords.push(rings);
      return false;
    });
    if (bad) return;

    if (vertices > IMPORT_LIMITS.maxVerticesPerZone) {
      errors.push(`${where}: ${vertices} positions; a zone can have at most ${IMPORT_LIMITS.maxVerticesPerZone}. Simplify it first.`);
      return;
    }
    const extent = extentM(coords);
    if (extent > IMPORT_LIMITS.maxExtentM) {
      errors.push(`${where}: ${(extent / 1000).toFixed(0)} km across; zones can be at most ${IMPORT_LIMITS.maxExtentM / 1000} km.`);
      return;
    }
    if (closedAny) warnings.push(`${where}: a ring wasn't closed, so it was closed by repeating its first position.`);

    const kind: ZoneKind = props.kind === "depot" ? "depot" : "restricted";
    if (props.kind !== undefined && props.kind !== "depot" && props.kind !== "restricted") {
      warnings.push(`${where}: unknown kind ${JSON.stringify(props.kind)}, treated as "restricted".`);
    }
    const defaults = defaultAlerts(kind);
    const rawName = typeof props.name === "string" ? props.name.trim() : "";
    zones.push({
      name: rawName.slice(0, IMPORT_LIMITS.maxNameLength) || `Imported zone ${index + 1}`,
      kind,
      alertOnEnter: typeof props.alertOnEnter === "boolean" ? props.alertOnEnter : defaults.alertOnEnter,
      alertOnExit: typeof props.alertOnExit === "boolean" ? props.alertOnExit : defaults.alertOnExit,
      coordinates: coords,
    });
  });

  return errors.length > 0 ? { ok: false, errors } : { ok: true, zones, warnings };
}

/** The diagonal of the zone's bounding box, in metres. */
function extentM(coords: MultiPolygonCoords): number {
  let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
  for (const polygon of coords) for (const ring of polygon) for (const [lon, lat] of ring) {
    minLat = Math.min(minLat, lat!);
    maxLat = Math.max(maxLat, lat!);
    minLon = Math.min(minLon, lon!);
    maxLon = Math.max(maxLon, lon!);
  }
  const dy = (maxLat - minLat) * METRES_PER_DEG;
  const dx = (maxLon - minLon) * METRES_PER_DEG * Math.cos((((minLat + maxLat) / 2) * Math.PI) / 180);
  return Math.hypot(dx, dy);
}

/** Zones as a FeatureCollection: for the map, and for exporting what was drawn. */
export function zonesToGeoJSON(zones: readonly ZoneSpec[]) {
  return {
    type: "FeatureCollection" as const,
    features: zones.map((z) => ({
      type: "Feature" as const,
      id: z.id,
      properties: { id: z.id, name: z.name, kind: z.kind, alertOnEnter: z.alertOnEnter, alertOnExit: z.alertOnExit },
      geometry: { type: "MultiPolygon" as const, coordinates: z.coordinates },
    })),
  };
}

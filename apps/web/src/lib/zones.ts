"use client";

import { useSyncExternalStore } from "react";
import { PRESET_ZONES, parseZones, zonesToGeoJSON, type ZoneDraft, type ZoneSpec } from "@fleet/alerts";

/**
 * The dispatcher's zones, kept in browser storage as GeoJSON so they survive a
 * reload, and so the stored form is the same one the export button downloads.
 *
 * Why not IndexedDB, as the design said: zones are a few kilobytes of JSON,
 * written only when someone edits them. localStorage is synchronous, which is
 * what useSyncExternalStore needs, and IndexedDB's async API would add loading
 * states for no benefit at this size.
 *
 * Stored data is untrusted (another version of the app, a hand edit), so it is
 * read back through the same validating importer as a pasted file. If it
 * doesn't parse, the demo's preset zones are used instead.
 */
const KEY = "fleet-live:zones";
const CHANGED = "fleet-live:zones-changed";

export const PRESETS: readonly ZoneSpec[] = PRESET_ZONES.map(({ presetId, ...zone }) => ({ ...zone, id: presetId }));

/** Zones from their stored form. Anything missing or invalid gives the presets. */
export function decodeZones(raw: string | null): readonly ZoneSpec[] {
  if (raw === null) return PRESETS;
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return PRESETS;
  }
  // An empty list is a real choice (every zone deleted), not a reason to restore the presets.
  if (typeof json === "object" && json !== null && (json as { features?: unknown }).features instanceof Array && (json as { features: unknown[] }).features.length === 0) return [];
  const result = parseZones(json);
  if (!result.ok) return PRESETS;
  const features = (json as { features?: Array<{ properties?: { id?: unknown } }> }).features ?? [];
  const seen = new Set<string>();
  return result.zones.map((zone, i) => {
    const stored = features[i]?.properties?.id;
    const id = typeof stored === "string" && stored && !seen.has(stored) ? stored : newZoneId();
    seen.add(id);
    return { ...zone, id };
  });
}

export function encodeZones(zones: readonly ZoneSpec[]): string {
  return JSON.stringify(zonesToGeoJSON(zones));
}

let counter = 0;
export function newZoneId(): string {
  return `zone-${Date.now().toString(36)}-${(counter++).toString(36)}`;
}

/** This visit's zones when storage is unavailable, so editing still works. */
let memory: string | null = null;
let cache: { raw: string | null; zones: readonly ZoneSpec[] } = { raw: null, zones: PRESETS };

function readRaw(): string | null {
  try {
    return window.localStorage.getItem(KEY) ?? memory;
  } catch {
    return memory;
  }
}

/** The same array until the stored text changes: useSyncExternalStore needs a stable snapshot. */
function read(): readonly ZoneSpec[] {
  const raw = readRaw();
  if (raw !== cache.raw) cache = { raw, zones: decodeZones(raw) };
  return cache.zones;
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener("storage", onChange);
  window.addEventListener(CHANGED, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(CHANGED, onChange);
  };
}

export function useZones(): readonly ZoneSpec[] {
  return useSyncExternalStore(subscribe, read, () => PRESETS);
}

export function saveZones(zones: readonly ZoneSpec[]): void {
  const raw = encodeZones(zones);
  memory = raw;
  try {
    window.localStorage.setItem(KEY, raw);
  } catch {
    // Kept in `memory` for this visit.
  }
  window.dispatchEvent(new Event(CHANGED));
}

export function addZones(drafts: readonly ZoneDraft[]): ZoneSpec[] {
  const added = drafts.map((d) => ({ ...d, id: newZoneId() }));
  saveZones([...read(), ...added]);
  return added;
}

export function updateZone(id: string, patch: Partial<Omit<ZoneSpec, "id">>): void {
  saveZones(read().map((z) => (z.id === id ? { ...z, ...patch } : z)));
}

export function removeZone(id: string): void {
  saveZones(read().filter((z) => z.id !== id));
}

export function restorePresets(): void {
  saveZones(PRESETS);
}

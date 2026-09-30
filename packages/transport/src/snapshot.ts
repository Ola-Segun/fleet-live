import type { Feed } from "@fleet/feed";
import { MODE_CODES, MODES } from "@fleet/gl";

// One numbering for estimate modes, shared by the page's snapshot and the shader.
export { MODE_CODES, MODES };

/**
 * Every truck's estimated state at one display time, as parallel typed arrays.
 *
 * Why typed arrays and not 5,000 objects: `postMessage` can *transfer* an
 * ArrayBuffer to the main thread, which moves ownership in constant time. An
 * array of objects has to be structured-cloned field by field, and the
 * garbage it leaves is collected on the main thread, which is the thread that
 * paints.
 */
export interface FleetSnapshot {
  serverTime: number;
  displayTime: number;
  delayMs: number;
  count: number;
  ids: Uint32Array;
  lat: Float64Array;
  lon: Float64Array;
  heading: Float32Array;
  speed: Float32Array;
  mode: Uint8Array;
  ageMs: Float32Array;
  /** 1 if the truck's newest report had the ignition on. */
  ignition: Uint8Array;
}

export function buildSnapshot(feed: Feed): FleetSnapshot {
  const ids = [...feed.vehicleIds()].sort((a, b) => a - b);
  const n = ids.length;
  const display = feed.displayTime();
  const snap: FleetSnapshot = {
    serverTime: feed.serverTime,
    displayTime: display,
    delayMs: feed.delayMs,
    count: n,
    ids: Uint32Array.from(ids),
    lat: new Float64Array(n),
    lon: new Float64Array(n),
    heading: new Float32Array(n),
    speed: new Float32Array(n),
    mode: new Uint8Array(n),
    ageMs: new Float32Array(n),
    ignition: new Uint8Array(n),
  };
  ids.forEach((id, i) => {
    const e = feed.estimate(id, display);
    if (!e) return;
    snap.lat[i] = e.lat;
    snap.lon[i] = e.lon;
    snap.heading[i] = e.heading;
    snap.speed[i] = e.speed;
    snap.mode[i] = MODE_CODES[e.mode];
    snap.ageMs[i] = e.ageMs;
    snap.ignition[i] = e.ignition ? 1 : 0;
  });
  return snap;
}

/** The buffers to list as transferables, so posting the snapshot copies nothing. */
export function snapshotTransfer(s: FleetSnapshot): ArrayBuffer[] {
  return [s.ids, s.lat, s.lon, s.heading, s.speed, s.mode, s.ageMs, s.ignition].map((a) => a.buffer as ArrayBuffer);
}

import { MODE_CODES } from "@fleet/gl";
import { prepareZone, signedDistance, type MultiPolygonCoords, type PreparedZone } from "./geometry";
import { OFF, ON, debounced, grow, hold, step, type Debounced } from "./hysteresis";

export type ZoneKind = "restricted" | "depot";

export interface ZoneSpec {
  id: string;
  name: string;
  kind: ZoneKind;
  alertOnEnter: boolean;
  alertOnExit: boolean;
  coordinates: MultiPolygonCoords;
}

export interface AlertRules {
  /** How far past a zone's edge a truck must be before it counts as in or out. */
  marginM: number;
  /** How long it must stay past the margin. */
  dwellMs: number;
  /** A policy setting, not a law: the demo's default for laden trucks. */
  speedLimitKmh: number;
  /** Speeding ends only below this, so a truck hovering at the limit doesn't flap. */
  speedClearKmh: number;
  speedDwellMs: number;
  /** Silence before a truck whose last report had the ignition on counts as offline. */
  offlineMovingMs: number;
  /** With the ignition off, trackers report less often (every 30 s in the simulator, often far less on real devices). */
  offlineParkedMs: number;
  /** Beyond this many open alerts, the oldest already-cleared ones are resolved automatically. Active ones never are. */
  maxOpen: number;
}

export const DEFAULT_RULES: AlertRules = {
  marginM: 20,
  dwellMs: 10_000,
  speedLimitKmh: 60,
  speedClearKmh: 55,
  speedDwellMs: 10_000,
  offlineMovingMs: 120_000,
  offlineParkedMs: 600_000,
  maxOpen: 500,
};

export type AlertKind = "zone-enter" | "zone-exit" | "speeding" | "offline";

export interface Alert {
  id: number;
  kind: AlertKind;
  vehicleId: number;
  zoneId?: string;
  /** First raised, and most recently raised, in data time (epoch ms of the display clock). */
  raisedAt: number;
  lastRaisedAt: number;
  /** One open alert per truck, kind and zone: a repeat raises it again rather than adding a row. */
  occurrences: number;
  /** The condition still holds: still inside, still speeding, still silent. */
  active: boolean;
  clearedAt?: number;
  /** Speeding: the highest speed seen, whole km/h. Offline: when the last report was made (epoch ms). */
  detail: number;
  acknowledgedAt?: number;
}

/** What the engine reads each evaluation. A FleetSnapshot has these fields, so it passes as is. */
export interface FleetFrame {
  displayTime: number;
  count: number;
  ids: Uint32Array;
  lat: Float64Array;
  lon: Float64Array;
  speed: Float32Array;
  mode: Uint8Array;
  ageMs: Float32Array;
  /** 1 if the newest report had the ignition on: its tracker reports at the moving rate. */
  ignition: Uint8Array;
}

interface ZoneState {
  spec: ZoneSpec;
  geometryKey: string;
  prepared: PreparedZone;
  inside: Debounced;
  count: number;
}

export interface EngineStats {
  evaluations: number;
  raised: number;
  autoResolved: number;
}

const { waiting: WAITING, interpolated: INTERPOLATED, extrapolated: EXTRAPOLATED, parked: PARKED, stale: STALE } = MODE_CODES;

/**
 * Geofences, speeding and offline detection over the whole fleet.
 *
 * It runs in the Worker, on the same estimates the map draws (the display-time
 * positions, already smoothed and in order), twice a second. Evaluating
 * estimates rather than raw pings means the reorder and duplicate handling of
 * Layer 4 is done once, and an alert agrees with what the dispatcher sees.
 *
 * Per-truck state is in typed arrays indexed by a slot per vehicle id.
 */
export class AlertEngine {
  readonly stats: EngineStats = { evaluations: 0, raised: 0, autoResolved: 0 };
  private readonly slots = new Map<number, number>();
  private capacity = 0;
  private speeding = debounced(0);
  private offline = new Uint8Array(0);
  private zones = new Map<string, ZoneState>();
  private readonly open = new Map<string, Alert>();
  private readonly byId = new Map<number, Alert>();
  private nextId = 1;
  private raisedSinceDrain: Alert[] = [];
  private changed = false;
  private lastTime = 0;

  constructor(readonly rules: AlertRules = DEFAULT_RULES) {}

  /**
   * Replace the zone list. A zone whose id and shape are unchanged keeps its
   * state. A new or reshaped zone starts fresh, and trucks already inside it
   * don't count as entering.
   */
  setZones(specs: readonly ZoneSpec[]): void {
    const next = new Map<string, ZoneState>();
    for (const spec of specs) {
      const geometryKey = JSON.stringify(spec.coordinates);
      const old = this.zones.get(spec.id);
      if (old && old.geometryKey === geometryKey) {
        next.set(spec.id, { ...old, spec });
      } else {
        // Reach 2 × margin: beyond that a truck is definitely outside, and the bounding box rejects it.
        next.set(spec.id, { spec, geometryKey, prepared: prepareZone(spec.coordinates, this.rules.marginM * 2), inside: debounced(this.capacity), count: 0 });
      }
    }
    // A removed or reshaped zone's alerts can no longer clear by themselves: clear them now.
    for (const [id, old] of this.zones) {
      if (next.get(id)?.prepared === old.prepared) continue;
      for (const alert of this.open.values()) if (alert.zoneId === id && alert.active) this.clearAlert(alert, this.lastTime);
    }
    this.zones = next;
    this.changed = true;
  }

  /** Evaluate every truck in the frame. Returns whether the alert list or zone counts changed. */
  evaluate(frame: FleetFrame): boolean {
    const t = frame.displayTime;
    const r = this.rules;
    this.lastTime = t;
    this.stats.evaluations++;
    const zones = [...this.zones.values()];
    const counts = zones.map((z) => z.count);
    for (const z of zones) z.count = 0;

    for (let i = 0; i < frame.count; i++) {
      const id = frame.ids[i]!;
      let slot = this.slots.get(id);
      if (slot === undefined) {
        slot = this.slots.size;
        this.slots.set(id, slot);
        this.ensureCapacity(slot + 1);
      }
      const mode = frame.mode[i]!;
      if (mode === WAITING) continue;

      // Offline: silence longer than the truck's tracker should ever go. How often it reports depends
      // on the ignition, not on whether it's moving: judged by speed (the first version), a truck
      // stopped in traffic looked parked and got 10 minutes instead of 2. The evaluation found four.
      const age = frame.ageMs[i]!;
      const silent = age > (frame.ignition[i] ? r.offlineMovingMs : r.offlineParkedMs);
      if (silent && !this.offline[slot]) this.raise("offline", id, undefined, t, t - age);
      else if (!silent && this.offline[slot]) this.clear("offline", id, undefined, t);
      this.offline[slot] = silent ? 1 : 0;

      // Speeding, only on fresh data. A parked truck is by definition not speeding.
      if (mode === INTERPOLATED || mode === EXTRAPOLATED || mode === PARKED) {
        const kmh = mode === PARKED ? 0 : frame.speed[i]! * 3.6;
        const change = step(this.speeding, slot, t, kmh > r.speedLimitKmh, kmh <= r.speedClearKmh, r.speedDwellMs, false);
        if (change === ON) this.raise("speeding", id, undefined, t, Math.round(kmh));
        else if (change === OFF) this.clear("speeding", id, undefined, t);
        else if (this.speeding.state[slot] === ON) this.raisePeak(id, Math.round(kmh));
      } else {
        hold(this.speeding, slot);
      }

      // Zones. A stale truck's position is a guess: keep its state, start no change.
      const trusted = mode !== STALE;
      const lat = frame.lat[i]!;
      const lon = frame.lon[i]!;
      for (let k = 0; k < zones.length; k++) {
        const z = zones[k]!;
        if (trusted) {
          // Most trucks, most of the time: outside this zone's box, already known to be outside, nothing
          // pending. Rejected here, without a call: per truck per zone, this is the hot path.
          const p = z.prepared;
          const far = lat < p.minLat || lat > p.maxLat || lon < p.minLon || lon > p.maxLon;
          if (far && z.inside.state[slot] === OFF && Number.isNaN(z.inside.pendingSince[slot]!)) continue;
          const d = far ? Infinity : signedDistance(p, lat, lon);
          const change = step(z.inside, slot, t, d <= -r.marginM, d >= r.marginM, r.dwellMs, d <= 0);
          if (change === ON) {
            this.clear("zone-exit", id, z.spec.id, t);
            if (z.spec.alertOnEnter) this.raise("zone-enter", id, z.spec.id, t, 0);
          } else if (change === OFF) {
            this.clear("zone-enter", id, z.spec.id, t);
            if (z.spec.alertOnExit) this.raise("zone-exit", id, z.spec.id, t, 0);
          }
        } else {
          hold(z.inside, slot);
        }
        if (z.inside.state[slot] === ON) z.count++;
      }
    }
    if (zones.some((z, k) => z.count !== counts[k])) this.changed = true;

    const changed = this.changed;
    this.changed = false;
    return changed;
  }

  acknowledge(id: number): boolean {
    const alert = this.byId.get(id);
    if (!alert || alert.acknowledgedAt !== undefined) return false;
    alert.acknowledgedAt = this.lastTime;
    return true;
  }

  /** The dispatcher has dealt with it: the alert leaves the list. If the condition returns later, a new alert is raised. */
  resolve(id: number): boolean {
    const alert = this.byId.get(id);
    if (!alert) return false;
    this.byId.delete(id);
    this.open.delete(keyOf(alert.kind, alert.vehicleId, alert.zoneId));
    return true;
  }

  /** Resolve every alert whose condition has already ended. Returns how many. */
  resolveCleared(): number {
    let n = 0;
    for (const alert of [...this.byId.values()]) if (!alert.active && this.resolve(alert.id)) n++;
    return n;
  }

  /** Whether this truck has an open alert of this kind (for this zone) whose condition still holds. */
  isActive(kind: AlertKind, vehicleId: number, zoneId?: string): boolean {
    return this.open.get(keyOf(kind, vehicleId, zoneId))?.active ?? false;
  }

  /** Open alerts, most recently raised first. */
  alerts(): Alert[] {
    return [...this.byId.values()].sort((a, b) => b.lastRaisedAt - a.lastRaisedAt || b.id - a.id);
  }

  /** Alerts raised (or raised again) since the last call: what to announce. */
  drainRaised(): Alert[] {
    const raised = this.raisedSinceDrain;
    this.raisedSinceDrain = [];
    return raised;
  }

  zoneCounts(): Array<[id: string, trucksInside: number]> {
    return [...this.zones.values()].map((z) => [z.spec.id, z.count]);
  }

  private ensureCapacity(needed: number): void {
    if (needed <= this.capacity) return;
    const capacity = Math.max(needed, this.capacity * 2, 256);
    this.speeding = grow(this.speeding, capacity);
    for (const z of this.zones.values()) z.inside = grow(z.inside, capacity);
    const offline = new Uint8Array(capacity);
    offline.set(this.offline);
    this.offline = offline;
    this.capacity = capacity;
  }

  private raise(kind: AlertKind, vehicleId: number, zoneId: string | undefined, t: number, detail: number): void {
    const key = keyOf(kind, vehicleId, zoneId);
    let alert = this.open.get(key);
    if (alert) {
      alert.occurrences++;
      alert.lastRaisedAt = t;
      alert.active = true;
      alert.detail = detail;
      delete alert.clearedAt;
      delete alert.acknowledgedAt; // it's happening again: the dispatcher needs to see it again
    } else {
      alert = { id: this.nextId++, kind, vehicleId, raisedAt: t, lastRaisedAt: t, occurrences: 1, active: true, detail };
      if (zoneId !== undefined) alert.zoneId = zoneId;
      this.open.set(key, alert);
      this.byId.set(alert.id, alert);
    }
    this.stats.raised++;
    this.raisedSinceDrain.push(alert);
    this.changed = true;
    this.enforceCap();
  }

  private raisePeak(vehicleId: number, kmh: number): void {
    const alert = this.open.get(keyOf("speeding", vehicleId, undefined));
    if (alert && alert.active && kmh > alert.detail) {
      alert.detail = kmh;
      this.changed = true;
    }
  }

  private clear(kind: AlertKind, vehicleId: number, zoneId: string | undefined, t: number): void {
    const alert = this.open.get(keyOf(kind, vehicleId, zoneId));
    if (alert?.active) this.clearAlert(alert, t);
  }

  private clearAlert(alert: Alert, t: number): void {
    alert.active = false;
    alert.clearedAt = t;
    this.changed = true;
  }

  private enforceCap(): void {
    if (this.byId.size <= this.rules.maxOpen) return;
    // Oldest first (Map order is creation order). An active condition is never hidden.
    for (const alert of this.byId.values()) {
      if (this.byId.size <= this.rules.maxOpen) break;
      if (!alert.active && this.resolve(alert.id)) this.stats.autoResolved++;
    }
  }
}

function keyOf(kind: AlertKind, vehicleId: number, zoneId: string | undefined): string {
  return `${kind}:${vehicleId}:${zoneId ?? ""}`;
}

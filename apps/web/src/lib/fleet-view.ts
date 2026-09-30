import { MODE_CODES, groupOf, type StatusGroup } from "@fleet/gl";
import type { VehicleInfo } from "@fleet/sim";
import type { FleetSnapshot } from "@fleet/transport";

export interface FleetRow {
  id: number;
  plate: string;
  driver: string;
  mode: number;
  group: StatusGroup | undefined;
  speedKmh: number;
  /** Seconds since the truck's newest report, at the snapshot's display time. Negative while interpolating. */
  ageS: number;
  /** The truck has an active alert (Layer 8b). */
  alerting: boolean;
}

export type SortKey = "plate" | "speed" | "status";

/** Words a dispatcher reads, for each mode the shader can be in. */
export const MODE_LABEL: Record<number, string> = {
  [MODE_CODES.waiting]: "Waiting",
  [MODE_CODES.interpolated]: "Moving",
  [MODE_CODES.extrapolated]: "Moving, projected",
  [MODE_CODES.holding]: "No recent report",
  [MODE_CODES.parked]: "Parked",
  [MODE_CODES.stale]: "Stale",
};

const STATUS_ORDER: Record<number, number> = {
  [MODE_CODES.stale]: 0, // what needs attention first
  [MODE_CODES.holding]: 1,
  [MODE_CODES.extrapolated]: 2,
  [MODE_CODES.interpolated]: 3,
  [MODE_CODES.parked]: 4,
  [MODE_CODES.waiting]: 5,
};

const normalise = (s: string) => s.toLowerCase().replace(/[\s-]/g, "");

/**
 * Per-vehicle facts that don't change between snapshots, computed once when
 * the vehicle list arrives: each plate's alphabetical rank, and the text search
 * matches against. The list is rebuilt twice a second, so none of that work
 * belongs in the rebuild.
 */
export interface VehicleIndex {
  plate: ReadonlyMap<number, string>;
  driver: ReadonlyMap<number, string>;
  rank: ReadonlyMap<number, number>;
  searchText: ReadonlyMap<number, string>;
}

export function indexVehicles(vehicles: ReadonlyMap<number, VehicleInfo>): VehicleIndex {
  const list = [...vehicles.values()];
  list.sort((a, b) => (a.plate < b.plate ? -1 : a.plate > b.plate ? 1 : 0)); // plates are ASCII
  return {
    plate: new Map(list.map((v) => [v.id, v.plate])),
    driver: new Map(list.map((v) => [v.id, v.driver])),
    rank: new Map(list.map((v, i) => [v.id, i])),
    searchText: new Map(list.map((v) => [v.id, `${normalise(v.plate)} ${normalise(v.driver)}`])),
  };
}

const NO_ALERTS: ReadonlySet<number> = new Set();
const INDEX_BITS = 2 ** 15; // up to 32,768 snapshot rows
const RANK_BITS = 2 ** 15; // up to 32,768 plates

/**
 * The list the dispatcher reads, as snapshot row indices in display order:
 * narrowed by search and status, then sorted.
 *
 * Search matches plate or driver, ignoring case, spaces and hyphens, so
 * "kja482" finds KJA-482XR. Status filtering uses the same groups as the
 * shader's mask, so the list and the map always agree on what's shown.
 *
 * **It sorts numbers, not objects.** The first version built 5,000 row objects
 * and sorted them with a comparison function, which cost 13–15 ms (up to 25 ms)
 * on the dev laptop, twice a second on the main thread: a dropped frame every
 * rebuild. Here each row becomes one float64 key,
 *   primary × 2³⁰ + plateRank × 2¹⁵ + rowIndex,
 * and a Float64Array is sorted natively. The row index is read back from the
 * low bits. Row objects are then built only for the rows on screen.
 *
 * "Needs attention" puts trucks with an active alert first, then by status.
 */
export function buildOrder(
  snapshot: FleetSnapshot,
  index: VehicleIndex,
  query: string,
  groups: readonly StatusGroup[],
  sort: SortKey,
  alerting: ReadonlySet<number> = NO_ALERTS,
): Int32Array {
  if (snapshot.count > INDEX_BITS || index.rank.size >= RANK_BITS) {
    throw new RangeError(`the list's sort keys hold at most ${INDEX_BITS - 1} trucks; this fleet has ${snapshot.count}`);
  }
  const needle = normalise(query);
  const keys = new Float64Array(snapshot.count);
  let n = 0;
  for (let i = 0; i < snapshot.count; i++) {
    const id = snapshot.ids[i]!;
    if (needle && !(index.searchText.get(id) ?? `#${id}`).includes(needle)) continue;
    const mode = snapshot.mode[i]!;
    const group = groupOf(mode);
    if (group !== undefined && !groups.includes(group)) continue;
    const rank = index.rank.get(id) ?? RANK_BITS - 1; // unknown plates (not arrived yet) sort last
    const primary =
      sort === "plate"
        ? 0
        : sort === "speed"
          ? Math.round(Math.max(0, 1000 - snapshot.speed[i]! * 3.6) * 100)
          : alerting.has(id)
            ? 0
            : 1 + (STATUS_ORDER[mode] ?? 9);
    keys[n++] = (primary * RANK_BITS + rank) * INDEX_BITS + i;
  }
  const sorted = keys.subarray(0, n).sort();
  const order = new Int32Array(n);
  for (let k = 0; k < n; k++) order[k] = sorted[k]! % INDEX_BITS;
  return order;
}

/** One row, built only when it's about to be on screen. */
export function rowAt(snapshot: FleetSnapshot, index: VehicleIndex, i: number, alerting: ReadonlySet<number> = NO_ALERTS): FleetRow {
  const id = snapshot.ids[i]!;
  const mode = snapshot.mode[i]!;
  return {
    id,
    plate: index.plate.get(id) ?? `#${id}`,
    driver: index.driver.get(id) ?? "",
    mode,
    group: groupOf(mode),
    speedKmh: snapshot.speed[i]! * 3.6,
    ageS: snapshot.ageMs[i]! / 1000,
    alerting: alerting.has(id),
  };
}

/** Every matching row, materialised. Convenient for tests; the list itself uses buildOrder + rowAt. */
export function buildRows(
  snapshot: FleetSnapshot,
  vehicles: ReadonlyMap<number, VehicleInfo>,
  query: string,
  groups: readonly StatusGroup[],
  sort: SortKey,
  alerting: ReadonlySet<number> = NO_ALERTS,
): FleetRow[] {
  const index = indexVehicles(vehicles);
  return Array.from(buildOrder(snapshot, index, query, groups, sort, alerting), (i) => rowAt(snapshot, index, i, alerting));
}

/** How many trucks are in each status group: the numbers on the filter buttons. */
export function countGroups(snapshot: FleetSnapshot): Record<StatusGroup, number> {
  const counts: Record<StatusGroup, number> = { moving: 0, parked: 0, stale: 0 };
  for (let i = 0; i < snapshot.count; i++) {
    const g = groupOf(snapshot.mode[i]!);
    if (g) counts[g]++;
  }
  return counts;
}

/**
 * Which rows of a fixed-height list are on screen, plus `overscan` either
 * side, so fast scrolling doesn't show blank rows. The list keeps about 20 DOM
 * rows, not 5,000.
 */
export function windowRange(scrollTop: number, viewportHeight: number, rowHeight: number, count: number, overscan = 6): { start: number; end: number } {
  const first = Math.floor(Math.max(0, scrollTop) / rowHeight);
  const visible = Math.ceil(viewportHeight / rowHeight);
  return { start: Math.max(0, first - overscan), end: Math.min(count, first + visible + overscan) };
}

/**
 * The truck nearest a click, if one is within `radius` px. Distances are in
 * screen pixels, because that's what "near the click" means to a person. In
 * Lagos a pixel is about 76 m at zoom 10 and 0.6 m at zoom 17.
 */
export function pickNearest(points: readonly { id: number; x: number; y: number }[], x: number, y: number, radius: number): number | undefined {
  let best: number | undefined;
  let bestDistance = radius * radius;
  for (const p of points) {
    const d = (p.x - x) ** 2 + (p.y - y) ** 2;
    if (d <= bestDistance) {
      bestDistance = d;
      best = p.id;
    }
  }
  return best;
}

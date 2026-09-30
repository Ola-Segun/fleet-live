import { METRES_PER_DEG } from "@fleet/gl";

/** GeoJSON MultiPolygon coordinates: polygons → rings → [lon, lat] positions. The first ring of each polygon is its outline, the rest are holes. */
export type MultiPolygonCoords = number[][][][];

/**
 * A zone ready for thousands of point tests a second.
 *
 * - Its rings are converted once to metres on a flat plane centred on the
 *   zone. Zones are at most tens of kilometres across (the importer refuses
 *   anything over 100 km), and at that size treating the Earth as flat around
 *   the zone's centre is off by about 1 m in 10 km: far below GPS error, and far
 *   cheaper than spherical geometry per test.
 * - A bounding box in degrees rejects the far-away majority of trucks with four
 *   comparisons.
 * - **A grid index over the edges** answers the rest without visiting every
 *   edge. The inside test casts its ray only against edges in the point's grid
 *   row. The distance test looks only at edges in the 3 × 3 cells around the
 *   point. Cells are at least `reachM` wide, so any edge within reach is in
 *   those cells.
 *
 * Why the index: the first version tested every edge for every nearby truck.
 * A zone at the importer's 5,000-vertex limit, drawn round Apapa where many
 * trucks are, cost 34.5 ms per evaluation (median of 5) in the Worker.
 */
export interface PreparedZone {
  lat0: number;
  lon0: number;
  /** Metres per degree of longitude and of latitude at the zone's centre. */
  kx: number;
  ky: number;
  /** Bounding box in degrees, grown by `reachM`: outside it, a point is at least `reachM` away. */
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
  reachM: number;
  /** Edges in metres: x0, y0, x1, y1 per edge. */
  edges: Float64Array;
  /** Which ring each edge belongs to. */
  ringOf: Uint32Array;
  /** Per polygon: its outline ring's id, then its holes' ids. */
  polygons: number[][];
  ringCount: number;
  grid: {
    minX: number;
    minY: number;
    cell: number;
    cols: number;
    rows: number;
    /** Edges per cell, compressed: cell c's edges are cellEdges[cellStart[c] … cellStart[c + 1]). */
    cellStart: Uint32Array;
    cellEdges: Uint32Array;
    /** Edges whose height spans each row, the same way. */
    rowStart: Uint32Array;
    rowEdges: Uint32Array;
  };
}

/** Cells per side at most, so a large zone's grid stays small. */
const MAX_CELLS = 128;

export function prepareZone(coords: MultiPolygonCoords, reachM: number): PreparedZone {
  let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
  for (const polygon of coords) for (const ring of polygon) for (const [lon, lat] of ring) {
    minLat = Math.min(minLat, lat!);
    maxLat = Math.max(maxLat, lat!);
    minLon = Math.min(minLon, lon!);
    maxLon = Math.max(maxLon, lon!);
  }
  const lat0 = (minLat + maxLat) / 2;
  const lon0 = (minLon + maxLon) / 2;
  const ky = METRES_PER_DEG;
  const kx = METRES_PER_DEG * Math.cos((lat0 * Math.PI) / 180);

  // Edges in metres, each tagged with its ring. Unclosed rings are closed.
  const edgeList: number[] = [];
  const ringList: number[] = [];
  const polygons: number[][] = [];
  let ringCount = 0;
  for (const polygon of coords) {
    const ids: number[] = [];
    for (const ring of polygon) {
      const id = ringCount++;
      ids.push(id);
      const n = ring.length;
      const closed = n > 0 && (ring[0]![0] !== ring[n - 1]![0] || ring[0]![1] !== ring[n - 1]![1]);
      const count = closed ? n : n - 1;
      for (let i = 0; i < count; i++) {
        const a = ring[i]!;
        const b = ring[(i + 1) % n]!;
        edgeList.push((a[0]! - lon0) * kx, (a[1]! - lat0) * ky, (b[0]! - lon0) * kx, (b[1]! - lat0) * ky);
        ringList.push(id);
      }
    }
    polygons.push(ids);
  }
  const edges = Float64Array.from(edgeList);
  const edgeCount = ringList.length;

  // The grid covers the zone grown by reach, in cells at least `reach` wide.
  const minX = (minLon - lon0) * kx - reachM;
  const minY = (minLat - lat0) * ky - reachM;
  const width = (maxLon - lon0) * kx + reachM - minX;
  const height = (maxLat - lat0) * ky + reachM - minY;
  const cell = Math.max(reachM, width / MAX_CELLS, height / MAX_CELLS, 1);
  const cols = Math.max(1, Math.ceil(width / cell));
  const rows = Math.max(1, Math.ceil(height / cell));
  const colOf = (x: number) => Math.min(cols - 1, Math.max(0, Math.floor((x - minX) / cell)));
  const rowOf = (y: number) => Math.min(rows - 1, Math.max(0, Math.floor((y - minY) / cell)));

  // Two passes each (count, then fill) into compressed arrays: no array per cell.
  const cellCount = new Uint32Array(cols * rows + 1);
  const rowCount = new Uint32Array(rows + 1);
  const spans = (e: number) => {
    const x0 = edges[e * 4]!, y0 = edges[e * 4 + 1]!, x1 = edges[e * 4 + 2]!, y1 = edges[e * 4 + 3]!;
    return [colOf(Math.min(x0, x1)), colOf(Math.max(x0, x1)), rowOf(Math.min(y0, y1)), rowOf(Math.max(y0, y1))] as const;
  };
  for (let e = 0; e < edgeCount; e++) {
    const [c0, c1, r0, r1] = spans(e);
    for (let r = r0; r <= r1; r++) {
      rowCount[r]!++;
      for (let c = c0; c <= c1; c++) cellCount[r * cols + c]!++;
    }
  }
  const cellStart = prefix(cellCount);
  const rowStart = prefix(rowCount);
  const cellEdges = new Uint32Array(cellStart[cols * rows]!);
  const rowEdges = new Uint32Array(rowStart[rows]!);
  const cellFill = cellStart.slice();
  const rowFill = rowStart.slice();
  for (let e = 0; e < edgeCount; e++) {
    const [c0, c1, r0, r1] = spans(e);
    for (let r = r0; r <= r1; r++) {
      rowEdges[rowFill[r]!++] = e;
      for (let c = c0; c <= c1; c++) cellEdges[cellFill[r * cols + c]!++] = e;
    }
  }

  // Grown by reach, and by a hair more for the flat-plane approximation at the box's corners.
  const padLat = (reachM * 1.01) / ky;
  const padLon = (reachM * 1.01) / kx;
  return {
    lat0,
    lon0,
    kx,
    ky,
    minLat: minLat - padLat,
    maxLat: maxLat + padLat,
    minLon: minLon - padLon,
    maxLon: maxLon + padLon,
    reachM,
    edges,
    ringOf: Uint32Array.from(ringList),
    polygons,
    ringCount,
    grid: { minX, minY, cell, cols, rows, cellStart, cellEdges, rowStart, rowEdges },
  };
}

/** Counts → start offsets, with the total at the end. */
function prefix(counts: Uint32Array): Uint32Array {
  const start = new Uint32Array(counts.length);
  let sum = 0;
  for (let i = 0; i < counts.length - 1; i++) {
    start[i] = sum;
    sum += counts[i]!;
  }
  start[counts.length - 1] = sum;
  return start;
}

let parity = new Uint8Array(16);

/**
 * Signed distance from a point to the zone's edge, in metres: negative inside,
 * positive outside. **Exact only within `reachM` of the edge.** Further away
 * it returns −Infinity inside or +Infinity outside, because the alert rules
 * only ask "how far past the edge, up to the margin", and knowing the side is
 * enough beyond that.
 *
 * Inside means inside any polygon's outline and none of its holes. Polygons of
 * one zone may overlap without cancelling each other out.
 */
export function signedDistance(zone: PreparedZone, lat: number, lon: number): number {
  if (lat < zone.minLat || lat > zone.maxLat || lon < zone.minLon || lon > zone.maxLon) return Infinity;
  const x = (lon - zone.lon0) * zone.kx;
  const y = (lat - zone.lat0) * zone.ky;
  const { edges, ringOf, grid } = zone;
  const col = Math.min(grid.cols - 1, Math.max(0, Math.floor((x - grid.minX) / grid.cell)));
  const row = Math.min(grid.rows - 1, Math.max(0, Math.floor((y - grid.minY) / grid.cell)));

  // Inside: even-odd crossings of a ray to +x, per ring, against only the edges spanning this row.
  if (parity.length < zone.ringCount) parity = new Uint8Array(zone.ringCount * 2);
  parity.fill(0, 0, zone.ringCount);
  for (let k = grid.rowStart[row]!, end = grid.rowStart[row + 1]!; k < end; k++) {
    const e = grid.rowEdges[k]! * 4;
    const ay = edges[e + 1]!, by = edges[e + 3]!;
    if (ay > y !== by > y) {
      const ax = edges[e]!, bx = edges[e + 2]!;
      if (x < ax + ((y - ay) * (bx - ax)) / (by - ay)) parity[ringOf[grid.rowEdges[k]!]!]! ^= 1;
    }
  }
  let inside = false;
  for (const rings of zone.polygons) {
    if (!parity[rings[0]!]) continue;
    let inHole = false;
    for (let r = 1; r < rings.length && !inHole; r++) inHole = parity[rings[r]!] === 1;
    if (!inHole) {
      inside = true;
      break;
    }
  }

  // Distance: only edges in the 3 × 3 cells around the point can be within reach.
  let best = Infinity;
  for (let r = Math.max(0, row - 1); r <= Math.min(grid.rows - 1, row + 1); r++) {
    for (let c = Math.max(0, col - 1); c <= Math.min(grid.cols - 1, col + 1); c++) {
      const cellIndex = r * grid.cols + c;
      for (let k = grid.cellStart[cellIndex]!, end = grid.cellStart[cellIndex + 1]!; k < end; k++) {
        const e = grid.cellEdges[k]! * 4;
        const ax = edges[e]!, ay = edges[e + 1]!;
        const dx = edges[e + 2]! - ax, dy = edges[e + 3]! - ay;
        const len2 = dx * dx + dy * dy;
        const t = len2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len2)) : 0;
        const ex = ax + t * dx - x, ey = ay + t * dy - y;
        best = Math.min(best, ex * ex + ey * ey);
      }
    }
  }
  if (best > zone.reachM * zone.reachM) return inside ? -Infinity : Infinity;
  const d = Math.sqrt(best);
  return inside ? -d : d;
}

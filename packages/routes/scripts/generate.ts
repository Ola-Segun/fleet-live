/**
 * Generates data/lagos-routes.json from the public OSRM demo server, once.
 *
 *   pnpm --filter @fleet/routes generate
 *
 * The demo server's policy is at most 1 request per second, reasonable
 * non-commercial use, and no uptime guarantee
 * (github.com/Project-OSRM/osrm-backend/wiki/Demo-server). So this script is
 * strictly sequential, spaces request *starts* at least 1.1 s apart, caches
 * every raw response under .cache/ so a rerun costs nothing, and is never run
 * by the app, CI or tests. They read the committed output.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  PLACES,
  decodePolyline,
  encodePolyline,
  placePairs,
  simplifyTimedPath,
  validateDataset,
  type Place,
  type RouteDataset,
  type RouteRecord,
} from "../src";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CACHE = join(ROOT, ".cache");
const OUT = join(ROOT, "data", "lagos-routes.json");

const ENDPOINT = "https://router.project-osrm.org/route/v1/driving";
const USER_AGENT = "fleet-live-route-generator/0.1 (portfolio project; github.com/Ola-Segun)";
const MIN_SPACING_MS = 1100;
const MAX_SNAP_M = 500;
const SIMPLIFY_TOLERANCE_M = 1.5;

interface OsrmResponse {
  code: string;
  message?: string;
  routes: {
    distance: number;
    duration: number;
    geometry: string;
    legs: { annotation: { duration: number[]; distance: number[] } }[];
  }[];
  waypoints: { distance: number; name: string }[];
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
let lastRequestAt = 0;

async function fetchRoute(from: Place, to: Place): Promise<OsrmResponse> {
  const cacheFile = join(CACHE, `${from.id}__${to.id}.json`);
  try {
    return JSON.parse(await readFile(cacheFile, "utf8")) as OsrmResponse;
  } catch {
    // Not cached yet.
  }

  const coords = `${from.at[1]},${from.at[0]};${to.at[1]},${to.at[0]}`;
  const url = `${ENDPOINT}/${coords}?overview=full&geometries=polyline6&annotations=duration,distance&steps=false`;

  const label = `${from.id} → ${to.id}`;
  for (let attempt = 1; ; attempt++) {
    const wait = lastRequestAt + MIN_SPACING_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastRequestAt = Date.now();

    // Only a network failure, a 429 or a 5xx is worth retrying. Anything else
    // (a 4xx, or a 200 whose body says NoRoute) would fail the same way again.
    let retryable: string;
    try {
      const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
      if (res.ok) {
        const body = (await res.json()) as OsrmResponse;
        if (body.code !== "Ok") throw new Error(`OSRM ${body.code} for ${label}: ${body.message ?? ""}`);
        await writeFile(cacheFile, JSON.stringify(body));
        return body;
      }
      if (res.status !== 429 && res.status < 500) throw new Error(`HTTP ${res.status} for ${label}`);
      retryable = `HTTP ${res.status}`;
    } catch (error) {
      if (!(error instanceof TypeError)) throw error; // fetch rejects with TypeError on network failure
      retryable = `network: ${error.message}`;
    }

    if (attempt >= 4) throw new Error(`${retryable} after ${attempt} attempts for ${label}`);
    const backoff = 2000 * 2 ** (attempt - 1);
    console.warn(`  retry ${attempt} for ${label} in ${backoff} ms (${retryable})`);
    await sleep(backoff);
  }
}

function toRecord(from: Place, to: Place, body: OsrmResponse): { record: RouteRecord; rawPoints: number } {
  const route = body.routes[0];
  const annotation = route?.legs[0]?.annotation;
  if (!route || !annotation) throw new Error(`no route for ${from.id} → ${to.id}`);

  const points = decodePolyline(route.geometry);
  const simplified = simplifyTimedPath({ points, durations: annotation.duration }, SIMPLIFY_TOLERANCE_M);
  const durations = simplified.durations.map((s) => Math.round(s * 10));

  return {
    rawPoints: points.length,
    record: {
      id: `${from.id}__${to.id}`,
      from: from.id,
      to: to.id,
      distance: Math.round(route.distance),
      duration: durations.reduce((a, b) => a + b, 0) / 10,
      geometry: encodePolyline(simplified.points),
      durations,
    },
  };
}

async function main() {
  await mkdir(CACHE, { recursive: true });
  const pairs = placePairs();
  const snaps = new Map<string, number>();
  const routes: RouteRecord[] = [];
  let rawPoints = 0;

  console.log(`Fetching ${pairs.length} routes (cached ones are free; new ones take ~1.1 s each)…`);
  for (const [i, [from, to]] of pairs.entries()) {
    const body = await fetchRoute(from, to);
    [from, to].forEach((place, w) => {
      const snap = body.waypoints[w]?.distance ?? Infinity;
      snaps.set(place.id, Math.max(snaps.get(place.id) ?? 0, snap));
    });
    const { record, rawPoints: n } = toRecord(from, to, body);
    routes.push(record);
    rawPoints += n;
    if ((i + 1) % 25 === 0) console.log(`  ${i + 1}/${pairs.length}`);
  }

  const badSnaps = [...snaps].filter(([, m]) => m > MAX_SNAP_M);
  if (badSnaps.length > 0) {
    throw new Error(
      `These places are over ${MAX_SNAP_M} m from any road, so their coordinates are probably wrong: ` +
        badSnaps.map(([id, m]) => `${id} (${Math.round(m)} m)`).join(", "),
    );
  }

  const dataset: RouteDataset = {
    attribution: "Route geometry © OpenStreetMap contributors, via the OSRM demo server",
    license: "ODbL-1.0 (https://opendatacommons.org/licenses/odbl/1-0/)",
    source: "router.project-osrm.org, driving profile",
    simplifyToleranceM: SIMPLIFY_TOLERANCE_M,
    places: [...PLACES],
    routes,
  };

  const problems = validateDataset(dataset);
  if (problems.length > 0) throw new Error(`Dataset invalid:\n  ${problems.join("\n  ")}`);

  const json = `${JSON.stringify(dataset)}\n`;
  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, json);

  const keptPoints = routes.reduce((n, r) => n + r.durations.length + 1, 0);
  const km = routes.reduce((n, r) => n + r.distance, 0) / 1000;
  const worstSnap = [...snaps].sort((a, b) => b[1] - a[1])[0];
  console.log(`
Wrote ${OUT}
  routes            ${routes.length}
  total length      ${km.toFixed(0)} km
  points            ${rawPoints} from OSRM → ${keptPoints} after simplifying at ${SIMPLIFY_TOLERANCE_M} m (${((1 - keptPoints / rawPoints) * 100).toFixed(1)}% fewer)
  file size         ${(json.length / 1024).toFixed(0)} KiB, ${(gzipSync(json).length / 1024).toFixed(0)} KiB gzipped
  worst road snap   ${worstSnap?.[0]} at ${Math.round(worstSnap?.[1] ?? 0)} m`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

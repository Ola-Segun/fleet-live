import { encodePolyline, parseDataset, type RouteDataset } from "@fleet/routes";
import committed from "@fleet/routes/data/lagos-routes.json";
import { buildNetwork, type RoadNetwork } from "../src";

export const lagos: RoadNetwork = buildNetwork(parseDataset(committed));

/** 03:00 Lagos (02:00 UTC): off-peak, no daytime hold-ups. */
export const NIGHT = Date.UTC(2026, 8, 29, 2, 0, 0);
/** 08:00 Lagos (07:00 UTC): the morning peak. */
export const MORNING_PEAK = Date.UTC(2026, 8, 29, 7, 0, 0);

/** Metres to degrees of longitude at 6.5° N. */
export const eastDeg = (m: number) => m / (111_195.08 * Math.cos((6.5 * Math.PI) / 180));

/**
 * Two places 1 km apart on a due-east line at 6.5° N, clear of every
 * congestion zone, with one route each way at a free-flow 10 m/s.
 */
export function straightNetwork(): RoadNetwork {
  const a = [6.5, 3.4] as const;
  const b = [6.5, 3.4 + eastDeg(1000)] as const;
  const dataset: RouteDataset = {
    attribution: "",
    license: "",
    source: "",
    simplifyToleranceM: 0,
    places: [
      { id: "a", name: "A", kind: "district", at: a },
      { id: "b", name: "B", kind: "district", at: b },
    ],
    routes: [
      { id: "a__b", from: "a", to: "b", distance: 1000, duration: 100, geometry: encodePolyline([a, b]), durations: [1000] },
      { id: "b__a", from: "b", to: "a", distance: 1000, duration: 100, geometry: encodePolyline([b, a]), durations: [1000] },
    ],
  };
  return buildNetwork(dataset);
}

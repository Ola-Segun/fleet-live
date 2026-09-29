import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  PLACES,
  decodePolyline,
  distanceToSegment,
  encodePolyline,
  haversine,
  placePairs,
  simplifyTimedPath,
  toLocalMetres,
  parseDataset,
  validateDataset,
  type LatLon,
  type RouteDataset,
} from "../src";
import committed from "../data/lagos-routes.json";

// ─── Polyline ───────────────────────────────────────────────────────────────

describe("polyline", () => {
  it("decodes Google's published example (precision 5)", () => {
    // developers.google.com/maps/documentation/utilities/polylinealgorithm
    expect(decodePolyline("_p~iF~ps|U_ulLnnqC_mqNvxq`@", 5)).toEqual([
      [38.5, -120.2],
      [40.7, -120.95],
      [43.252, -126.453],
    ]);
  });

  it("encodes it back to the same string", () => {
    const points: LatLon[] = [
      [38.5, -120.2],
      [40.7, -120.95],
      [43.252, -126.453],
    ];
    expect(encodePolyline(points, 5)).toBe("_p~iF~ps|U_ulLnnqC_mqNvxq`@");
  });

  it("round-trips any path at precision 6, to the microdegree", () => {
    const coord = fc.tuple(
      fc.integer({ min: -90_000_000, max: 90_000_000 }),
      fc.integer({ min: -180_000_000, max: 180_000_000 }),
    );
    fc.assert(
      fc.property(fc.array(coord, { maxLength: 50 }), (micro) => {
        const points: LatLon[] = micro.map(([lat, lon]) => [lat / 1e6, lon / 1e6]);
        expect(decodePolyline(encodePolyline(points))).toEqual(points);
      }),
    );
  });

  it("rejects a string that ends mid-value", () => {
    // "_p~iF" alone is a complete latitude with no longitude.
    expect(() => decodePolyline("_p~iF", 5)).toThrow(SyntaxError);
  });
});

// ─── Geometry ───────────────────────────────────────────────────────────────

describe("geometry", () => {
  it("measures one degree of latitude as πR/180 = 111,195.08 m", () => {
    expect(haversine([6, 3], [7, 3])).toBeCloseTo(111_195.08, 1);
  });

  it("projects one degree north as the same distance in the flat frame", () => {
    const [x, y] = toLocalMetres([6, 3], [7, 3]);
    expect(x).toBeCloseTo(0, 6);
    expect(y).toBeCloseTo(111_195.08, 1);
  });

  it("measures distance to the nearest point of the segment, not the infinite line", () => {
    expect(distanceToSegment([5, 3], [0, 0], [10, 0])).toBe(3); // perpendicular
    expect(distanceToSegment([13, 4], [0, 0], [10, 0])).toBe(5); // past the end: 3-4-5 to (10, 0)
    expect(distanceToSegment([3, 4], [0, 0], [0, 0])).toBe(5); // degenerate segment
  });
});

// ─── Simplification ─────────────────────────────────────────────────────────

const METRE_LAT = 1 / 111_195.08;

describe("simplifyTimedPath", () => {
  it("reduces a straight road to its ends and sums the time", () => {
    const points: LatLon[] = Array.from({ length: 11 }, (_, i) => [6.5 + i * 10 * METRE_LAT, 3.4]);
    const result = simplifyTimedPath({ points, durations: Array(10).fill(1.5) }, 1.5);
    expect(result.points).toEqual([points[0], points[10]]);
    expect(result.durations).toEqual([15]);
  });

  it("keeps a bend larger than the tolerance and drops one smaller", () => {
    const east = (m: number): number => 3.4 + m / (111_195.08 * Math.cos((6.5 * Math.PI) / 180));
    const line = (bendM: number): LatLon[] => [
      [6.5, east(0)],
      [6.5 + bendM * METRE_LAT, east(50)],
      [6.5, east(100)],
    ];
    expect(simplifyTimedPath({ points: line(3), durations: [4, 6] }, 1.5).points).toHaveLength(3);
    expect(simplifyTimedPath({ points: line(1), durations: [4, 6] }, 1.5)).toEqual({
      points: [line(1)[0], line(1)[2]],
      durations: [10],
    });
  });

  const arbPath = fc
    .array(
      fc.tuple(fc.double({ min: -30, max: 30, noNaN: true }), fc.double({ min: -30, max: 30, noNaN: true })),
      { minLength: 2, maxLength: 60 },
    )
    .chain((steps) =>
      fc.array(fc.double({ min: 0, max: 20, noNaN: true }), {
        minLength: steps.length - 1,
        maxLength: steps.length - 1,
      }).map((durations) => {
        // A random walk in metres around Lagos, so neighbouring points are realistic distances apart.
        let lat = 6.5;
        let lon = 3.4;
        const points: LatLon[] = steps.map(([dy, dx]) => {
          lat += dy * METRE_LAT;
          lon += dx * METRE_LAT;
          return [lat, lon];
        });
        return { points, durations };
      }),
    );

  it("conserves total driving time exactly, keeps both ends, and keeps points in order", () => {
    fc.assert(
      fc.property(arbPath, (path) => {
        const out = simplifyTimedPath(path, 1.5);
        const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
        expect(sum(out.durations)).toBeCloseTo(sum(path.durations), 9);
        expect(out.points[0]).toBe(path.points[0]);
        expect(out.points.at(-1)).toBe(path.points.at(-1));
        const indices = out.points.map((p) => path.points.indexOf(p));
        expect(indices).toEqual([...indices].sort((a, b) => a - b));
      }),
    );
  });

  it("drops only points within the tolerance of the segment that replaced them", () => {
    fc.assert(
      fc.property(arbPath, (path) => {
        const out = simplifyTimedPath(path, 1.5);
        const origin = path.points[0]!;
        const kept = out.points.map((p) => path.points.indexOf(p));
        for (let k = 0; k < kept.length - 1; k++) {
          const a = toLocalMetres(origin, path.points[kept[k]!]!);
          const b = toLocalMetres(origin, path.points[kept[k + 1]!]!);
          for (let i = kept[k]! + 1; i < kept[k + 1]!; i++) {
            expect(distanceToSegment(toLocalMetres(origin, path.points[i]!), a, b)).toBeLessThanOrEqual(1.5 + 1e-9);
          }
        }
      }),
    );
  });

  it("refuses durations that don't match the points", () => {
    expect(() => simplifyTimedPath({ points: [[6, 3], [6.1, 3]], durations: [] }, 1.5)).toThrow(RangeError);
  });
});

// ─── Places and the dataset ─────────────────────────────────────────────────

describe("places", () => {
  it("pairs 25 places into 600 unique directed routes", () => {
    const ids = placePairs().map(([a, b]) => `${a.id}__${b.id}`);
    expect(PLACES).toHaveLength(25);
    expect(new Set(ids).size).toBe(600);
  });

  it("gives every place a way out and a way in", () => {
    for (const place of PLACES) {
      expect(placePairs().some(([from]) => from === place), `${place.id} out`).toBe(true);
      expect(placePairs().some(([, to]) => to === place), `${place.id} in`).toBe(true);
    }
  });
});

describe("validateDataset", () => {
  const good = (): RouteDataset => ({
    attribution: "",
    license: "",
    source: "",
    simplifyToleranceM: 1.5,
    places: [PLACES[0]!, PLACES[1]!],
    routes: [
      {
        id: "apapa-port__tincan-port",
        from: "apapa-port",
        to: "tincan-port",
        distance: 2200,
        duration: 300,
        geometry: encodePolyline([
          [6.443, 3.364],
          [6.439, 3.345],
        ]),
        durations: [3000],
      },
    ],
  });

  it("accepts a well-formed dataset", () => {
    expect(validateDataset(good())).toEqual([]);
  });

  it("reports each kind of problem", () => {
    const edits: [string, (d: RouteDataset) => void][] = [
      ["unknown place", (d) => (d.routes[0]!.to = "nowhere")],
      ["durations", (d) => d.routes[0]!.durations.push(1)],
      ["outside Lagos", (d) => (d.routes[0]!.geometry = encodePolyline([[6.443, 3.364], [9.06, 7.49]]))],
      ["implausible", (d) => (d.routes[0]!.distance = 2_000_000)],
      ["duplicate id", (d) => d.routes.push({ ...d.routes[0]! })],
      ["does not decode", (d) => (d.routes[0]!.geometry = "_p~iF")],
    ];
    for (const [expected, edit] of edits) {
      const dataset = good();
      edit(dataset);
      expect(validateDataset(dataset).join("\n"), expected).toContain(expected);
    }
  });

  it("reports a place whose coordinates aren't a [lat, lon] pair in Lagos", () => {
    const dataset = good();
    dataset.places[0] = { ...dataset.places[0]!, at: [6.4] as unknown as LatLon };
    expect(validateDataset(dataset).join("\n")).toContain("place apapa-port");
  });

  it("parses the committed Lagos dataset through the typed entry point", () => {
    const dataset = parseDataset(committed);
    expect(dataset.places).toHaveLength(25);
    expect(dataset.routes).toHaveLength(600);
  });

  it("refuses to parse something that isn't a dataset", () => {
    expect(() => parseDataset(null)).toThrow(TypeError);
    expect(() => parseDataset({ places: [] })).toThrow(TypeError);
  });
});

import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { decodePolyline, parseDataset } from "@fleet/routes";
import committed from "@fleet/routes/data/lagos-routes.json";
import { PRESET_ZONES, parseZones, prepareZone, signedDistance, zonesToGeoJSON } from "../src";

const ring = [[3.40, 6.50], [3.41, 6.50], [3.41, 6.51], [3.40, 6.51], [3.40, 6.50]];

describe("importing zones from GeoJSON", () => {
  it("reads a FeatureCollection with names, kinds and alert settings", () => {
    const result = parseZones({
      type: "FeatureCollection",
      features: [
        { type: "Feature", properties: { name: " Yard ", kind: "depot" }, geometry: { type: "Polygon", coordinates: [ring] } },
        { type: "Feature", properties: { alertOnExit: true }, geometry: { type: "MultiPolygon", coordinates: [[ring]] } },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.zones.map(({ name, kind, alertOnEnter, alertOnExit }) => ({ name, kind, alertOnEnter, alertOnExit }))).toEqual([
      { name: "Yard", kind: "depot", alertOnEnter: false, alertOnExit: true },
      { name: "Imported zone 2", kind: "restricted", alertOnEnter: true, alertOnExit: true },
    ]);
  });

  it("closes an unclosed ring, and says so", () => {
    const result = parseZones({ type: "Polygon", coordinates: [ring.slice(0, 4)] });
    expect(result.ok && result.zones[0]!.coordinates[0]![0]!.length).toBe(5);
    expect(result.ok && result.warnings).toEqual(["geometry: a ring wasn't closed, so it was closed by repeating its first position."]);
  });

  it.each([
    ["not an object", "zones", /Not a GeoJSON object/],
    ["a line", { type: "Feature", geometry: { type: "LineString", coordinates: ring } }, /isn't an area/],
    ["an out-of-range position", { type: "Polygon", coordinates: [[[200, 6.5], [3.41, 6.5], [3.41, 6.51], [200, 6.5]]] }, /isn't a longitude and latitude/],
    ["a text coordinate", { type: "Polygon", coordinates: [[["3.4", 6.5], [3.41, 6.5], [3.41, 6.51]]] }, /expected \[longitude, latitude\]/],
    ["a ring of two points", { type: "Polygon", coordinates: [[[3.4, 6.5], [3.41, 6.5], [3.4, 6.5]]] }, /at least 3 different positions/],
    ["a zone 300 km across", { type: "Polygon", coordinates: [[[3, 5], [5, 5], [5, 7], [3, 5]]] }, /km across/],
    ["too many features", { type: "FeatureCollection", features: Array.from({ length: 51 }, () => ({ type: "Feature", geometry: { type: "Polygon", coordinates: [ring] } })) }, /at most 50/],
  ])("rejects %s with a message saying where", (_, input, message) => {
    const result = parseZones(input);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors.join(" ")).toMatch(message);
  });

  it("never throws, whatever JSON it's given", () => {
    fc.assert(
      fc.property(fc.jsonValue(), (value) => {
        expect(() => parseZones(value)).not.toThrow();
        expect(() => parseZones({ type: "FeatureCollection", features: [{ type: "Feature", geometry: { type: "Polygon", coordinates: value } }] })).not.toThrow();
      }),
    );
  });

  it("round-trips the presets through export and import", () => {
    const exported = zonesToGeoJSON(PRESET_ZONES.map((z) => ({ ...z, id: z.presetId })));
    const result = parseZones(JSON.parse(JSON.stringify(exported)));
    expect(result.ok && result.zones.map((z) => [z.name, z.kind, z.coordinates])).toEqual(PRESET_ZONES.map((z) => [z.name, z.kind, z.coordinates]));
  });
});

describe("the preset zones", () => {
  const routes = parseDataset(committed).routes;

  it("put the bridge where the simulated trucks drive: the committed routes cross it", () => {
    const bridge = prepareZone(PRESET_ZONES[0]!.coordinates, 40);
    const crossing = routes.filter((r) => decodePolyline(r.geometry).some(([lat, lon]) => signedDistance(bridge, lat, lon) < -20));
    expect(crossing.length).toBe(17);
  });

  it("put the port around the point its routes start and end at", () => {
    const port = prepareZone(PRESET_ZONES[1]!.coordinates, 40);
    const ends = routes.filter((r) => r.to === "apapa-port").map((r) => decodePolyline(r.geometry).at(-1)!);
    expect(ends.length).toBeGreaterThan(0);
    for (const [lat, lon] of ends) expect(signedDistance(port, lat, lon)).toBeLessThan(-100);
  });
});

import { describe, expect, it } from "vitest";
import { MODE_CODES } from "@fleet/gl";
import type { VehicleInfo } from "@fleet/sim";
import type { FleetSnapshot } from "@fleet/transport";
import { buildRows, countGroups, pickNearest, windowRange } from "../src/lib/fleet-view";
import { parseUi, writeUi } from "../src/lib/ui-url";

const M = MODE_CODES;
function snapshot(rows: [id: number, mode: number, speedMs: number][]): FleetSnapshot {
  const n = rows.length;
  return {
    serverTime: 0,
    displayTime: 0,
    delayMs: 1400,
    count: n,
    ids: Uint32Array.from(rows.map((r) => r[0])),
    lat: new Float64Array(n),
    lon: new Float64Array(n),
    heading: new Float32Array(n),
    speed: Float32Array.from(rows.map((r) => r[2])),
    mode: Uint8Array.from(rows.map((r) => r[1])),
    ageMs: new Float32Array(n),
  };
}
const vehicles: ReadonlyMap<number, VehicleInfo> = new Map(
  (
    [
      [1, "KJA-482XR", "Adebayo Okafor"],
      [2, "APP-101AB", "Chinedu Bello"],
      [3, "EPE-777ZZ", "Musa Eze"],
      [4, "LND-300KK", "Tunde Balogun"],
    ] as const
  ).map(([id, plate, driver]) => [id, { id, plate, driver }]),
);
const fleet = snapshot([
  [1, M.interpolated, 10],
  [2, M.parked, 0],
  [3, M.stale, 0],
  [4, M.extrapolated, 15],
]);

describe("the fleet list", () => {
  it("finds a plate however it's typed: case, spaces and hyphens don't matter", () => {
    expect(buildRows(fleet, vehicles, "kja482", ["moving", "parked", "stale"], "plate").map((r) => r.plate)).toEqual(["KJA-482XR"]);
    expect(buildRows(fleet, vehicles, "KJA 482", ["moving", "parked", "stale"], "plate")).toHaveLength(1);
    expect(buildRows(fleet, vehicles, "musa", ["moving", "parked", "stale"], "plate").map((r) => r.plate)).toEqual(["EPE-777ZZ"]);
  });

  it("filters by the same status groups the map's shader uses", () => {
    expect(buildRows(fleet, vehicles, "", ["moving"], "plate").map((r) => r.id)).toEqual([1, 4]);
    expect(buildRows(fleet, vehicles, "", ["parked", "stale"], "plate").map((r) => r.id)).toEqual([2, 3]);
  });

  it("sorts by plate, by speed, or by status with what needs attention first", () => {
    const all = ["moving", "parked", "stale"] as const;
    expect(buildRows(fleet, vehicles, "", all, "plate").map((r) => r.plate)).toEqual(["APP-101AB", "EPE-777ZZ", "KJA-482XR", "LND-300KK"]);
    expect(buildRows(fleet, vehicles, "", all, "speed").map((r) => r.id)).toEqual([4, 1, 2, 3]);
    expect(buildRows(fleet, vehicles, "", all, "status").map((r) => r.id)).toEqual([3, 4, 1, 2]); // stale, projected, moving, parked
  });

  it("shows a vehicle by id before its plate has arrived, and converts speed to km/h", () => {
    const rows = buildRows(snapshot([[9, M.interpolated, 10]]), new Map(), "", ["moving"], "plate");
    expect(rows[0]).toMatchObject({ plate: "#9", speedKmh: 36 });
  });

  it("refuses a fleet too large for its packed sort keys rather than mis-sorting it", () => {
    const huge = snapshot(Array.from({ length: 32_769 }, (_, i): [number, number, number] => [i, M.parked, 0]));
    expect(() => buildRows(huge, new Map(), "", ["parked"], "plate")).toThrow(RangeError);
  });

  it("counts each status group for the filter buttons", () => {
    expect(countGroups(fleet)).toEqual({ moving: 2, parked: 1, stale: 1 });
  });
});

describe("list windowing", () => {
  it("renders only the rows on screen, plus a margin either side", () => {
    expect(windowRange(0, 440, 44, 5000, 6)).toEqual({ start: 0, end: 16 });
    expect(windowRange(44 * 1000, 440, 44, 5000, 6)).toEqual({ start: 994, end: 1016 });
    expect(windowRange(44 * 4995, 440, 44, 5000, 6)).toEqual({ start: 4989, end: 5000 });
  });
});

describe("picking", () => {
  const points = [
    { id: 1, x: 100, y: 100 },
    { id: 2, x: 110, y: 100 },
    { id: 3, x: 300, y: 300 },
  ];
  it("takes the nearest truck within the radius", () => {
    expect(pickNearest(points, 108, 101, 24)).toBe(2);
    expect(pickNearest(points, 101, 99, 24)).toBe(1);
  });
  it("takes nothing when every truck is further than the radius", () => {
    expect(pickNearest(points, 200, 200, 24)).toBeUndefined();
  });
});

describe("view in the URL", () => {
  it("round-trips a full view and omits defaults", () => {
    const url = writeUi(new URL("https://x.test/?c=6.5,3.4,12"), { vehicle: 1042, follow: true, groups: ["moving", "stale"], query: "KJA" });
    expect(url.search).toBe("?c=6.5%2C3.4%2C12&v=1042&f=1&s=moving%2Cstale&q=KJA");
    expect(parseUi(url.searchParams)).toEqual({ vehicle: 1042, follow: true, groups: ["moving", "stale"], query: "KJA" });
    const plain = writeUi(new URL("https://x.test/"), { vehicle: undefined, follow: false, groups: ["moving", "parked", "stale"], query: "" });
    expect(plain.search).toBe("");
  });

  it("ignores malformed input, and never follows nothing", () => {
    const ui = parseUi(new URLSearchParams("v=abc&f=1&s=moving,bogus,moving&q=" + "x".repeat(200)));
    expect(ui.vehicle).toBeUndefined();
    expect(ui.follow).toBe(false);
    expect(ui.groups).toEqual(["moving"]);
    expect(ui.query).toHaveLength(64);
  });
});

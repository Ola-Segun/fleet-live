import { describe, expect, it } from "vitest";
import { MODE_CODES, type FleetSnapshot } from "@fleet/transport";
import { DEFAULT_CAMERA, formatCamera, parseCamera } from "../src/lib/camera-url";
import { snapshotToGeoJSON } from "../src/lib/snapshot-geojson";
import { configFromSearch } from "../src/lib/worker-messages";

describe("camera in the URL", () => {
  it("round-trips to the metre and the hundredth of a zoom level", () => {
    expect(formatCamera({ lat: 6.524404, lng: 3.379206, zoom: 11.5 })).toBe("6.52440,3.37921,11.50");
    expect(parseCamera("6.52440,3.37921,11.50")).toEqual({ lat: 6.5244, lng: 3.37921, zoom: 11.5 });
    expect(parseCamera(formatCamera(DEFAULT_CAMERA))).toEqual(DEFAULT_CAMERA);
  });

  it("ignores anything malformed or impossible rather than breaking the map", () => {
    for (const bad of [null, "", "6.5,3.4", "6.5,3.4,11,2", "a,b,c", "91,3.4,11", "6.5,181,11", "6.5,3.4,23", "6.5,3.4,-1", "Infinity,3,4"]) {
      expect(parseCamera(bad), String(bad)).toBeUndefined();
    }
  });
});

describe("snapshot to GeoJSON", () => {
  it("turns parallel arrays into one point feature per truck, longitude first", () => {
    const snapshot: FleetSnapshot = {
      serverTime: 0,
      displayTime: 0,
      delayMs: 1400,
      count: 2,
      ids: Uint32Array.from([7, 9]),
      lat: Float64Array.from([6.5, 6.6]),
      lon: Float64Array.from([3.4, 3.5]),
      heading: Float32Array.from([90, 180]),
      speed: Float32Array.from([10, 0]),
      mode: Uint8Array.from([MODE_CODES.interpolated, MODE_CODES.parked]),
      ageMs: Float32Array.from([-300, 12_000]),
    };
    const geo = snapshotToGeoJSON(snapshot);
    expect(geo.features).toHaveLength(2);
    expect(geo.features[0]).toEqual({
      type: "Feature",
      id: 7,
      geometry: { type: "Point", coordinates: [3.4, 6.5] }, // GeoJSON is [lng, lat]
      properties: { mode: "interpolated", heading: 90 },
    });
    expect(geo.features[1]!.properties.mode).toBe("parked");
  });
});

describe("fleet config from the URL", () => {
  const read = (query: string) => configFromSearch(new URLSearchParams(query));

  it("defaults to a 5,000-truck demo fleet", () => {
    expect(read("")).toEqual({ mode: "demo", seed: "fleet-live", vehicleCount: 5000 });
  });

  it("accepts a stress size and another seed, within bounds", () => {
    expect(read("n=20000&seed=abc")).toEqual({ mode: "demo", seed: "abc", vehicleCount: 20000 });
    for (const n of ["0", "-5", "20001", "1.5", "lots"]) expect(read(`n=${n}`).mode === "demo" && read(`n=${n}`)).toMatchObject({ vehicleCount: 5000 });
  });

  it("switches to network mode only for a ws:// or wss:// URL", () => {
    expect(read("mode=network")).toEqual({ mode: "network", url: "ws://127.0.0.1:8787/stream" });
    expect(read("mode=network&ws=wss://fleet.example/stream")).toEqual({ mode: "network", url: "wss://fleet.example/stream" });
    expect(read("mode=network&ws=javascript:alert(1)")).toMatchObject({ mode: "demo" });
  });
});

import { describe, expect, it } from "vitest";
import type { Alert } from "@fleet/alerts";
import { alertStatus, alertText, announcement, lagosTime } from "../src/lib/alert-text";
import { PRESETS, decodeZones, encodeZones } from "../src/lib/zones";

// 21:30:00 UTC is 22:30:00 in Lagos (UTC+1, no daylight saving).
const T = Date.UTC(2026, 8, 30, 21, 30, 0);
const names = { plate: (id: number) => `KJA-${id}`, zone: (id: string | undefined) => (id === "b" ? "Third Mainland Bridge" : "a deleted zone") };
const alert = (over: Partial<Alert>): Alert => ({ id: 1, kind: "speeding", vehicleId: 7, raisedAt: T, lastRaisedAt: T, occurrences: 1, active: true, detail: 72, ...over });

describe("alert wording", () => {
  it("says what happened in one sentence, in Lagos time", () => {
    expect(lagosTime(T)).toBe("22:30:00");
    expect(alertText(alert({}), names)).toBe("KJA-7 speeding, up to 72 km/h");
    expect(alertText(alert({ kind: "zone-enter", zoneId: "b" }), names)).toBe("KJA-7 entered Third Mainland Bridge");
    expect(alertText(alert({ kind: "zone-exit", zoneId: "gone" }), names)).toBe("KJA-7 left a deleted zone");
    expect(alertText(alert({ kind: "offline", detail: T - 180_000 }), names)).toBe("KJA-7 not reporting since 22:27:00");
  });

  it("says where it stands", () => {
    expect(alertStatus(alert({}))).toBe("Active, raised 22:30:00");
    expect(alertStatus(alert({ active: false, clearedAt: T + 60_000, occurrences: 3, acknowledgedAt: T }))).toBe("Ended 22:31:00, raised 22:30:00, 3 times, acknowledged");
  });

  it("announces a burst as one sentence with the count and the latest", () => {
    expect(announcement([], names)).toBe("");
    expect(announcement([alert({})], names)).toBe("Alert: KJA-7 speeding, up to 72 km/h.");
    const burst = [alert({ id: 1 }), alert({ id: 2, vehicleId: 9, kind: "zone-enter", zoneId: "b", lastRaisedAt: T + 1000 }), alert({ id: 3, vehicleId: 4 })];
    expect(announcement(burst, names)).toBe("3 new alerts. Latest: KJA-9 entered Third Mainland Bridge.");
  });
});

describe("stored zones", () => {
  it("round-trip with their ids", () => {
    const zones = [{ ...PRESETS[0]!, id: "mine", name: "Bridge", alertOnExit: true }];
    expect(decodeZones(encodeZones(zones))).toEqual(zones);
  });

  it("fall back to the demo presets when missing or damaged, but keep a deliberately empty list", () => {
    expect(decodeZones(null)).toBe(PRESETS);
    expect(decodeZones("{not json")).toBe(PRESETS);
    expect(decodeZones(JSON.stringify({ type: "FeatureCollection", features: [{ type: "Feature", geometry: { type: "Point", coordinates: [3, 6] } }] }))).toBe(PRESETS);
    expect(decodeZones(encodeZones([]))).toEqual([]);
  });

  it("give duplicate or missing ids fresh ones, so two zones never share state in the engine", () => {
    const raw = JSON.parse(encodeZones([{ ...PRESETS[0]!, id: "same" }, { ...PRESETS[1]!, id: "same" }]));
    const ids = decodeZones(JSON.stringify(raw)).map((z) => z.id);
    expect(ids[0]).toBe("same");
    expect(ids[1]).not.toBe("same");
  });
});

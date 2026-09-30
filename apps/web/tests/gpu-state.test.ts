import { describe, expect, it } from "vitest";
import { FLOATS_PER_VEHICLE } from "@fleet/gl";
import type { RowsMessage } from "@fleet/transport";
import { FleetGpuState } from "../src/lib/gpu-state";

const rows = (epoch: number, slots: number[], newIds: number[], count: number): RowsMessage => ({
  type: "rows",
  epoch,
  serverTime: epoch + 5000,
  delayMs: 1400,
  count,
  slots: Uint32Array.from(slots),
  data: new Float32Array(slots.length * FLOATS_PER_VEHICLE).fill(1),
  newIds,
});

describe("FleetGpuState", () => {
  it("keeps every row that arrived before any layer was listening", () => {
    const state = new FleetGpuState(); // no layer yet: onChange is undefined
    state.apply(rows(1_000_000, [0, 1], [42, 7], 2), 0);
    state.apply(rows(1_000_000, [2], [99], 3), 100);
    let repaints = 0;
    state.onChange = () => repaints++; // the layer arrives late, as it does when the map loads after the Worker starts
    expect(state.slotIds).toEqual([42, 7, 99]);
    expect(state.mirror.count).toBe(3);
    expect(state.rowsReceived).toBe(3);
    state.apply(rows(1_000_000, [1], [], 3), 200);
    expect(repaints).toBe(1);
  });

  it("starts over when the Worker restarts with a new epoch", () => {
    const state = new FleetGpuState();
    state.apply(rows(1_000_000, [0, 1], [42, 7], 2), 0);
    state.apply(rows(2_000_000, [0], [5], 1), 100);
    expect(state.slotIds).toEqual([5]);
    expect(state.mirror.count).toBe(1);
    expect(state.epoch).toBe(2_000_000);
  });
});

describe("the alert texture", () => {
  it("marks alerting trucks by slot, including one whose alert arrived before its first rows", () => {
    const state = new FleetGpuState();
    state.apply(rows(1_000_000, [0, 1], [42, 7], 2), 0);
    state.setAlerting(new Set([7, 99])); // 99 has no slot yet
    let tex = state.alertTexture();
    expect([tex.data[0], tex.data[1], tex.data[2]]).toEqual([0, 255, 0]);
    expect(state.alertCount).toBe(1);
    const version = tex.version;
    expect(state.alertTexture().version).toBe(version); // nothing changed: no rebuild, no upload

    state.apply(rows(1_000_000, [2], [99], 3), 100);
    tex = state.alertTexture();
    expect(tex.data[2]).toBe(255);
    expect(tex.version).toBe(version + 1);
    expect(tex.data.length).toBe(tex.width * tex.height);
  });
});

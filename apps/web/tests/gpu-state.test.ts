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

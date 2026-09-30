import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { OFF, ON, UNKNOWN, debounced, step } from "../src";

describe("the debounced switch", () => {
  it("takes its first reading as given, without reporting a change", () => {
    const d = debounced(2);
    expect(step(d, 0, 0, true, false, 10_000, true)).toBe(0);
    expect(step(d, 1, 0, true, false, 10_000, false)).toBe(0);
    expect([d.state[0], d.state[1]]).toEqual([ON, OFF]);
  });

  it("switches only after the condition has held for the whole dwell, without a break", () => {
    const d = debounced(1);
    step(d, 0, 0, false, true, 10_000, false); // starts OFF
    expect(step(d, 0, 1_000, true, false, 10_000, false)).toBe(0); // run starts
    expect(step(d, 0, 10_999, true, false, 10_000, false)).toBe(0);
    expect(step(d, 0, 11_000, true, false, 10_000, false)).toBe(ON);
  });

  it("starts the dwell again when the run is broken, even for one reading", () => {
    const d = debounced(1);
    step(d, 0, 0, false, true, 10_000, false);
    step(d, 0, 1_000, true, false, 10_000, false);
    step(d, 0, 9_000, false, false, 10_000, false); // back into the band
    expect(step(d, 0, 12_000, true, false, 10_000, false)).toBe(0);
    expect(step(d, 0, 21_999, true, false, 10_000, false)).toBe(0);
    expect(step(d, 0, 22_000, true, false, 10_000, false)).toBe(ON);
  });

  it("switches at once with no dwell (the unfiltered rule the evaluation compares against)", () => {
    const d = debounced(1);
    step(d, 0, 0, false, true, 0, false);
    expect(step(d, 0, 100, true, false, 0, false)).toBe(ON);
    expect(step(d, 0, 200, false, true, 0, false)).toBe(OFF);
  });

  it("never switches while readings stay inside the band, however long", () => {
    fc.assert(
      fc.property(fc.boolean(), fc.array(fc.integer({ min: 1, max: 60_000 }), { maxLength: 200 }), (initial, gaps) => {
        const d = debounced(1);
        let t = 0;
        step(d, 0, t, false, false, 10_000, initial);
        for (const gap of gaps) expect(step(d, 0, (t += gap), false, false, 10_000, initial)).toBe(0);
        expect(d.state[0]).toBe(initial ? ON : OFF);
      }),
    );
  });

  it("alternates ON and OFF, and each switch follows an unbroken run of at least the dwell", () => {
    const reading = fc.record({ gap: fc.integer({ min: 100, max: 5_000 }), side: fc.constantFrom(-1, 0, 1) });
    fc.assert(
      fc.property(fc.array(reading, { maxLength: 300 }), (readings) => {
        const d = debounced(1);
        let t = 0;
        step(d, 0, t, false, true, 10_000, false);
        let last = OFF;
        let runSince = NaN;
        let runSide = 0;
        for (const { gap, side } of readings) {
          t += gap;
          const wantOn = last === OFF && side === 1;
          const wantOff = last === ON && side === -1;
          if (wantOn || wantOff) {
            if (runSide !== side) runSince = t;
            runSide = side;
          } else {
            runSide = 0;
          }
          const change = step(d, 0, t, side === 1, side === -1, 10_000, false);
          if (change !== 0) {
            expect(change).not.toBe(last);
            expect(t - runSince).toBeGreaterThanOrEqual(10_000);
            last = change;
            runSide = 0;
          }
          expect(d.state[0]).not.toBe(UNKNOWN);
        }
      }),
    );
  });
});

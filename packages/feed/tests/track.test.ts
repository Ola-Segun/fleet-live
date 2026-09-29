import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { PingFlag } from "@fleet/protocol";
import { haversine } from "@fleet/routes";
import { Feed, VehicleTrack, lerpHeading, raw, seqAfter, seqDiff, velocityAided, type SmoothInput } from "../src";
import { RAW_OPTIONS, T0, eastDeg, eastbound, frame } from "./helpers";

// ─── Sequence numbers ───────────────────────────────────────────────────────

describe("sequence numbers", () => {
  it("compare across the uint32 wrap", () => {
    expect(seqAfter(0, 0xffff_ffff)).toBe(true); // 0 comes after 4,294,967,295
    expect(seqAfter(0xffff_ffff, 0)).toBe(false);
    expect(seqDiff(5, 0xffff_fffe)).toBe(7);
    expect(seqAfter(10, 9)).toBe(true);
  });
});

// ─── Smoothing ──────────────────────────────────────────────────────────────

describe("velocity-aided smoothing", () => {
  const still = (xs: [number, number][]): SmoothInput[] => xs.map(([x, y], i) => ({ t: i * 30, x, y, vx: 0, vy: 0 }));

  it("with gain 1 is exactly the raw fixes", () => {
    const path = still([
      [0, 0],
      [3, -2],
      [-1, 4],
    ]);
    expect(velocityAided(1)(path)).toEqual(raw(path));
  });

  it("follows a truck exactly when its reported velocity is exact and its fixes are clean", () => {
    // 10 m/s east, fixes exactly where it is: the prediction is always right, so nothing lags.
    const path = Array.from({ length: 10 }, (_, i) => ({ t: i, x: 10 * i, y: 0, vx: 10, vy: 0 }));
    for (const [i, p] of velocityAided(0.2)(path).entries()) {
      expect(p.x).toBeCloseTo(10 * i, 9);
      expect(p.y).toBeCloseTo(0, 9);
    }
  });

  it("averages a parked truck's scatter down by √(k / (2 − k))", () => {
    // Deterministic ±4 m scatter (a noise-free check of the steady-state formula would need random input;
    // alternating ±σ has the same variance and an exact answer). At k = 0.2 the steady-state amplitude of
    // alternating input x, −x is k·x / (2 − k) = x / 9.
    const path = still(Array.from({ length: 200 }, (_, i): [number, number] => [i % 2 ? 4 : -4, 0]));
    const out = velocityAided(0.2)(path);
    expect(Math.abs(out.at(-1)!.x)).toBeCloseTo(4 / 9, 6);
  });

  it("refuses a gain outside (0, 1]", () => {
    expect(() => velocityAided(0)).toThrow(RangeError);
    expect(() => velocityAided(1.5)).toThrow(RangeError);
  });
});

// ─── One vehicle's track ────────────────────────────────────────────────────

describe("a vehicle track", () => {
  const track = () => new VehicleTrack(RAW_OPTIONS);

  it("keeps samples in sequence order whatever order they arrive in", () => {
    const t = track();
    for (const seq of [3, 1, 4, 0, 2]) t.insert(eastbound(seq), T0 + 10_000);
    expect(t.resolve().map((s) => s.seq)).toEqual([0, 1, 2, 3, 4]);
  });

  it("drops duplicates, keeping the earliest arrival", () => {
    const t = track();
    expect(t.insert(eastbound(0), T0 + 500)).toBe("added");
    expect(t.insert(eastbound(0), T0 + 300)).toBe("duplicate");
    expect(t.insert(eastbound(0), T0 + 900)).toBe("duplicate");
    expect(t.size).toBe(1);
    expect(t.resolve()[0]!.receivedAt).toBe(T0 + 300);
  });

  it("keeps a window of the newest 16, and refuses anything older once full", () => {
    const t = track();
    for (let seq = 0; seq < 20; seq++) t.insert(eastbound(seq), T0 + seq * 1000 + 150);
    expect(t.resolve().map((s) => s.seq)).toEqual(Array.from({ length: 16 }, (_, i) => i + 4));
    expect(t.insert(eastbound(2), T0 + 30_000)).toBe("too_old");
  });

  it("starts over when a tracker restarts and counts from 0 again", () => {
    const t = track();
    for (let seq = 1000; seq < 1005; seq++) t.insert(eastbound(seq), T0 + seq * 1000 + 150);
    expect(t.insert(eastbound(0, { deviceTime: T0 + 2_000_000 }), T0 + 2_000_150)).toBe("reset");
    expect(t.resolve().map((s) => s.seq)).toEqual([0]);
  });

  it("corrects a clock that is three minutes slow onto the server's clock", () => {
    const t = track();
    const SKEW = -180_000;
    const latencies = [310, 150, 220, 480, 160]; // the fastest delivery took 150 ms
    latencies.forEach((latency, seq) => t.insert(eastbound(seq, { deviceTime: T0 + seq * 1000 + SKEW }), T0 + seq * 1000 + latency));
    // offset = min(received − device) = 180,000 + 150, so corrected time = true time + 150 ms.
    expect(t.offset()).toBe(180_150);
    expect(t.resolve().map((s) => s.time)).toEqual([0, 1, 2, 3, 4].map((seq) => T0 + seq * 1000 + 150));
  });

  it("keeps the last good clock estimate when the window holds nothing but a coverage-gap backlog", () => {
    // A backlog is late by design, so it can never *lower* the minimum delay. It only matters once
    // the normal samples have been pushed out of the window and only backlog is left. Then its
    // huge delays must not be taken as the clock offset.
    const t = track();
    t.insert(eastbound(0), T0 + 200);
    expect(t.offset()).toBe(200);
    for (let seq = 1; seq <= 16; seq++) {
      t.insert(eastbound(seq, { flags: PingFlag.Ignition | PingFlag.Buffered }), T0 + 60_000);
    }
    expect(t.resolve().every((s) => s.flags & PingFlag.Buffered)).toBe(true);
    expect(t.offset()).toBe(200); // not 60,000 − 16,000 = 44,000
  });

  it("keeps sequence order when the tracker's clock steps backwards mid-stream", () => {
    // A time-server sync can step a device clock back. Sequence numbers still say the true order;
    // sorting by device time would put the post-sync samples first.
    const t = track();
    for (let seq = 0; seq < 6; seq++) {
      const stepBack = seq >= 3 ? -5000 : 0;
      t.insert(eastbound(seq, { deviceTime: T0 + seq * 1000 + stepBack }), T0 + seq * 1000 + 150);
    }
    expect(t.resolve().map((s) => s.seq)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  describe("estimating a position", () => {
    // Samples 0–4 with a correct clock and 100 ms fastest delivery: corrected time = T0 + seq s + 100 ms.
    const moving = () => {
      const t = track();
      for (let seq = 0; seq <= 4; seq++) t.insert(eastbound(seq), T0 + seq * 1000 + 100);
      return t;
    };
    const at = (seconds: number) => T0 + 100 + seconds * 1000;
    const metresEastOf = (lon: number) => (lon - 3.4) / eastDeg(1);

    it("interpolates between the two samples around the display time", () => {
      const e = moving().estimate(at(2.5))!;
      expect(e.mode).toBe("interpolated");
      expect(metresEastOf(e.lon)).toBeCloseTo(25, 6); // halfway from 20 m to 30 m
      expect(e.lat).toBeCloseTo(6.5, 9);
    });

    it("projects along the reported speed and heading for up to 5 s past the newest sample", () => {
      const e = moving().estimate(at(6))!; // newest is seq 4 at 40 m; 2 s × 10 m/s beyond it
      expect(e.mode).toBe("extrapolated");
      expect(metresEastOf(e.lon)).toBeCloseTo(60, 3);
      expect(e.ageMs).toBe(2000);
    });

    it("freezes where the projection stopped, then goes stale after 10 s of silence", () => {
      const holding = moving().estimate(at(12))!;
      expect(holding.mode).toBe("holding");
      expect(metresEastOf(holding.lon)).toBeCloseTo(90, 3); // 40 m + the 5 s limit × 10 m/s
      expect(moving().estimate(at(14.5))!.mode).toBe("stale");
    });

    it("shows a parked truck where it is, without projecting, and only calls it stale after 90 s", () => {
      const t = track();
      t.insert(eastbound(0, { speed: 0, flags: 0 }), T0 + 100);
      expect(t.estimate(T0 + 60_000)).toMatchObject({ mode: "parked", lon: 3.4 });
      expect(t.estimate(T0 + 100_000)!.mode).toBe("stale");
    });

    it("waits when the display time is before anything has been heard", () => {
      expect(moving().estimate(T0 - 5000)!.mode).toBe("waiting");
    });

    it("turns the short way round when interpolating heading", () => {
      expect(lerpHeading(350, 10, 0.5)).toBeCloseTo(0, 9);
      expect(lerpHeading(10, 350, 0.25)).toBeCloseTo(5, 9);
    });
  });
});

// ─── The guarantee ──────────────────────────────────────────────────────────

describe("order independence", () => {
  /** A clean, noisy eastbound track of `n` samples, each delivered 1–3 times at different moments. */
  const deliveries = fc
    .integer({ min: 2, max: 30 })
    .chain((n) =>
      fc.tuple(
        fc.array(fc.tuple(fc.double({ min: -5, max: 5, noNaN: true }), fc.double({ min: -5, max: 5, noNaN: true })), {
          minLength: n,
          maxLength: n,
        }),
        fc.array(fc.array(fc.integer({ min: 80, max: 4000 }), { minLength: 1, maxLength: 3 }), { minLength: n, maxLength: n }),
      ),
    )
    .map(([noise, delays]) =>
      noise.flatMap(([dx, dy], seq) => {
        const ping = eastbound(seq, { lat: 6.5 + dy / 111_195.08, lon: 3.4 + eastDeg(seq * 10 + dx) });
        return delays[seq]!.map((delay) => ({ ping, receivedAt: T0 + seq * 1000 + delay }));
      }),
    );

  it("gives the identical track for any arrival order and any duplication", () => {
    fc.assert(
      fc.property(deliveries, fc.infiniteStream(fc.nat()), (list, order) => {
        const reference = new VehicleTrack(RAW_OPTIONS);
        const shuffledTrack = new VehicleTrack({ ...RAW_OPTIONS, smoothing: velocityAided(0.2) });
        const referenceSmoothed = new VehicleTrack({ ...RAW_OPTIONS, smoothing: velocityAided(0.2) });

        const sorted = [...list].sort((a, b) => a.ping.seq - b.ping.seq || a.receivedAt - b.receivedAt);
        for (const d of sorted) {
          reference.insert(d.ping, d.receivedAt);
          referenceSmoothed.insert(d.ping, d.receivedAt);
        }
        // Fisher–Yates driven by fast-check's stream, so a failure shrinks to a minimal order.
        const shuffled = [...list];
        const keys = order.take(shuffled.length);
        let i = shuffled.length;
        for (const key of keys) {
          const j = key % i;
          i--;
          [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
        }
        for (const d of shuffled) shuffledTrack.insert(d.ping, d.receivedAt);

        expect(shuffledTrack.resolve()).toEqual(referenceSmoothed.resolve());
        for (const t of [T0 - 1000, T0 + 1234, T0 + 7777, T0 + 40_000]) {
          expect(shuffledTrack.estimate(t)).toEqual(referenceSmoothed.estimate(t));
        }
        expect(reference.size).toBe(Math.min(16, new Set(list.map((d) => d.ping.seq)).size));
      }),
      { numRuns: 300 },
    );
  });
});

// ─── The fleet feed ─────────────────────────────────────────────────────────

describe("the feed", () => {
  it("accounts for every ping: added + duplicates + too old = received", () => {
    const feed = new Feed(RAW_OPTIONS);
    feed.ingest(frame(0, T0 + 100, [eastbound(0), eastbound(1)]));
    feed.ingest(frame(1, T0 + 200, [eastbound(1), eastbound(0)]));
    const s = feed.stats;
    expect(s).toMatchObject({ pings: 4, added: 2, duplicates: 2, tooOld: 0 });
    expect(s.added + s.duplicates + s.tooOld).toBe(s.pings);
  });

  it("reports which vehicles changed since it was last asked, then forgets them", () => {
    const feed = new Feed(RAW_OPTIONS);
    feed.ingest(frame(0, T0 + 100, [eastbound(0), eastbound(0, { vehicleId: 2 })]));
    expect([...feed.drainChanged()].sort()).toEqual([1, 2]);
    feed.ingest(frame(1, T0 + 200, [eastbound(0)])); // a duplicate changes nothing
    expect(feed.drainChanged().size).toBe(0);
    feed.ingest(frame(2, T0 + 1200, [eastbound(1)]));
    expect([...feed.drainChanged()]).toEqual([1]);
  });

  it("counts frames it never received", () => {
    const feed = new Feed(RAW_OPTIONS);
    feed.ingest(frame(7, T0, []));
    feed.ingest(frame(10, T0 + 300, []));
    expect(feed.stats.framesMissed).toBe(2);
  });

  it("counts a sample that arrives already behind the display time", () => {
    const feed = new Feed(RAW_OPTIONS); // initial delay 2 s
    feed.ingest(frame(0, T0 + 100, [eastbound(0)]));
    feed.ingest(frame(1, T0 + 10_100, [eastbound(10)]));
    feed.ingest(frame(2, T0 + 10_200, [eastbound(5)])); // 5 s old on arrival, display time is ~8.2 s
    expect(feed.stats.lateForDisplay).toBe(1);
  });

  it("keeps the display delay at its initial value until it has 200 observations", () => {
    const feed = new Feed(RAW_OPTIONS);
    for (let seq = 0; seq < 50; seq++) feed.ingest(frame(seq, T0 + seq * 1000 + 150, [eastbound(seq)]));
    expect(feed.delayMs).toBe(RAW_OPTIONS.initialDelayMs);
  });

  it("settles the delay to lateness + interval, within its bounds", () => {
    const feed = new Feed(RAW_OPTIONS);
    // One truck at exactly 1 Hz with a steady 150 ms latency: p95 lateness is 0 (the minimum is the
    // offset), p95 interval is 1000 ms, so the delay should settle at 1000 ms, the floor.
    for (let seq = 0; seq < 400; seq++) feed.ingest(frame(seq, T0 + seq * 1000 + 150, [eastbound(seq)]));
    expect(feed.delayMs).toBe(1000);
  });

  it("jumps to the newest position after a coverage-gap burst instead of replaying the backlog", () => {
    const feed = new Feed(RAW_OPTIONS);
    let f = 0;
    for (let seq = 0; seq <= 10; seq++) feed.ingest(frame(f++, T0 + seq * 1000 + 150, [eastbound(seq)]));
    // Silence from seq 11 to 30, then all 20 delivered at once as the truck leaves the gap.
    const burst = Array.from({ length: 20 }, (_, i) =>
      eastbound(11 + i, { flags: i === 19 ? PingFlag.Ignition : PingFlag.Ignition | PingFlag.Buffered }),
    );
    const silentUntil = T0 + 30_150;
    const silentEstimate = feed.estimate(1, silentUntil - 2000);
    expect(silentEstimate?.mode).toBe("stale"); // 20 s of silence from a moving truck

    feed.ingest(frame(f++, silentUntil, burst));
    const after = feed.estimate(1, silentUntil - 2000)!;
    expect(after.mode).toBe("interpolated");
    // Display time is ~28 s: it shows the truck near 280 m east, not re-driving from 110 m.
    expect(haversine([after.lat, after.lon], [6.5, 3.4 + eastDeg(280)])).toBeLessThan(15);
    expect(feed.stats.lateForDisplay).toBeGreaterThanOrEqual(17);
  });
});


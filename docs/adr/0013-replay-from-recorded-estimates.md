# 0013 · Replay from recorded estimates, through the live renderer

**Status:** accepted, 30 Sep 2026 (Layer 9)

## Context

A dispatcher asks "what happened at 14:05?". Replay must rewind the whole
fleet, up to an hour, and play it back at up to 60×, without a second
renderer, a second list or a second details panel to keep in step with the
live ones.

The raw feed is about 5,000 pings a second: 18 million an hour, late,
duplicated and out of order. Replaying them would mean redoing Layer 4's
ordering, de-duplication and clock correction, for every scrub.

## Decision

1. **Record the feed's estimates, not the pings.** Every 5 s of display time
   the Worker records every truck's smoothed position, heading, speed and
   ignition: what the dispatcher saw at the time.
   - It's a ring of frames holding the last hour.
   - Positions are 16-bit Web Mercator offsets from the map origin (2.2 m
     steps), so 7 bytes per truck per frame: 25 MB an hour for 5,000 trucks.
   - Only fresh estimates are recorded. A truck that was stale gets no data
     in that frame, and replay shows it stale through the shader's own rules.
2. **Replay through the same messages as live.** The Worker packs each
   truck's recorded frames around the replay time into the same GPU rows, in
   the same texture layout, so the shader interpolates them exactly as it does
   live. The list and details panel get a snapshot computed from those rows
   with `slotEstimate`, the shader's algorithm in TypeScript. Nothing on the
   page knows it is replaying except the clock and the controls.
3. **Repack only when needed.** Each truck's packed frames stay valid for a
   span of replay time, and are packed again only when time leaves it.
   - A parked truck is packed up to the replay time only, so the shader
     draws it parked. It is refreshed every 45 s of replay time, half the
     shader's parked-stale limit.
4. **One clock, run twice.** The page sends "time *at*, at wall time *wall*,
   *speed*, playing or not". The page and the Worker each compute the replay
   time from that. Neither waits for the other, and scrubbing is local at
   once.
5. **Alerts stay live.** Replay shows the past; the alert list is about now.
   The panel says so while replaying.
6. **Not in the URL.** The history lives in the Worker for the session. A
   link to 14:05 would open onto a fleet with no 14:05. That needs
   server-side history.

## Measured

**Faithfulness** (`pnpm --filter @fleet/replay evaluate`): 2,000 trucks for
15 minutes from 09:00 Lagos time, default network chaos. The replayed
position is compared with the simulator's ground truth, as the shader
computes it, from the packed rows.

| Recording interval | Memory, 1 h of 5,000 trucks | Moving p50 / p95 / p99 | Parked p50 |
| --- | --- | --- | --- |
| Live map at the time (reference) | — | 2.2 / 4.4 / 5.4 m | 1.6 m |
| 2 s | 63 MB | 2.2 / 4.5 / 5.6 m | 1.8 m |
| **5 s (chosen)** | **25 MB** | **2.2 / 4.5 / 5.8 m** | **1.8 m** |
| 10 s | 13 MB | 2.3 / 5.4 / 12.8 m | 1.8 m |

At 5 s, replay is within 0.4 m of the live map at p99, for 40% of the memory
of 2 s. At 10 s the worst cases double: trucks cut corners between frames.

**In the browser** (`pnpm smoke:replay`): the positions the live map drew for
20 moving trucks were compared with where replay drew them at the same
moments. p50 0.9 m, p95 1.3–1.4 m, max 1.9 m, over three runs.

**Cost** (`pnpm --filter @fleet/replay bench`): 5,000 trucks, one run of 5
(min / median).

| | First version | Now |
| --- | --- | --- |
| Jump (repack every truck) | 57 / 74 ms | 11 / 20 ms |
| 60× playback, per 100 ms tick (about 930 trucks repacked) | 9.0 / 11.8 ms | 2.9 / 3.1 ms |
| Snapshot for the list | 33 / 49 ms | 26 / 37 ms |

Two changes brought the first two rows down:

- The first version walked each truck's whole run of data to find its
  window, up to the full hour. The scans are now bounded to the frames
  actually used.
- It also built sample objects and recomputed Mercator with a logarithm
  per sample. Frames now store Mercator offsets and pack straight into the
  float array.

The evaluation's numbers were identical before and after.

The snapshot stays at about 37 ms because it runs the shader's algorithm,
float32 emulation included, for every truck. That's the price of the list
agreeing exactly with the map. At 2 Hz it is about 7% of one Worker core
while replaying, and nothing on the main thread.

## Consequences

- Replay is only as fine as its frames. It interpolates between points 5 s
  apart, so a truck turning a tight corner is drawn cutting it (the p99).
- History starts when the page does. In demo mode, a reload restarts the
  fleet, so there is nothing to replay for the first 30 s.
- 25 MB of Worker memory for a full hour. A 10-hour history would need the
  10 s interval, or server-side storage.

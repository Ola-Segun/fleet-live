# 0012 · Alerts: evaluated in the Worker, on estimates, with a margin and a dwell

**Status:** accepted, 30 Sep 2026 (Layer 8b)

## Context

A dispatcher can't watch 5,000 trucks. The product has to say which ones need
attention: a truck in a restricted area, one that has gone silent, one that is
speeding. Three things make that harder than a plain `if`:

- **Positions scatter.** GPS error is metres (the simulator models σ = 4 m),
  and reported speed wobbles by about ±0.7 km/h. A truck parked by a zone's
  edge is "inside" and "outside" on alternate reports.
- **Reports arrive late, twice and out of order** (ADR 0010). An alert based on
  the raw stream would have to redo all of Layer 4's work.
- **Silence has two normal rates.** A tracker reports every second with the
  ignition on, and far less often with it off.

## Decision

1. **Evaluate in the Worker, twice a second, on the same display-time
   estimates the map draws.** Ordering, duplicates and clock offsets are
   already solved there, and an alert agrees with what the dispatcher sees.
   The engine reads the snapshot before it's transferred to the page.
2. **One debounced switch for every edge**
   (`packages/alerts/src/hysteresis.ts`):
   - A **band**: to switch on, a truck must be 20 m inside a zone (or over
     60 km/h). To switch off, it must be 20 m outside (or under 55 km/h).
   - A **dwell**: the condition must hold for 10 s without a break.
   - **First sight counts as given:** a truck already inside a new zone hasn't
     *entered* it.
   - **Stale trucks hold their state:** a guessed position starts no change.
3. **Offline is chosen by ignition, not by speed.** The threshold is 2 minutes
   when the last report had the ignition on, and 10 minutes when it was off.
4. **One open alert per truck, kind and zone.** A repeat raises the same alert
   again: its count goes up and any acknowledgement is cleared. The list can't
   fill with one truck's flapping. Past 500 open alerts, the oldest *ended*
   ones are resolved automatically. An active one never is.
5. **Resolve means "dealt with".** The alert leaves the list and isn't raised
   again while its condition still holds. Only a fresh occurrence raises a new
   one.

## Measured (`pnpm --filter @fleet/alerts evaluate`)

2,000 trucks, one hour from 22:30 Lagos time, default network chaos, scored
against the simulator's ground truth. It is compared with a naive engine that
sees the same data but has no band and no dwell.

| | Rules | Naive |
| --- | --- | --- |
| Speeding alerts, and how many were false | 97, **0 false** | 843, **270 false** |
| Real speeding (12 s or more) caught | 137 of 141 | 141 of 141 |
| Bridge entries caught, and false alerts | 40 of 40, 0 false | 40 of 40, 0 false |
| Zone edge running through a parking spot: alerts for 154 real crossings | **154** | **1,036** |
| Speeding alert delay, p50 / p95 | 10.2 s / 16.7 s | 0.2 s / 0.7 s |
| Bridge entry delay, p50 / p95 | 11.7 s / 12.2 s | 0.2 s / 0.6 s |

The naive engine catches everything, but a quarter of its speeding alerts
(270 of 843) are noise. The rules miss 4 speeding episodes, each of which
peaked at 63 km/h or less, within the report noise of the 60 km/h limit. A
truck hovering there dips under the limit before 10 s pass. That's the
trade-off chosen: no false alerts, at the cost of marginal cases and about
10 s of delay.

**Offline.** The first run caught 14 of 18 real silences. Both engines missed
the same 4. All four trucks were stopped in traffic with the engine running
when their trackers died. The feed calls a stopped truck "parked", so the
engine used the 10-minute rule for a tracker that had been reporting every
second. The threshold is now chosen by the ignition flag of the last report,
carried in the snapshot for this purpose. On the rerun, both engines catch
**18 of 18**, with no false alerts, each within a second of the 2-minute mark.
Every other number was identical, as a seeded simulator should make it.

## Cost (`pnpm --filter @fleet/alerts bench`)

Per evaluation of 5,000 trucks, in the Worker, twice a second. These are
medians of 5, over three runs, on the dev laptop (i7-10610U), which is noisy.
The spread is the range across the runs.

| Zones | Per evaluation |
| --- | --- |
| None (speeding and offline only) | 0.9–1.5 ms |
| The 2 presets | 1.3–2.6 ms |
| 10 zones | 2.5–4.4 ms |
| 1 zone at the importer's 5,000-vertex limit, round Apapa | 1.2–1.8 ms (was **34.5 ms** before the edge grid) |

The first geometry tested every edge for every truck near a zone. A grid
over the edges fixed that: the inside test casts its ray only against edges
in the point's row, and the distance test looks only at the 3 × 3 cells
around the point. The first version is kept in the tests as the reference,
and on 300 random star-shaped polygons with holes, the indexed version agrees
with it on the side of every point and on the distance within reach.

## Consequences

- The price of the rules is delay: a speeding alert arrives about 10 s after
  the speeding starts, and a zone entry about 12 s after the truck crosses.
  For a dispatcher that is immediate; for automatic enforcement it wouldn't be.
- The margin means a truck parked within 20 m of an edge never changes side.
  That's intended: it's the case GPS can't decide.
- The evaluation is only as honest as the simulator. Its noise model is
  Gaussian, and real GPS has multipath jumps of tens of metres near tall
  buildings. The 10 s dwell is the defence against those, and it isn't
  measured here.
- The engine's state is per-truck typed arrays, so memory grows with fleet
  size times zones: 9 bytes per truck per zone (a state byte and an 8-byte
  pending time), about 0.9 MB for 5,000 trucks and 20 zones.

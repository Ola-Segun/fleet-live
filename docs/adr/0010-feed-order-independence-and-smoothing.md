# 0010 · The feed is order-independent, and smoothing uses reported velocity

**Status:** accepted, 29 Sep 2026 (Layer 4)

## Context

The feed receives each truck's GPS updates late, twice, out of order, in
bursts after coverage gaps, from clocks that may be minutes wrong, with ±4 m of
position noise. The renderer needs one clean track per truck.

The design planned a one-euro filter for the noise.

## Decision

**1. The resolved track is a pure function of the set of samples in the window.**

- Ordered by device sequence number (serial-number arithmetic across the uint32
  wrap), never by time, so a clock that steps backwards can't scramble a path.
- Duplicates dropped, keeping the *earliest* arrival of each. Keeping "whichever
  was processed first" would let processing order leak into the clock
  estimate.
- Clock offset = the minimum of (arrival − device time) over the window,
  excluding coverage-gap backlogs.
- Smoothing recomputed from scratch over the window, not carried forward.
- The one exception: a window holding *only* backlog falls back to the last
  good offset, which is state carried between windows.

**2. Late samples are kept, not dropped.** A sample that arrives behind the
display time is inserted and counted (`lateForDisplay`), and the renderer
blends the correction. Dropping it would make the track depend on arrival
timing and break (1).

**3. Smoothing is velocity-aided, not a one-euro filter.** Each position is
predicted from the previous estimate plus the device's reported velocity, then
moved a fraction k = 0.2 of the way towards the new fix.

## Measurements

From `pnpm --filter @fleet/feed evaluate`: 300 trucks, 08:00 Lagos, default
network chaos, 10 minutes. Errors are metres from ground truth at the display
time.

| Smoother | Moving p50 / p95 | Parked p50 / p95 |
| --- | --- | --- |
| Raw GPS | 4.0 / 8.7 | 4.5 / 9.3 |
| One-euro, best balanced (min 0.002 Hz, β 0.05) | 4.4 / 9.0 | 3.5 / 7.4 |
| **Velocity-aided, k = 0.2** | **2.0 / 4.1** | **1.7 / 3.5** |

The one-euro filter lost for two reasons:
- **Moving trucks.** At one update a second, any smoothing strong enough to cut
  the noise also lags. The strongest settings lagged by 90 m.
- **Parked trucks.** They report every 30 s, and a time-based low-pass lets
  almost everything through across a 30-second gap.

The parked result matches theory. With exact velocity, the steady-state error
per axis is σ·√(k / (2 − k)) = 4 × 0.333 = 1.33 m, or about 1.67 m as a
distance. Measured: 1.7 m.

## Consequences

- Order independence is tested as a property (300 random feeds) and at fleet
  scale (every delivery from a chaotic simulation processed in random order,
  then compared).
- **The gain depends on reported velocity being good.** The simulator reports
  the exact road bearing. Real GPS course over ground is noisy at low speed, so
  real-world gains will be smaller than the table. This is stated wherever the
  numbers appear.
- The one-euro filter stays in `packages/feed/scripts/` as the measured
  alternative, not in the package.

# 0008 · Routes are generated once and committed

**Status:** accepted, 29 Sep 2026 (Layer 2)

## Context

The simulator needs trucks to drive on real roads, or the map exposes them
cutting through buildings and the lagoon. Real road routes need a router, and
the only free one, the OSRM demo server, allows at most 1 request per second,
reasonable non-commercial use only, and promises no uptime.

## Decision

`packages/routes/scripts/generate.ts` asks OSRM once for a route between every
*ordered* pair of 25 Lagos freight places (600 routes, both directions). It runs sequentially at ≤1 request
per second, caches raw responses, simplifies the geometry, validates the result,
and writes `packages/routes/data/lagos-routes.json`, which is committed. Nothing
else ever calls OSRM: not the app, not CI, not the tests.

## Consequences

- Every test, demo and CI run sees exactly the same roads. No network, no quota,
  no flakiness.
- The data is a snapshot of OpenStreetMap. It is attributed and licensed ODbL-1.0
  inside the file itself.
- **OSRM's durations are free-flow car speeds** (median average 70 km/h across the
  first 300 routes), not Lagos truck traffic. The data is kept as a free-flow reference,
  and the simulator (Layer 3) applies a truck speed cap and congestion on top.
  Rewriting the source data to look realistic would hide that assumption.
- Adding a place means rerunning the script. Cached pairs cost nothing, so only the
  new place's 48 routes are fetched.
- **Revised in Layer 3: routes are directed.** The first version fetched 300
  unordered pairs. The simulator needs a truck to leave wherever it arrives, and
  reversing A → B's geometry to get B → A ignores one-way streets. Measured: in
  148 of 300 pairs the two directions differ in length by more than 5%
  (Amuwo Odofin → Surulere is 16.9 km, the way back 10.1 km). All 600 directed
  routes are now fetched.

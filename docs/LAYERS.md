# Build log, layer by layer

Each layer is finished, tested and explained before the next one starts.
The design is in [../DESIGN.md](../DESIGN.md).

Every layer answers three questions: **why it exists**, what it does, and
how it's engineered and proved.

| # | Layer | Why it exists | Status |
| --- | --- | --- | --- |
| 1 | Workspace + wire protocol (`packages/protocol`) | Every other layer speaks it, so the contract comes first | **Done** |
| 2 | Route data (`packages/routes`) | Trucks must drive on the same roads the map draws, from data that never changes under a test | **Done** |
| 3 | Seeded simulator + chaos layer (`packages/sim`) | A repeatable fleet that misbehaves on purpose, so every bug can be reproduced | **Done** |
| 4 | The feed: ordering, clocks, smoothing (`packages/feed`) | Turns a messy feed into a clean one; the correctness core | **Done** |
| 5 | Transport Worker + socket server | Keeps 5,000 updates a second off the main thread | Next |
| 6 | Next.js shell + MapLibre base map | The frame everything visible sits in | |
| 7 | WebGL2 vehicle layer | Draws 5,000 moving trucks smoothly, in one draw call | |
| 8 | Product UI | What a dispatcher actually uses: search, drawer, list, alerts, geofences | |
| 9 | Replay | Answers "what happened at 14:05?" using the same renderer | |
| 10 | Quality gates and ship | Proves all of the above in CI, then publishes it | |

---

## Layer 1 · Workspace and wire protocol

**Why this layer exists, and why it's first**

- **Everything else depends on the shape of a GPS update.** The simulator
  produces them, the socket server sends them, the Worker decodes and orders
  them, the renderer draws them, and the tests generate them. If that shape is
  settled first, each later layer can be built and tested on its own against a
  fixed contract. A wire format changed late breaks every one of them at once.
- **The volume forces a binary format.** 5,000 trucks at one update a second is
  5,000 messages a second. As JSON, each one is 127 bytes of text to parse into
  a fresh object. As binary it is 25 bytes read at fixed offsets. Batching into
  10 frames a second cuts 5,000 socket events a second to 10, which matters
  because each event costs the receiving thread a wake-up.
- **Later tests need exact values.** Layer 4 must prove that shuffled or
  duplicated input gives *identical* output. That is only testable if a
  position means exactly one number everywhere, which is what whole-number
  microdegrees and `quantize()` guarantee. With floats, the same position could
  differ in the last digit between server and browser, and "identical" would
  become "close enough", which a property test can't check cleanly.
- **It's a separate package because it runs in two places:** Node, for the
  socket server, and the browser Worker. It imports nothing from either, so both
  can use it unchanged.
- **Without it:** each layer would invent its own message shape, the simulator
  and the Worker would drift apart, and the first sign would be trucks in the
  wrong place with no failing test to point at why.

**What exists**

- A pnpm workspace (`apps/*`, `packages/*`), TypeScript strict with
  `noUncheckedIndexedAccess`, and Vitest at the root.
- `packages/protocol`: `encodeFrame`, `decodeFrame`, `quantize`, and the types
  every later layer shares. Decisions are in [ADR 0003](adr/0003-binary-protocol.md).

**How it is engineered**

| Choice | Why |
| --- | --- |
| Explicit little-endian on every `DataView` call | The layout is a contract. It must not depend on the platform |
| Positions as int32 microdegrees | Exact integers on the wire. `quantize()` predicts the decoded value, so later layers never compare a float with its rounded copy |
| `+ 0` after `Math.round` | `Math.round(-0.4)` is `-0`. A decoded int32 never is, so without it a round trip would change the value under `Object.is` |
| Headings wrap at 36,000 centidegrees | 359.996° rounds to north (0), not to an impossible 360.00° |
| `DataView(buffer, byteOffset, byteLength)` | A Node `Buffer` from `ws` is usually a slice of a shared pool. Ignoring the offset reads a neighbouring message |
| Decode validates lengths and ranges and never throws | It reads the network. A corrupt frame fails at the boundary with a named error |

**How it is tested:** 16 tests.

- **Hand-computed bytes.** The expected bytes were worked out from the layout,
  not captured from the code, for example 6.5° → 6,500,000 = `0x00632EA0` →
  `A0 2E 63 00`. A test written from the output would only prove the code is
  deterministic.
- **Property-based (fast-check).** Any valid frame round-trips to exactly
  `quantize()`'s prediction. Quantisation error stays within half a unit.
  `quantize` is idempotent. Random bytes never make `decodeFrame` throw.
- **Every truncation is rejected**, trailing bytes are rejected, and each error
  code has a case.
- **The suite was mutation-checked.** Three deliberate bugs were introduced, one
  at a time: ignoring `byteOffset`, dropping the `-0` guard, and writing one
  field big-endian. Each one failed the suite, and the code was then restored.

**Found while building:** a property written as
`(p) => expect(...).toEqual(...)` fails in fast-check, because the arrow returns
the assertion's value and fast-check treats a falsy return as a failed
property. Properties use block bodies.

**Run it:** `pnpm install`, `pnpm typecheck`, `pnpm test`.

---

## Layer 2 · Route data

**Why this layer exists**

- **Trucks have to be on roads.** The base map draws Lagos's real streets. A
  simulated truck moving in a straight line between two points would cross
  buildings and the lagoon, and anyone watching the demo would see the fleet is
  fake in the first second.
- **Why generate once, not route at runtime.** The only free router, the OSRM
  demo server, allows at most 1 request per second, non-commercial use only, and
  promises no uptime. A public demo that routed live would break the day that
  server went down, and it would break the usage policy on day one. See
  [ADR 0008](adr/0008-routes-generated-once.md).
- **Why before the simulator.** The simulator's whole job is to move trucks
  along paths at believable speeds. Without fixed paths it has nothing to
  simulate, and its tests would have nothing stable to assert against.
- **Why committed data makes testing possible.** The same file means the same
  roads in every test, demo and CI run: no network, no quota, no flakiness.
  Layer 3's seeded simulator is only repeatable if its inputs are too.

**What exists**

- `packages/routes`. The design sketched `data/routes/` at the root. The data
  lives inside the package instead, so consumers import it as
  `@fleet/routes/data/lagos-routes.json` with a version, like any dependency.
- **25 freight places:** 3 ports, 5 industrial estates, 4 markets and 13
  districts. All **600 ordered pairs** are routed, one route in each direction
  (revised in Layer 3, see below).
- **Pure helpers** the simulator will reuse: polyline encode/decode, haversine
  distance, a flat-metres projection, distance to a segment, and time-preserving
  simplification.
- `scripts/generate.ts` and its committed output, **1,297 KiB (371 KiB
  gzipped)**, 23,010 km of road.

**How it is engineered**

| Choice | Why |
| --- | --- |
| Strictly sequential, request *starts* spaced ≥1.1 s, identifying User-Agent | The policy is ≤1 request per second. Spacing starts rather than gaps keeps it under the limit even when responses are fast |
| Retry only network errors, 429 and 5xx, with backoff | A 4xx, or a 200 whose body says `NoRoute`, fails the same way every time. The first draft retried those too, which review caught before the first run |
| Raw responses cached in `.cache/` (gitignored) | A rerun after a bug fix costs zero requests. Only new pairs are fetched |
| **Road-snap check: fail if a place is over 500 m from any road** | The place coordinates are approximate, from memory. OSRM reports how far it moved each point to reach a road. A place in the lagoon would snap far away, so this catches a wrong coordinate instead of trusting it. **Worst snap: Lekki Deep Sea Port, 119 m** |
| Douglas–Peucker at 1.5 m that **carries durations** | OSRM puts a vertex at every bend. Simplifying removed **58.2% of points** (377,424 → 157,730). When points are dropped, their segments' durations are summed, so total driving time is conserved exactly and slow stretches stay slow |
| Iterative, not recursive, simplification | A long route has thousands of points, and recursion depth would scale with them |
| Durations stored as integer deciseconds | Compact, exact, and validated as integers |
| Integer-delta polyline encoding | Deltas are taken between integers, never floats, so encode → decode → encode is exact |
| `validateDataset()` returns *every* problem | The generator refuses to write an invalid file, and the test suite runs the same check against the committed one |
| `parseDataset(json: unknown)` is the only typed way in | A JSON import widens `[lat, lon]` to `number[]`, so the compiler can't vouch for the file. A cast would only silence it. The shape is checked at runtime instead, and the simulator will load the data through this function |

**How it is tested:** 19 tests.

- **Against published answers, not the code's own output.** The polyline
  decoder must match Google's documented example (three points, starting at
  38.5, −120.2) and encode it back to the same string. One degree of latitude
  must measure πR/180 = **111,195.08 m**.
- **Property-based.** Any path round-trips through polyline6 to the
  microdegree. Simplification conserves total time, keeps both ends, keeps
  points in order, and **every dropped point lies within 1.5 m of the segment
  that replaced it**. That last one is the algorithm's actual promise, so it is
  tested directly.
- **The validator is tested both ways:** a good dataset passes, and each of six
  corruptions is reported by name.
- **The committed file is tested.** 600 routes, every one decodes, the counts
  match, every point is inside Lagos, and every average speed is plausible.
- **The suite was mutation-checked.** Three deliberate bugs were introduced, one
  at a time: dropping the time of removed points instead of summing it,
  simplifying 100× too aggressively, and flipping the polyline sign. Each one
  failed the suite, and the code was restored.

**Sanity check of the real data** (beyond validation, measured on the first 300 routes):

| Measure | Min | Median | Max |
| --- | --- | --- | --- |
| Route length | 2.2 km | 28.7 km | 141.5 km |
| Detour (road ÷ straight line) | 1.03× | 1.33× | 3.22× |
| Average speed | 32 km/h | **70 km/h** | 82 km/h |

- The biggest detours are real geography. Ikorodu → Ajah is 3.22×, because the
  lagoon sits between them. Apapa → Tin Can is 2.85× over 6 km of port access
  roads.
- **Found while building: OSRM's speeds are free-flow car speeds.** No truck
  averages 70 km/h across Lagos. The data is left as an honest free-flow
  reference, and **Layer 3 must apply a truck speed cap and congestion**,
  including the Apapa go-slow. This is recorded in ADR 0008 so the assumption
  can't disappear.

- **Found while building: a JSON import loses tuple types.** The typecheck
  refused to treat the committed file as a `RouteDataset`. Rather than cast
  through `unknown`, `parseDataset` now checks place coordinates at runtime.
  Casting would have made the compiler agree without making the data safe.

- **Revised in Layer 3: routes are directed.** The first version fetched 300
  unordered pairs. The simulator has to send a truck on from wherever it
  arrives, and Badagry, for one, only ever appeared as a destination. Reversing
  a route's geometry would ignore one-way streets, and measurement showed it
  matters: **in 148 of 300 pairs the two directions differ in length by more
  than 5%**. Amuwo Odofin → Surulere is 16.9 km, and the way back is 10.1 km.
  All 600 directed routes are now fetched. The cache made it 300 new requests,
  not 600.

**Run it:** `pnpm test` uses the committed data.
`pnpm --filter @fleet/routes generate` regenerates it, and should only be run
deliberately.

---

## Layer 3 · Seeded simulator and chaos layer

**Why this layer exists**

- **Every later bug has to be reproducible.** The layers after this one exist
  to cope with a messy feed, and their bugs will look like "that truck jumped
  backward once". That can only be fixed if it can be made to happen again. A
  seed makes the same fleet, the same traffic and the same network misbehaviour
  every run, byte for byte.
- **The ordering code needs something to prove itself against.** Layer 4's job
  is to turn duplicated, reordered, late and missing updates into a clean
  stream. That can only be tested against a feed that does all of those things
  on purpose, one knob at a time.
- **The trucks have to be believable.** Layer 2 found OSRM's speeds are
  free-flow car speeds (median 70 km/h). This layer adds the truck cap, the
  rush hours and the Apapa go-slow that real Lagos freight lives with.
- **Ground truth.** The simulator knows where every truck *really* is, as well
  as what its tracker reported. Layer 4 can then measure its error against
  reality instead of against itself.
- **Why it's a separate package:** it runs in two places. The Node socket
  server uses it in network mode, and a browser Worker uses it in demo mode.
  It imports nothing from either.

**What exists**

`packages/sim`: a fleet of trucks, their trackers, and the network between
them, advanced in fixed 100 ms steps of simulated time, emitting 10 Hz frames
in the Layer 1 wire format.

| Part | What it does |
| --- | --- |
| `random.ts` | sfc32 seeded through splitmix32, with **named streams forked from the seed** ([ADR 0009](adr/0009-seeded-simulation-named-streams.md)) |
| `network.ts` | Routes as shared typed arrays (lat, lon, cumulative metres, per-segment free-flow speed and heading), position along a path, binary-search segment lookup |
| `traffic.ts` | 55 km/h truck cap, a Lagos time-of-day curve (UTC+1), and four congestion zones: Apapa go-slow (stop-and-go), Oshodi, Ojota–Mile 12, Berger |
| `vehicle.ts` | Truck motion (acceleration 0.6 m/s², braking 1.5 m/s², stops, loading 10–40 min, departing on a real route out of its destination) and its tracker (1 Hz moving, every 30 s parked, 4 m GPS noise, clock skew, coverage gaps with backlog bursts) |
| `chaos.ts` | The mobile network: latency, exponential jitter, duplicates (as retries), drops, held-back pings that arrive after later ones. A binary min-heap orders deliveries |
| `simulation.ts` | Ties it together; exposes `advance(ms) → Frame[]`, `truth(id)`, `info()` |
| `scripts/bench.ts` | Cost per simulated second, 5 runs, min and median |

**How it is engineered**

| Choice | Why |
| --- | --- |
| **Named random streams, forked from the seed** | One shared stream makes every change ripple through every later draw. With `vehicle:<id>:motion`, `…:device`, `…:identity`, `zones` and `chaos` forked separately, turning the chaos up never changes where a truck drives, and adding trucks never changes the existing ones. Both are tested |
| No wall clock anywhere | Simulated time advances in fixed steps. A test runs an hour of Lagos in about a second, and real time is only a matter of pacing |
| The truck and its tracker are separate | The truck knows where it is (`truth`). The tracker adds GPS noise, a skewed clock and silence in coverage gaps. The dispatcher only ever sees the tracker |
| The network is its own stage | Devices *send*, the server *receives* what has arrived by a time. Each misbehaviour is one knob (`NO_CHAOS` turns all of them off), so a test can isolate exactly one |
| Duplicates arrive 0.3–2 s late | A mobile retry resends after giving up on an acknowledgement, so a duplicate is not an instant copy. A realistic duplicate is harder to handle than an adjacent one |
| Coverage gaps buffer on the device | Inside a gap the tracker records and sends nothing. On the way out it sends the whole backlog at once, flagged `Buffered`. That burst is what Layer 4's "skip forward, don't replay the backlog" rule exists for |
| Parked trucks report every 30 s | Real trackers save data this way. It also means Layer 8's "offline for 2 minutes" alert must not fire for a parked truck, and the simulator will tell us if it does |
| Frames are sent even when empty | A steady 10 Hz is how a client tells "nothing moved" from "the connection is dead" |
| **Discrete-time braking** | The stopping distance from v, updating speed and then position in steps of dt, is v²/2a + v·dt/2, not v²/2a. Comfortable braking chases the cruising speed, then a hard limit keeps the truck able to stop. See "found while building" |
| **Three measured optimisations** | Headings precomputed per segment instead of per step. The last step's position reused instead of recomputed. A flat, squared distance for zone checks instead of haversine, which a property test holds to the great-circle distance within 0.1% |

**How it is tested:** 31 tests, 66 across the workspace.

- **Hand-computed motion.** On a synthetic 1 km straight road at 03:00, a truck
  from rest after 5 s is doing exactly 3.0 m/s and has covered exactly **7.65 m**
  (Σ 0.06k × 0.1 for k = 1…50). Bearings are checked against the compass
  points, the day curve at its knots and midpoints (7:15 → 0.475), and Lagos
  time as UTC+1.
- **Properties.** The target speed never exceeds the cap or goes negative for
  any input. The flat distance agrees with haversine except within 0.1% of the
  edge. On every braking step the truck is no faster than it could still stop
  from.
- **The tracker.** One report a second moving, one every 30 s parked, with
  consecutive sequence numbers. A coverage gap produces silence, then a
  `Buffered` burst with nothing lost. A skewed clock is consistently wrong. GPS
  errors average **5.0 m** for σ = 4 m per axis, matching the theoretical
  σ√(π/2) ≈ 5.01 m.
- **The network.** No chaos means every ping once, in order. Nothing arrives
  before its latency. Drop and duplicate rates land at their configured values.
  Held-back pings cause inversions, with nothing lost.
- **The whole fleet.**
  - 600 frames a minute with consecutive numbers.
  - Byte-identical output for a seed, different output for another.
  - Identical truck movement under a perfect and an awful network.
  - Existing trucks unchanged when the fleet grows.
  - Every frame survives the Layer 1 wire format.
  - Duplicates, inversions and gaps all actually occur in the feed.
- **Realism check.** The median moving speed is **24.6 km/h at 08:00** and
  **55.0 km/h at 03:00**. The night figure is the truck cap, which binds on
  empty roads. These are the model's assumptions, not measured Lagos traffic.
- **The suite was mutation-checked.** Five deliberate bugs were introduced, one
  at a time. The first pass caught four:
  1. forking streams from the current state instead of the seed
  2. applying the cap before the driver factor
  3. discarding a gap's backlog
  4. removing the stopping limit
  5. using the continuous braking formula

  **The cap-order bug survived at first.** The property test almost never
  generated its narrow trigger (night, no zone, driver factor above 1). A named
  example now pins that case, and all five fail the suite.

**Performance** (`pnpm --filter @fleet/sim bench`, Intel i7-10610U laptop, Node 22):

| Fleet | Per simulated second, min | Median | Pings/s delivered |
| --- | --- | --- | --- |
| 1,000 trucks | 6.1 ms | 6.6 ms | 870 |
| 5,000 trucks | 51.1 ms | 56.9 ms | 4,312 |

5,000 trucks in real time cost about 5–6% of one core here. That leaves the
browser Worker room for Layer 4's work in demo mode.

**Found while building**

1. **The routes had to be directed** (see the Layer 2 revision above). A truck
   arriving at Badagry had no real way out, and the reverse geometry is often a
   different road entirely.
2. **Braking was one step late.** A new assertion ("never faster than it could
   still stop") failed on the untouched code. The truck ran about 0.15–0.2 m/s
   above the stopping curve and reached the kerb at 1.4 m/s, where it was
   snapped to zero. The cause was using the continuous stopping distance in a
   discrete simulation, and chasing the limit with comfortable braking only.
   The fix: the discrete formula, plus a hard limit that brakes harder when it
   has to. The truck now creeps the last centimetres.
3. **A speed-limit bug hid in a property test's blind spot.** A heavy-footed
   driver could exceed 55 km/h, but only at night, outside every zone. Random
   inputs rarely hit that combination, so it now has a named example. Property
   tests find what they are likely to generate, and nothing else.
4. **A single benchmark run on a laptop is not a measurement.** Identical code
   measured 51, 100 and 69 ms in a row. An earlier "102 → 47.6 ms, 2.1× faster"
   compared two single runs, so it has been withdrawn. The optimisations remove
   work by construction, but no speed-up factor is claimed. The benchmark now
   runs 5 times and reports the minimum and median.
5. **A comment overclaimed.** It said linear interpolation in degrees was
   accurate to "far below a millimetre". Simplification leaves straight
   segments kilometres long, where a 5 km straight differs by **5.6 cm**
   (measured). The comment now says centimetres.

**Run it:** `pnpm test`, and `pnpm --filter @fleet/sim bench`.

---

## Layer 4 · The feed: ordering, clocks and smoothing

**Why this layer exists**

- **It's where the project proves it can handle a messy feed.** Layer 3
  deliberately delivers duplicates, updates out of order, bursts after coverage
  gaps, skewed clocks and GPS noise. This layer turns that into one clean track
  per truck. Without it, the renderer would have to reason about the network,
  and every visual glitch would be a mix of two problems.
- **The central guarantee is testable.** The track depends only on *which*
  updates arrived, never on the order or how many times. That's the same
  discipline as payment code that must survive duplicate or out-of-order
  events, and here it's proved as a property, not asserted in a comment.
- **Rendering in the past needs someone to choose how far.** The display delay
  must cover both how late updates arrive and the gap between them, so there's
  usually a known point on both sides of the display time. This layer measures
  that and adapts.
- **It's measured against reality.** The simulator knows where every truck
  really was, so accuracy is a number. That number overturned the design's
  planned filter.
- **Why it's before the Worker and renderer:** it's pure logic with no I/O, so
  it can be proven in isolation. Layer 5 wraps it in a Worker, and Layer 7's
  shader must agree with its `estimate()`, which is the reference
  implementation.

**What exists**

`packages/feed`:

| Part | What it does |
| --- | --- |
| `seq.ts` | Sequence-number comparison across the uint32 wrap (RFC 1982 serial arithmetic) |
| `track.ts` | One truck: a 16-sample window by sequence number, duplicate removal, tracker-restart detection, clock offset, lazy smoothing, and `estimate(displayTime)`, which is interpolated, extrapolated (≤5 s), holding, parked, stale or waiting |
| `smoothing.ts` | The velocity-aided smoother (default gain 0.2) and a `raw` baseline. Smoothers are pluggable pure functions |
| `feed.ts` | The fleet: routes frames to tracks, accounts for every ping, counts missed frames and late-for-display samples, and adapts the display delay |
| `scripts/evaluate.ts` | Ground-truth evaluation and smoothing comparison |
| `scripts/bench.ts` | Cost of ingest, and of ingest plus reading every truck at 10 Hz |
| `scripts/one-euro.ts` | The design's planned filter, kept only as the measured alternative |

**How it is engineered**

| Choice | Why |
| --- | --- |
| **Order by sequence number, not time** | The device assigns sequence numbers, so a clock that steps backwards (a time-server sync, say) can't scramble a path. Tested with exactly that scenario |
| **Duplicates keep the earliest arrival** | Found while designing the property test. The clock offset is built from arrival times, so keeping "whichever copy was processed first" would leak processing order into the result. The earliest arrival depends only on the set |
| **Clock offset = minimum delay over the window** | The fastest delivery is the best estimate of the clock difference. Minutes of skew are corrected (tested at −3 min). It depends only on the window's contents |
| **Backlog excluded from the clock estimate** | A coverage-gap backlog is late by design. It can never *lower* the minimum, but a window of nothing *but* backlog would otherwise report a huge offset, so that case falls back to the last good estimate |
| **Late samples kept, not dropped** | Dropping samples that arrive behind the display time would make the track depend on arrival timing. They're kept, counted (`lateForDisplay`), and Layer 7 blends the correction |
| **Smoothing recomputed over the window** | A stateful filter fed in arrival order would break order independence. Recomputing from the oldest sample makes smoothing a pure function of the window |
| **Velocity-aided smoothing, not the planned one-euro filter** | Measured below. The tracker's reported speed and heading are far more precise than its position, and using them halves the error |
| **Smoothing is lazy** | Ingest records timing only. Smoothing runs when something reads the track, so a burst of updates for one truck costs one re-smooth, not one per update |
| **Adaptive delay = p95 lateness + p95 interval, clamped 1–5 s** | It covers both reasons a sample may not be there yet. Backlogs are excluded, or one tunnel would slow everyone's display |
| **Stale thresholds depend on state** | Moving trucks report every second, so 10 s of silence is stale. Parked trucks report every 30 s, so stale waits 90 s. One threshold would flag every parked truck or miss real outages |

**How it is tested:** 28 tests, 94 across the workspace.

- **The guarantee, as a property.** 300 random feeds, each sample delivered 1–3
  times at different moments and processed in a random order, must give a track
  (order, corrected times, smoothed positions, and estimates at several times)
  identical to in-order processing.
- **The guarantee at fleet scale.** Every delivery from 2 minutes of a chaotic
  60-truck simulation is shuffled and processed out of order, and all 60 tracks
  must be identical to in-order processing.
- **Hand-computed behaviour.**
  - Interpolation halfway gives 25 m.
  - Extrapolation for 2 s at 10 m/s gives 60 m.
  - It holds at 90 m (the 5 s cap) and goes stale after 10 s.
  - Parked trucks aren't projected, and go stale after 90 s.
  - A clock 3 min slow corrects to within the fastest delivery (150 ms).
  - Headings turn the short way round.
- **Smoothing checked against its own mathematics.**
  - Gain 1 equals raw.
  - Exact velocity with clean fixes tracks exactly, with no lag.
  - Alternating ±4 m settles at 4/9 m, the exact steady state for k = 0.2.
- **The feed.**
  - Every ping is accounted for (added + duplicates + too old = received).
  - Missed frames are counted.
  - A coverage-gap burst jumps to the newest position instead of replaying the
    backlog.
  - The delay settles to its floor on a clean 1 Hz feed.
- **The suite was mutation-checked.** Six deliberate bugs were introduced, one
  at a time:
  1. keeping the first-processed duplicate
  2. taking the clock offset from the newest sample
  3. counting backlog in the clock offset
  4. smoothing that ignores velocity
  5. no extrapolation cap
  6. ordering by device time

  **The first pass caught four.** Two tests were then strengthened:
  - The "ignores backlog" test couldn't fail, because backlog never lowers a
    minimum. It now tests the all-backlog window, which is where the rule
    matters.
  - Ordering by device time survived because a steady clock agrees with
    sequence order. A clock-steps-backwards test now separates them.

  All six now fail the suite.

**Measured against ground truth** (`pnpm --filter @fleet/feed evaluate`: 300
trucks, 08:00 Lagos, default network chaos, 10 min). Errors are metres from
where the truck really was at the display time:

| Smoother | Moving p50 / p95 | Parked p50 / p95 |
| --- | --- | --- |
| Raw GPS | 4.0 / 8.7 | 4.5 / 9.3 |
| One-euro, best balanced setting | 4.4 / 9.0 | 3.5 / 7.4 |
| One-euro, other settings | worse on moving (lag up to 90 m) or on parked | |
| Velocity-aided k = 0.1 | 2.0 / 4.0 | 1.8 / 4.2 |
| **Velocity-aided k = 0.2 (default)** | **2.0 / 4.1** | **1.7 / 3.5** |
| Velocity-aided k = 0.5 | 2.8 / 5.8 | 2.7 / 5.4 |

- Moving trucks are **interpolated 96.9% of the time** under chaos (99.3% with
  none), extrapolated 2.4%, holding or stale 0.7%.
- The delay settled at **1.4 s** under chaos (1.1 s with none). 5,163
  duplicates were removed and 1.9% of samples arrived late for display.
- The parked result matches theory: σ·√(k/(2−k)) = 1.33 m per axis ≈ 1.67 m as
  a distance; measured 1.7 m.
- **Caveat:** the simulator's reported heading is the exact road bearing. Real
  GPS course is noisier, especially at low speed, so real gains will be smaller
  than this table.

**Performance** (`pnpm --filter @fleet/feed bench`, i7-10610U laptop, 5 runs):

| Work | Min | Median |
| --- | --- | --- |
| Ingest 4,311 pings/s from 5,000 trucks | 10.9 ms/s | 14.6 ms/s |
| Ingest + read all 5,000 trucks at 10 Hz | 132 ms/s | 151 ms/s |
| One `estimate()`, hot track / across 5,000 tracks | ~0.1 µs | ~0.45 µs |
| Re-smoothing one changed track | ~12.5 µs | |

Re-smoothing and its allocations dominate the full loop. The fix is to store
each window in typed arrays instead of objects. Layer 7 needs exactly that
layout for GPU upload, so it will be done there once, not twice.

**Found while building**

1. **The planned filter lost to measurement.** The design specified a one-euro
   filter. At one update a second it either lags moving trucks or barely
   smooths parked ones. Using the tracker's reported velocity halved the error.
   Recorded in [ADR 0010](adr/0010-feed-order-independence-and-smoothing.md),
   and the design doc was corrected.
2. **Order independence had a hole.** Duplicates carry different arrival times,
   and keeping the first one processed let processing order into the clock
   estimate. It was found by writing the property down precisely, before any
   test ran.
3. **Two tests couldn't fail**, and the deliberate-break checks exposed both.
   A test that can't fail looks like coverage and proves nothing.
4. **A cold measurement misled me.** A single sweep put `estimate()` at 2.8 µs
   and made it look like the bottleneck. A warmed micro-benchmark showed
   ~0.1 µs hot and ~0.45 µs across 5,000 tracks. The real cost was
   re-smoothing. Optimising the wrong thing gave 158 → 132 ms, and the
   measurement then pointed to the right one.
5. **Moving smoothing off the ingest path moved cost rather than removing it.**
   Ingest fell from 80 to 11 ms/s, but the first full read then paid for the
   deferred work. The honest benchmark measures the loop the Worker will
   actually run, not ingest alone.

**Run it:** `pnpm test`, `pnpm --filter @fleet/feed evaluate`, and
`pnpm --filter @fleet/feed bench`.

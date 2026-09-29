# Build log, layer by layer

Each layer is finished, tested and explained before the next one starts.
The design is in [../DESIGN.md](../DESIGN.md).

Every layer answers three questions: **why it exists**, what it does, and
how it's engineered and proved.

| # | Layer | Why it exists | Status |
| --- | --- | --- | --- |
| 1 | Workspace + wire protocol (`packages/protocol`) | Every other layer speaks it, so the contract comes first | **Done** |
| 2 | Route data (`packages/routes`) | Trucks must drive on the same roads the map draws, from data that never changes under a test | **Done** |
| 3 | Seeded simulator + chaos layer (`packages/sim`) | A repeatable fleet that misbehaves on purpose, so every bug can be reproduced | Next |
| 4 | Ordering buffer: dedupe, reorder, clock offset, smoothing | Turns a messy feed into a clean one; the correctness core | |
| 5 | Transport Worker + socket server | Keeps 5,000 updates a second off the main thread | |
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
  districts. All **300** pairs are routed.
- **Pure helpers** the simulator will reuse: polyline encode/decode, haversine
  distance, a flat-metres projection, distance to a segment, and time-preserving
  simplification.
- `scripts/generate.ts` and its committed output, **648 KiB (165 KiB
  gzipped)**, 11,429 km of road.

**How it is engineered**

| Choice | Why |
| --- | --- |
| Strictly sequential, request *starts* spaced ≥1.1 s, identifying User-Agent | The policy is ≤1 request per second. Spacing starts rather than gaps keeps it under the limit even when responses are fast |
| Retry only network errors, 429 and 5xx, with backoff | A 4xx, or a 200 whose body says `NoRoute`, fails the same way every time. The first draft retried those too, which review caught before the first run |
| Raw responses cached in `.cache/` (gitignored) | A rerun after a bug fix costs zero requests. Only new pairs are fetched |
| **Road-snap check: fail if a place is over 500 m from any road** | The place coordinates are approximate, from memory. OSRM reports how far it moved each point to reach a road. A place in the lagoon would snap far away, so this catches a wrong coordinate instead of trusting it. **Worst snap: Lekki Deep Sea Port, 119 m** |
| Douglas–Peucker at 1.5 m that **carries durations** | OSRM puts a vertex at every bend. Simplifying removed **58.1% of points** (187,793 → 78,743). When points are dropped, their segments' durations are summed, so total driving time is conserved exactly and slow stretches stay slow |
| Iterative, not recursive, simplification | A long route has thousands of points, and recursion depth would scale with them |
| Durations stored as integer deciseconds | Compact, exact, and validated as integers |
| Integer-delta polyline encoding | Deltas are taken between integers, never floats, so encode → decode → encode is exact |
| `validateDataset()` returns *every* problem | The generator refuses to write an invalid file, and the test suite runs the same check against the committed one |
| `parseDataset(json: unknown)` is the only typed way in | A JSON import widens `[lat, lon]` to `number[]`, so the compiler can't vouch for the file. A cast would only silence it. The shape is checked at runtime instead, and the simulator will load the data through this function |

**How it is tested:** 18 tests, 34 across the workspace.

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
- **The committed file is tested.** 300 routes, every one decodes, the counts
  match, every point is inside Lagos, and every average speed is plausible.
- **The suite was mutation-checked.** Three deliberate bugs were introduced, one
  at a time: dropping the time of removed points instead of summing it,
  simplifying 100× too aggressively, and flipping the polyline sign. Each one
  failed the suite, and the code was restored.

**Sanity check of the real data** (beyond validation):

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

**Run it:** `pnpm test` uses the committed data.
`pnpm --filter @fleet/routes generate` regenerates it, and should only be run
deliberately.

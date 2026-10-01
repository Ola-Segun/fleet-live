# Testing

How Fleet Live is tested, how to run each kind of test, and how to add one.
What CI gates is in [QUALITY.md](QUALITY.md).

## The idea: ground truth

The simulator knows where every truck *really* is (`sim.truth(id)`), when
its tracker *really* lost power, and whether it *really* sped. So the
hardest questions get measured answers instead of opinions:

- How far is the drawn truck from the real one?
- Did the alert fire for every real event? Did it fire falsely?

Those measurements are the **evaluations**. Unit and property tests guard the
pieces; browser checks guard the assembled app.

## The six kinds of check

| Kind | Tool | Where | Run with | Speed |
| --- | --- | --- | --- | --- |
| Unit | Vitest | `packages/*/tests`, `apps/web/tests` | `pnpm test` | About a minute for all 224 |
| Property | fast-check inside Vitest | Same files | `pnpm test` | |
| Evaluation (ground truth) | Node scripts | `packages/{feed,alerts,replay}/scripts/evaluate.ts` | `pnpm --filter @fleet/<pkg> evaluate` | Minutes |
| Benchmark | Node scripts | `packages/*/scripts/bench.ts` | `pnpm --filter @fleet/<pkg> bench` | Minutes |
| Browser | Playwright | `scripts/smoke-*.mts` | `pnpm smoke:<name>` | 1–5 min each |
| Accessibility | axe-core + Playwright; contrast script; manual NVDA | `scripts/a11y.mts`, `contrast.mts`, `docs/a11y/` | `pnpm a11y`, `pnpm a11y:contrast` | Minutes |

## Unit and property tests

```sh
pnpm test                        # everything
pnpm test:watch                  # re-run on save
npx vitest run packages/alerts   # one package
npx vitest run -t "parked"       # by test name
```

Conventions:

- **Name tests as statements of behaviour:** "keeps a zone's state through a
  rename…", not "test setZones".
- **Properties state invariants:**
  - the feed's result doesn't depend on arrival order;
  - `decodeFrame` never throws on random bytes;
  - the debounced switch never changes inside its band;
  - the indexed geometry matches the brute-force reference;
  - direct packing matches `packVehicle`.

  Prefer one property over ten examples when an invariant exists.
- **Keep the slow reference:** when optimising, keep the obvious version in
  the test as the oracle (see `bruteForce` in
  `packages/alerts/tests/geometry.test.ts`).
- **Fake timers for the Worker core:** `vi.useFakeTimers()` plus
  `vi.advanceTimersByTime()` drives `FleetCore` deterministically.
- **fast-check gotcha:** an arrow function that returns `expect(...)` is read
  as a boolean property. Use block bodies.

## Evaluations

| Command | Measures | Last result (see the docs) |
| --- | --- | --- |
| `pnpm --filter @fleet/feed evaluate` | Position error per smoother, against ground truth | Velocity-aided: moving p50 2.0 m against raw GPS 4.0 m |
| `pnpm --filter @fleet/alerts evaluate` | Alerts caught, missed, false and late, against a naive engine | Speeding 0 false against 270; offline 18/18 |
| `pnpm --filter @fleet/replay evaluate` | Replay error and memory per recording interval | 5 s: moving p95 4.5 m, 25 MB an hour |

They're **deterministic** (seeded): the same code gives the same numbers. A
changed number means changed behaviour. That's the point: rerun the matching
evaluation after any change to the feed, alerts or replay.

Options: `VEHICLES=` and `MINUTES=` shorten a run while iterating; `DEBUG=1`
prints details (for example, every missed episode in the alerts evaluation).

**Scoring traps found the hard way (Layer 8b):**

- score only episodes that start after the warm-up;
- an alert active *during* an episode counts as catching it;
- compare like with like (a parked silence against the parked threshold).

## Benchmarks

Each reports the **minimum and median of 5 runs**, never a single run: this
laptop varies by 2× between runs. Comparing two versions means running both
under the same conditions; for frame rates, side by side (a git worktree of
the old commit on another port).

## Browser checks

They need the production build running:

```sh
pnpm --filter @fleet/web build
pnpm --filter @fleet/web start -p 3100
pnpm smoke:ui            # or smoke:web, smoke:alerts, smoke:replay, a11y, a11y:contrast
```

Rules they follow, and new ones must too (`scripts/browser.mts`):

- **Waits scale with the renderer** (`READY_MS`, `EVENT_MS`).
- **Timing gates only on a real GPU** (`timing()`). Under `CI` or
  `SOFTWARE_GL`, it's recorded, not gated.
- **They exit non-zero on failure.**
- **They don't depend on the hour.** Use `?at=2230` when a check needs moving
  or speeding trucks.
- **They pin what they act on.** Don't re-find "the first row" between
  actions while the list changes. Pin by id.
- **A check must be shown to fail** against the broken behaviour at least
  once. Two checks in this project passed while the feature was broken (see
  Layer 10).

### When a browser check fails

1. **Read the detail in parentheses.** Every check prints what it measured.
2. **Look at the screenshot:** `scripts/smoke-*.png`.
3. **Probe the page:** `window.__fleetPerf` exposes:
   - `layer`: frames, uploads, context restores, alerting trucks drawn;
   - `longTasks`;
   - `probe(id)`: where a truck is drawn, and at what display time.
4. **Rule out the machine:** is another tab running the app? Is the server
   still up (`curl http://127.0.0.1:3100/`)?
5. **Rule out the check:** is it measuring what its name says?

## Accessibility

| Check | What it covers | Not covered |
| --- | --- | --- |
| `pnpm a11y` | axe (WCAG 2.2 AA + best practice) in 11 states across light and dark, desktop and phone; live regions don't chatter; moving trucks' status in words | What a screen reader actually says |
| `pnpm a11y:contrast` | Every text element and control border, measured against its real background, every tab, both schemes, desktop and phone | Graphics on the map canvas |
| `docs/a11y/NVDA-CHECKLIST.md` | A 36-step manual pass with NVDA | — (must be done by a person) |

## Frame profiling

`pnpm profile:frames` records a Chrome trace with the list, a selection and
the details panel live. It then breaks every frame over budget down by what
ran inside it: scripting, layout, GPU and garbage collection. Use it before
optimising rendering; Layer 8a's fixes came from it.

# Quality gates

What is checked, where, and what each check can and can't prove.

## On every push and pull request (`.github/workflows/ci.yml`)

| Gate | Command | What it proves |
| --- | --- | --- |
| Types | `pnpm typecheck` | Strict TypeScript, with `noUncheckedIndexedAccess`, across every package, the app and the browser scripts |
| Lint | `pnpm lint` | ESLint, including the React Compiler rules, on the app |
| Unit and property tests | `pnpm test` | 224 Vitest tests, many of them fast-check properties. Among them: the feed's result doesn't depend on arrival order; the shader's TypeScript twin matches the feed within 5 cm; the alert switch never flaps inside its band; the indexed geometry matches the brute-force reference on random polygons; replay's direct packing matches `packVehicle` |
| Production build | `pnpm --filter @fleet/web build` | The app builds, and the page prerenders as static |
| Bundle budget | `pnpm bundle:size` | Gzipped: at most 230 KB up front (measured 200), the largest lazy chunk at most 430 KB (measured 372, the route data), and 1,030 KB in all (measured 892). The budgets exist to notice growth, and are raised on purpose |
| Browser checks | `pnpm smoke:web`, `smoke:ui`, `smoke:alerts`, `smoke:replay` | Against the built app in Chromium: the map fills its area and survives a lost WebGL context. Search, select, follow, filters, the list's keyboard handling, deep links, the phone sheet and the theme button all work. The map's licence attribution stays visible. Alerts work, and so do zones (drawn, imported, deleted). Replay matches what the live map drew |
| Accessibility | `pnpm a11y`, `pnpm a11y:contrast` | axe (WCAG 2.2 AA plus best practice) in 11 states, light and dark: 0 violations. Live regions don't chatter. Every text element and control border was measured against its real painted background |

### Why CI doesn't gate on speed

GitHub's runners have no GPU, so WebGL runs in software (SwiftShader), at
about 5 frames a second for this fleet. There, every timing check is still
measured and printed, with "software WebGL, measured but not gated", and
every functional and accessibility check gates exactly as it does locally.
`SOFTWARE_GL=1` reproduces this locally, and the suite was run that way
before pushing (see Layer 10 in `docs/LAYERS.md`).

## Weekly and on demand (`.github/workflows/evaluate.yml`)

The evaluations against the simulator's ground truth, and the benchmarks.
The evaluations are deterministic (seeded), so a change in their numbers
means the code's behaviour changed. The benchmarks on a shared runner are
noisy, and aren't comparable with the laptop numbers in the docs.

| Command | Measures |
| --- | --- |
| `pnpm --filter @fleet/feed evaluate` | Position error of each smoother against ground truth |
| `pnpm --filter @fleet/alerts evaluate` | Alerts: caught, missed, false and late, against a naive engine |
| `pnpm --filter @fleet/replay evaluate` | Replay error and memory for each recording interval |
| `pnpm --filter @fleet/<sim, feed, alerts, replay> bench` | Cost per operation, minimum and median of 5 |

## Measured locally, on a real GPU

Frame times, long tasks and dropped frames are only meaningful on real
hardware. They're measured on the dev laptop (i7-10610U, Intel UHD, Chrome):

- `pnpm smoke:ui`, `smoke:replay`, `smoke:web` (their timing checks gate there).
- `pnpm profile:frames`, which breaks every slow frame down by what ran in it.

A frame-rate comparison between two versions means running both builds side
by side under the same conditions. This laptop's own noise is larger than
most differences (Layer 8b found that out).

## Not automated

- **The manual screen-reader pass,** `docs/a11y/NVDA-CHECKLIST.md`. Automated
  checks approximate what a screen-reader user hears, but can't hear it.

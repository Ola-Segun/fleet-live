# Extending Fleet Live

Recipes for common changes. Each one lists the files involved and the
checks that prove the change. The general rule: **logic goes in a package
with Node tests; the app wires it up.**

---

## Add a new alert kind (example: harsh braking)

1. **The rule:** in `packages/alerts/src/engine.ts`:
   - add the kind to `AlertKind`;
   - add any thresholds to `AlertRules` and `DEFAULT_RULES`;
   - evaluate it inside `evaluate()`, per truck. For an edge (on and off),
     use the debounced switch in `hysteresis.ts`: `step(state, slot, t,
     towardOn, towardOff, dwellMs, initial)`. Raise and clear through the
     existing `raise` and `clear`, so one-open-alert-per-key and the cap come
     free.
2. **The input:** if the rule needs data the snapshot doesn't carry (for
   example, deceleration), add a typed array to `FleetSnapshot`
   (`packages/transport/src/snapshot.ts`) and to `FleetFrame`. Add it to
   `snapshotTransfer`, and fill it in `buildSnapshot` from `Feed.estimate`.
3. **The words:** add a case to `alertText` in `apps/web/src/lib/alert-text.ts`
   (used on screen and when announced), and a glyph in `KIND_GLYPH` in
   `AlertsPanel.tsx`.
4. **The proof:**
   - unit tests in `packages/alerts/tests/engine.test.ts`: it fires, it
     doesn't flap, it clears;
   - if the simulator can produce the event, score it in
     `packages/alerts/scripts/evaluate.ts` against ground truth;
   - `pnpm smoke:alerts`.

## Draw something new per truck (shape, colour or status)

The vertex shader's logic has a TypeScript twin. **Change both, in the same
commit.**

1. `packages/gl/src/shaders.ts`: the vertex shader (position and mode) and
   the fragment shader (shape and colour). Shapes are signed distance
   functions in the quad's local space.
2. `packages/gl/src/reference.ts`: mirror any change to position or mode
   logic in `gpuEstimate`, rounding with `Math.fround` where the GPU uses
   float32.
3. New per-truck data:
   - **If it changes with every sample:** extend the texture layout
     (`layout.ts`: `packVehicle`, `FLOATS_PER_VEHICLE`). Update the
     **replay packer** (`packages/replay/src/history.ts`, `packInto`) too.
     Its parity test against `packVehicle` will fail until you do.
   - **If it changes rarely, like alerts:** use a separate small texture, as
     `FleetGpuState.alertTexture()` does.
4. `apps/web/src/features/live-map/vehicle-layer.ts`: new uniforms in
   `UNIFORMS`, set in `render()`.
5. `StatusIcon.tsx`: the same shape as SVG, for the list and details.
6. **The proof:**
   - `packages/gl/tests` (the twin within 5 cm of the feed);
   - `pnpm smoke:web` (the layer draws; context loss recovers);
   - `pnpm a11y:contrast`;
   - check the new shape in both light and dark.

## Add a map overlay (example: depots as icons)

Rarely-changing data belongs in **stock MapLibre layers**, not the custom
truck layer.

1. In `LiveMap.tsx`, add the source and layers inside a function like
   `addZoneLayers`. Call it on every `style.load`, because a light/dark style
   swap drops custom sources and layers. Insert below `fleet-vehicles`, so the
   trucks stay on top.
2. Update data with `source.setData(...)` in an effect.
3. Shapes or dashes, not just colour, for anything that carries meaning.

## Add a URL option

1. Parse it strictly in `apps/web/src/lib/worker-messages.ts` (data source
   options) or `ui-url.ts` (view state). Invalid input must fall back to the
   default.
2. Add a unit test in `apps/web/tests/lib.test.ts` with bad values.
3. Document it in [CONFIGURATION.md §1](CONFIGURATION.md#1--url-options-the-web-app)
   and the README.

## Add a setting (stored per visitor)

Copy `apps/web/src/lib/theme-setting.ts`:

- a `localStorage` key;
- a memory fallback for when storage is blocked;
- `useSyncExternalStore` with a server snapshot;
- a custom event for changes in the same tab.

If the setting changes what the first paint looks like, also set it from the
inline script in `app/layout.tsx`, as the theme does.

## Send a new message between the page and the Worker

| Direction | Type | Handler |
| --- | --- | --- |
| Page → Worker | `MainToWorker` in `lib/worker-messages.ts` | `workers/fleet.worker.ts` → a `FleetCore` method |
| Worker → page | `WorkerToMain` in `packages/transport/src/core.ts` | `features/live-map/use-fleet.ts` |

Large or frequent data goes as typed arrays, listed as transferables. Test
the `FleetCore` side in `packages/transport/tests` with fake timers.

## Change the wire protocol

Follow [PROTOCOL.md §5](PROTOCOL.md#5--evolving-the-protocol):

- additive changes keep version 1;
- breaking changes bump to version 2, negotiated in the hello.

Update `codec.ts`, its property tests, the reference server and the protocol
spec together.

## Use another city

1. Edit the places in `packages/routes/src/places.ts`, then regenerate the
   routes with `pnpm --filter @fleet/routes generate`. It runs at most one
   request per 1.1 s to the OSRM demo server, and caches. For more routes,
   run your own OSRM.
2. Move `ORIGIN_LNG` and `ORIGIN_LAT` in `packages/gl/src/layout.ts` to the
   new city. Rendering precision and replay's 16-bit range (±0.655°) are
   relative to it.
3. Update `LAGOS_BOUNDS` in `packages/routes/src/dataset.ts` and the time
   zone (`LAGOS_UTC_OFFSET_HOURS`), congestion zones and time-of-day curve in
   `packages/sim/src/traffic.ts`.
4. Update the default camera (`lib/camera-url.ts`) and the preset zones
   (`packages/alerts/src/presets.ts`).
5. Rerun every evaluation. Their numbers describe Lagos.

## Add a package

1. Create `packages/<name>/` with:
   - a `package.json` (`"name": "@fleet/<name>"`,
     `"exports": { ".": "./src/index.ts" }`, workspace dependencies);
   - a `tsconfig.json` extending `../../tsconfig.base.json`;
   - `src/index.ts` and `tests/*.test.ts`. Vitest finds
     `packages/*/tests/**/*.test.ts`.
2. Run `pnpm install` to link it.
3. Add `tsc -p packages/<name> --noEmit` to the root `typecheck` script.
4. Keep the dependency direction: nothing below `transport` may import
   `transport` or an app.

## Add a browser check

1. Use `scripts/browser.mts`:
   - `launchBrowser()`, `BASE_URL`;
   - `READY_MS` and `EVENT_MS` for waits;
   - `timing(ok, detail)` for anything about speed, so CI (no GPU) records
     it without failing.
2. Exit non-zero on failure (`process.exit(failed ? 1 : 0)`).
3. Prove the check can fail: run it once against the broken behaviour.
4. Add it to `smoke:all` and to `.github/workflows/ci.yml`.

## Change a measured default

1. Change it.
2. Rerun the evaluation that measured it (see [TESTING.md](TESTING.md)).
3. Update the numbers wherever they're quoted: the README, the ADR, and
   LAYERS.md. A number in the docs must come from a run of the current code.

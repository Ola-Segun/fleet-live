# The web app (`apps/web`)

A guide to the dashboard's code: how it's put together, where state lives,
how it stays smooth with 5,000 moving trucks, and the rules for changing it.

Stack: Next.js 16 (App Router, Turbopack), React 19, MapLibre GL 5,
Tailwind CSS 4, and raw WebGL2.

> **Before writing Next.js code**, read the bundled guides in
> `node_modules/next/dist/docs/` (see `AGENTS.md`). Version 16 differs from
> older Next.js in ways that matter here. For example, `ssr: false` is only
> allowed inside Client Components, and `useSearchParams` needs a Suspense
> boundary.

---

## 1 · Structure

```text
apps/web/src/
  app/
    layout.tsx          <html>: fonts, the inline theme script (before first paint), metadata
    page.tsx            the route: <Suspense><FleetApp/></Suspense> (useSearchParams needs the boundary)
    globals.css         Tailwind + colour tokens (light, dark, data-theme overrides)
  workers/
    fleet.worker.ts     glue: page messages ↔ FleetCore; builds demo or network sources
  features/live-map/
    FleetApp.tsx        the shell: owns view state, wires every part together
    use-fleet.ts        owns the Worker; routes its messages
    LiveMap.tsx         MapLibre, picking, follow, zone layers, style swaps, context loss
    vehicle-layer.ts    the WebGL2 custom layer (one instanced draw)
    PanelTabs.tsx       Trucks / Alerts / Zones (ARIA tabs)
    FleetPanel.tsx      search, status filters, sort, the virtualised truck list
    AlertsPanel.tsx     open alerts: show, acknowledge, resolve
    ZonesPanel.tsx      zones: draw, import, export, per-zone alert switches
    VehicleDrawer.tsx   one truck's details, its alerts, the follow switch
    ReplayBar.tsx       replay controls
    StatusBar.tsx       source, connection, truck count, freshness or replay time
    StatusIcon.tsx      the shader's shapes as SVG, for the list and details
    PerfHud.tsx         ?hud=1 overlay
  lib/
    gpu-state.ts        FleetGpuState: texture mirror, slots, display and replay clocks, alert flags
    fleet-view.ts       list ordering (numeric sort keys), windowing, picking helpers
    ui-url.ts, camera-url.ts      view state ↔ URL
    worker-messages.ts  page → Worker message types; config from the URL
    zones.ts            zone storage (localStorage, validated)
    theme-setting.ts, shortcuts-setting.ts   preferences (useSyncExternalStore)
    use-media-query.ts  one layout at a time (desktop or phone)
    alert-text.ts       alert wording (on screen and announced), Lagos time
    gather.ts           at most one announcement every 5 s
    perf.ts             window.__fleetPerf, for the browser checks
    snapshot-geojson.ts the baseline layer's data (?layer=baseline)
```

## 2 · The component tree

```text
<FleetApp>                          view state (URL), tabs, replay, drawing, announcements
├─ header
│   ├─ "Single-key shortcuts" toggle
│   ├─ "Dark mode" toggle
│   └─ <StatusBar>                  subscribes to snapshots for one number: the truck count
├─ <aside> (desktop) or bottom sheet <aside id="fleet-sheet"> (phone)
│   └─ <PanelTabs>
│       ├─ <FleetPanel>             memoised; subscribes to snapshots itself
│       ├─ <AlertsPanel>
│       └─ <ZonesPanel>
├─ <main>
│   ├─ <LiveMap>                    client-only (next/dynamic, ssr: false)
│   │   ├─ VehicleLayer             WebGL2 custom layer
│   │   └─ zone layers              stock MapLibre fill, line and symbol layers
│   ├─ <VehicleDrawer>              top-right on desktop; inside the sheet on phone
│   ├─ <ReplayBar>                  bottom on desktop (above the attribution); top on phone
│   └─ <PerfHud>                    ?hud=1
└─ polite live region               selection and alert announcements
```

## 3 · Data flow in the page

`useFleet(config)` creates the Worker and returns:

| Value | Kind | Consumers |
| --- | --- | --- |
| `gpu` (`FleetGpuState`) | A mutable object, fed by `rows` messages | `VehicleLayer`, picking, follow, the alert flags |
| `subscribe(listener)` | Snapshot subscription; **not React state** | `FleetPanel`, `VehicleDrawer`, `StatusBar` (each takes what it renders) |
| `status` | React state, 2 Hz | `StatusBar`, `ReplayBar` (the history range) |
| `vehicles` | React state, once | Plates and drivers |
| `alerts` | React state, on change | `AlertsPanel`, the drawer, the diamonds, announcements |
| `send(message)` | A function | Zones, alert actions, replay |

The rules that keep 60 fps:

1. **Snapshots never go into top-level React state.** They arrive twice a
   second with every truck. Components subscribe and update themselves, the
   list in a `startTransition`, so React renders it in slices.
2. **Rows never touch React.** They go straight into `FleetGpuState`. The
   layer uploads the whole texture at most once per frame.
3. **Lists render only what's on screen.** `FleetPanel` sorts packed float64
   keys (no objects) and builds row objects only for the visible window.
4. **Stable identities.** The set of alerting trucks is the same `Set`
   object until its members change, and `FleetPanel` is memoised. Alert
   messages twice a second used to re-render the whole list.
5. **Containment.** Panels use CSS `contain`, so updating them can't trigger
   layout elsewhere.

## 4 · Where state lives

| State | Where | Read and written by |
| --- | --- | --- |
| Selected truck, follow, filters, search | URL (`v`, `f`, `s`, `q`) via `history.replaceState` | `FleetApp` (`parseUi`, `writeUi`) |
| Camera | URL (`c`), throttled to once a second | `LiveMap` |
| Tab, phone sheet, drawing draft, replay | Component state in `FleetApp` | |
| Zones | `localStorage` → `useZones()` | `ZonesPanel` (`addZones`, `updateZone`, `removeZone`) |
| Theme, shortcuts | `localStorage` → `useDarkTheme()`, `useShortcutsOn()` | Header buttons |
| Everything about trucks | The Worker | Through messages |

Browser storage is an external store, so it's read with
`useSyncExternalStore`, with server snapshots for prerendering. That gives
no hydration mismatch, and changes in other tabs sync.

## 5 · The map (`LiveMap.tsx`, `vehicle-layer.ts`)

- **Created once.** Callbacks live in refs, so re-renders never re-create
  the map.
- **The truck layer is added on `load`, and re-added after:**
  - a lost WebGL context;
  - a style swap (light/dark basemap).

  MapLibre 5 destroys custom layers in both cases, and `ensureVehicleLayer`
  retries until the new style accepts the layer. The layer rebuilds itself
  from `FleetGpuState`.
- **Zone layers are added on every `style.load`,** below the truck layer.
  Restricted zones have a solid red edge, depots a dashed blue one.
- **Picking** happens only on click. It reads `slotEstimate` from the page's
  texture copy at the last drawn time (so you click what you see), rejects
  trucks outside a 24 px box in degrees first, then takes the nearest.
- **Follow** re-centres every frame on the GPU's position for the truck. It
  gives way while a pointer is down or the map is moving, and a drag hands
  control back.
- **Drawing zones:** clicks add corners. A crosshair marks the centre for
  "Add corner at map centre", the keyboard route. Double-click zoom is off
  while drawing.

## 6 · Theming

Colours are **tokens** in `app/globals.css` (`--page`, `--surface`, `--text`,
`--muted`, `--control`, `--accent`, and so on), with light and dark values.
Components use the token names through Tailwind (`bg-surface`, `text-muted`,
`border-control`), never fixed palette colours.

Dark applies when:

- `<html data-theme="dark">` is set (the button's choice), or
- the system is dark and `data-theme="light"` isn't set.

An inline script in `layout.tsx` applies the stored choice before the first
paint, so nothing flashes; `<html suppressHydrationWarning>` allows it. The
map follows: a dark basemap, and a light selection ring (`u_dark`).

Every text token pair meets WCAG AA (4.5:1) and every control border 3:1, in
both schemes. `pnpm a11y:contrast` measures them.

## 7 · Accessibility architecture

The design goal: **everything on the canvas is reachable without the
canvas.**

| Mechanism | Where |
| --- | --- |
| **The list is the accessible map.** Every truck with plate, driver, status *in words*, and speed. Selection syncs both ways | `FleetPanel` (`role="listbox"`, `aria-activedescendant`) |
| **Focus follows a truck, not a row.** The list re-sorts live; the highlighted truck stays put. The active row is always rendered, so `aria-activedescendant` never points at nothing | `FleetPanel` (`activeId`) |
| **Landmarks:** banner, complementary (side panel or sheet), main, the "Map of the fleet" region | `FleetApp` |
| **Skip link** to the side panel | `FleetApp` |
| **Tabs** with arrow keys, Home and End; only the selected tab's panel exists | `PanelTabs` |
| **Polite announcements only:** a selection; new alerts gathered into at most one sentence every 5 s; the result count after you pause typing. Positions are never announced | `FleetApp`, `Gather`, `FleetPanel` |
| **Focus is never dropped:** closing the details returns focus to the list; resolving an alert moves focus to the next one | `FleetApp`, `AlertsPanel` |
| **Lists that hold still:** the alert list freezes its order while the pointer or focus is in it; new alerts wait behind "Show N new" | `AlertsPanel` |
| **Status is never colour alone:** arrow, dot, ring and diamond shapes; text labels in the list and details; zone edges solid or dashed | Shaders, `StatusIcon`, zone layers |
| **Single-key shortcuts can be turned off** (WCAG 2.1.4) | Header toggle |
| **Pointer-free drawing:** pan by keyboard, add a corner at the centre; or import GeoJSON | `ZonesPanel` |

### Keyboard map

| Where | Keys |
| --- | --- |
| Anywhere (shortcuts on) | `/` search · `F` follow or unfollow the selected truck |
| Anywhere | `Escape` clears the selection (or cancels drawing) |
| Truck list | `↑` `↓` move · `Page Up` `Page Down` move 10 · `Home` `End` · `Enter` select |
| Search box | `Enter` selects the first match · `↓` goes to the list |
| Tabs | `←` `→` `Home` `End` |
| While drawing a zone | `Enter` finish · `Backspace` remove the last corner · `Escape` cancel |
| Replay slider | `←` `→` 5 s · `Page Up` `Page Down` 1 minute · `Home` oldest · `End` newest |
| Map (focused) | MapLibre's own: arrows pan, `+` and `−` zoom |

Manual verification is the NVDA checklist:
[a11y/NVDA-CHECKLIST.md](a11y/NVDA-CHECKLIST.md).

## 8 · Layouts

`useMediaQuery("(min-width: 768px)")` decides which layout *exists*, so
there's only ever one fleet panel in the DOM.

| | Desktop | Phone |
| --- | --- | --- |
| Panel | A 22 rem side panel | A bottom sheet: "Show trucks, alerts and zones" |
| Details | Floating top right | At the top of the open sheet |
| Replay bar | Bottom, above the attribution, clear of the zoom controls | Top of the map |

## 9 · Lint and React rules that bite

The project uses the React Compiler's lint rules. They reject:

- `setState` called directly in an effect. Derive the value instead, or
  subscribe to an external store.
- Writing refs during render. Write them in effects or handlers.
- Mutating props. Use a method on the owning object, as with
  `gpu.setDark()`.
- Impure work in state updaters. Side effects go outside `setX(fn)`.

## 10 · Adding a feature: where things go

| You're adding… | Put it in |
| --- | --- |
| Logic with no DOM (a rule, a calculation) | A package, with tests in Node |
| A new message from the Worker | `WorkerToMain` in `packages/transport/src/core.ts`, handled in `use-fleet.ts` |
| A new command to the Worker | `MainToWorker` in `lib/worker-messages.ts`, handled in `workers/fleet.worker.ts` |
| Something drawn per truck | The shader **and** its twin (`packages/gl`), then the layer's uniforms |
| A map overlay that rarely changes | A stock MapLibre layer, re-added on `style.load` (as the zone layers are) |
| A setting | `lib/*-setting.ts` with `useSyncExternalStore`, as `theme-setting.ts` does |
| A panel | A tab in `PanelTabs`, with a heading for the outline |

Recipes with steps are in [EXTENDING.md](EXTENDING.md).

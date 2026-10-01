# Configuration reference

Every value you can change, where it lives, its default, and what changing
it does. Defaults are the values the measurements in [LAYERS.md](LAYERS.md)
were taken with. Change one, then rerun the matching evaluation (see
[TESTING.md](TESTING.md)).

---

## 1 · URL options (the web app)

All URL input is untrusted and parsed strictly. Anything invalid falls back
to the default, never to a broken page.

### Data source

| Option | Default | Effect |
| --- | --- | --- |
| *(none)* | Demo mode, 5,000 trucks | The simulator runs in the Worker; no server needed |
| `n=<1–20000>` | 5000 | Fleet size in demo mode |
| `seed=<text>` | `fleet-live` | A different, but repeatable, fleet |
| `at=<HHMM>` | Now | Start the simulated day at this Lagos time. `at=2230` gives light traffic, so speeders and alerts appear within a minute |
| `mode=network&ws=<url>` | — | Network mode against a server. `ws` must start `ws://` or `wss://`; the default is `ws://127.0.0.1:8787/stream` |

### Diagnostics

| Option | Effect |
| --- | --- |
| `hud=1` | Performance overlay: frame rate and the truck layer's CPU per frame |
| `layer=baseline` | The stock MapLibre GeoJSON layer (Layer 6), for comparison |
| `trucks=off` | The map alone, for measuring each layer by difference |

### The dispatcher's view

These are written back to the URL as you use the app, so a copied link
reopens the same view.

| Option | Example | Meaning |
| --- | --- | --- |
| `c` | `c=6.52440,3.37921,11.50` | Camera: latitude, longitude, zoom. Written at most once a second |
| `v` | `v=1042` | The selected truck |
| `f` | `f=1` | Follow the selected truck |
| `s` | `s=moving,stale` | Statuses shown (`moving`, `parked`, `stale`). Absent means all |
| `q` | `q=KJA` | Search text, at most 64 characters |

Replay time isn't in the URL, because history lives in the browser session
(see [ROADMAP.md](ROADMAP.md)).

## 2 · Browser storage (per visitor)

| Key | Values | Written by |
| --- | --- | --- |
| `fleet-live:theme` | `light` or `dark`; absent means follow the system | The Dark mode button. Applied before the first paint by the inline script in `app/layout.tsx` |
| `fleet-live:shortcuts` | `on` or `off` | The single-key shortcuts button (WCAG 2.1.4) |
| `fleet-live:zones` | A GeoJSON FeatureCollection | The Zones panel. Read back through the validating importer; anything invalid falls back to the demo zones |

When storage is blocked (some private windows), each setting falls back to
memory for the visit.

## 3 · The simulator server (`apps/sim-server`)

### Environment variables (`pnpm --filter @fleet/sim-server start`)

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | 8787 | HTTP and WebSocket port |
| `HOST` | `127.0.0.1` | Bind address. Use `0.0.0.0` to accept other machines |
| `VEHICLES` | 5000 | Fleet size |
| `SEED` | `fleet-live` | Fleet seed |
| `FORCE_DISCONNECT_MS` | off | Drop every client this often, to exercise resume |

### `startSimServer(options)`, programmatic

| Option | Default | Meaning |
| --- | --- | --- |
| `historyFrames` | 300 | Frames kept for resuming clients (30 s at 10 Hz) |
| `helloTimeoutMs` | 2000 | Time a client has to say hello |
| `maxBufferedBytes` | 1,000,000 | Backpressure: close a client this far behind (1013) |
| `heartbeatMs` | 10,000 | WebSocket ping interval; no pong means terminate |
| `tickMs` | 100 | How often the paced simulation is advanced |
| `startTime` | Now | Simulated start, in epoch ms |
| `chaos`, `device` | See §4 | Network and tracker behaviour |

## 4 · The simulation (`packages/sim`)

Every number here is a modelled assumption, plausible but not measured. See
`packages/sim/src/traffic.ts`.

### `SimConfig`

| Field | Default | Meaning |
| --- | --- | --- |
| `seed` | — | All randomness forks from it in named streams (ADR 0009) |
| `vehicleCount` | — | Fleet size |
| `startTime` | — | Integer epoch ms. The time of day sets the traffic |
| `stepMs` | 100 | Physics step |
| `frameIntervalMs` | 100 | Frame interval; must be a multiple of `stepMs` |
| `chaos`, `device`, `drivers` | See below | |

### `ChaosConfig`: the network (`DEFAULT_CHAOS`; `NO_CHAOS` disables it)

| Field | Default | Meaning |
| --- | --- | --- |
| `baseLatencyMs` | 120 | Minimum delivery delay |
| `jitterMeanMs` | 80 | Mean of an exponential extra delay |
| `duplicateRate` | 0.03 | Chance a ping is delivered twice |
| `dropRate` | 0.01 | Chance a ping is lost |
| `reorderRate` | 0.02 | Chance a ping is held back past later ones |
| `reorderWindowMs` | 3000 | How far back a held ping can fall |

### `DeviceConfig`: the trackers (`DEFAULT_DEVICE`)

| Field | Default | Meaning |
| --- | --- | --- |
| `gpsSigmaM` | 4 | GPS error, standard deviation per axis, metres |
| `skewedShare` | 0.02 | Share of devices with badly wrong clocks |
| `maxSkewMs` | 180,000 | How wrong those clocks can be (±3 min) |
| `normalSkewSdMs` | 150 | Clock error of every other device |
| `movingIntervalMs` | 1000 | Report interval while moving |
| `parkedIntervalMs` | 30,000 | Report interval while parked |
| `gapZoneCount`, `gapZoneRadiusM` | 3, 600 | Coverage gaps: devices record inside and send the backlog on leaving |
| `outagesPerHour` | 0.02 | Power losses per device per hour (Poisson) |
| `outageMinMs`, `outageMaxMs` | 60,000, 480,000 | Outage length, uniform: 1 to 8 minutes, with nothing recorded |

### `DriverConfig` (`DEFAULT_DRIVERS`)

| Field | Default | Meaning |
| --- | --- | --- |
| `speederShare` | 0.02 | Share of drivers who ignore the 55 km/h laden-truck cap |
| `speederCapMs` | 80 / 3.6 | Their own cap (80 km/h) |

### Fixed model constants (`traffic.ts`)

- **Truck cap:** 55 km/h.
- **Lagos time:** UTC+1 all year.
- **Time-of-day speed curve:** two peaks. 35% of free-flow speed at 08:00
  and 30% at 17:30; 100% at midnight.
- **Congestion zones:**
  - Apapa go-slow: 3.5 km radius, 15% of free flow, stop-and-go.
  - Oshodi: 50%.
  - Ojota–Mile 12: 50%.
  - Berger: 55%.

## 5 · The feed (`packages/feed`, `DEFAULT_FEED_OPTIONS`)

| Field | Default | Meaning |
| --- | --- | --- |
| `window` | 16 | Samples kept per vehicle, by sequence number |
| `smoothing` | `velocityAided(0.2)` | Position smoothing, using the tracker's reported velocity. `raw` turns it off |
| `extrapolateMs` | 5000 | How far past the newest sample a moving truck is projected |
| `movingStaleMs` | 10,000 | A moving truck silent this long is stale |
| `parkedStaleMs` | 90,000 | A parked truck silent this long is stale |
| `minDelayMs`, `maxDelayMs` | 1000, 5000 | Clamp on the adaptive display delay |
| `initialDelayMs` | 2000 | The delay before enough data exists to estimate it |
| `delayWindow` | 4096 | Recent observations used for the delay estimate (p95 lateness + p95 interval) |

The GPU has its own copy of the staleness rules (`DEFAULT_STALENESS` in
`packages/gl/src/reference.ts`: 5 s, 10 s, 90 s). Keep the two in step;
the correspondence test will tell you if you don't.

## 6 · Transport (`packages/transport`)

| Setting | Default | Where |
| --- | --- | --- |
| Snapshot rate | 2 Hz | `FleetCore` constructor (`snapshotHz`) |
| GPU rows rate | 10 Hz | `FleetCore` constructor (`rowsHz`) |
| Pacer catch-up cap | 1000 ms | `Pacer` (`maxCatchUpMs`): a hidden tab pauses simulated time instead of bursting |
| Reconnect base and max delay | 500 ms, 15 s | `ReconnectOptions` (`baseDelayMs`, `maxDelayMs`) |
| Healthy-connection reset | 10 s | `stableAfterMs` |
| Silence watchdog | 2 s | `silenceTimeoutMs` |

## 7 · Alerts (`packages/alerts`, `DEFAULT_RULES`)

| Field | Default | Meaning |
| --- | --- | --- |
| `marginM` | 20 | How far past a zone edge counts as in or out |
| `dwellMs` | 10,000 | How long the condition must hold, unbroken |
| `speedLimitKmh` | 60 | A policy setting, not a law |
| `speedClearKmh` | 55 | Speeding ends only below this |
| `speedDwellMs` | 10,000 | |
| `offlineMovingMs` | 120,000 | Silence before offline, with the ignition on |
| `offlineParkedMs` | 600,000 | With the ignition off |
| `maxOpen` | 500 | Past this, the oldest ended alerts are auto-resolved (active ones never are) |

### Import limits (`IMPORT_LIMITS`)

- At most 50 zones per import.
- At most 5,000 vertices per zone.
- Zones at most 100 km across.
- Names at most 60 characters.

### Zone kinds

| Kind | Default alerts |
| --- | --- |
| `restricted` | On entry |
| `depot` | On exit |

The demo presets: Third Mainland Bridge (restricted), and Apapa Port (depot,
with no alerts).

## 8 · Replay (`packages/replay`, `DEFAULT_HISTORY`)

| Field | Default | Meaning |
| --- | --- | --- |
| `intervalMs` | 5000 | One frame of the fleet this often. 2 s = 63 MB an hour for 5,000 trucks; 10 s = 13 MB but double the worst-case error |
| `capacityMs` | 3,600,000 | How far back replay reaches |

Positions are stored at 16-bit, 2 × 10⁻⁵° steps (about 2.2 m), which covers
±0.655° around the map origin (3.38° E, 6.52° N). For another city, move
`ORIGIN_LNG` and `ORIGIN_LAT` in `packages/gl/src/layout.ts`.

## 9 · The web app (`apps/web`)

| Constant | Value | File |
| --- | --- | --- |
| Demo warm-up | 30 s simulated before going live | `workers/fleet.worker.ts` (`WARM_UP_MS`) |
| Maximum fleet from the URL | 20,000 | `lib/worker-messages.ts` |
| Alert announcement interval | 5 s | `features/live-map/FleetApp.tsx` (`ANNOUNCE_EVERY_MS`) |
| Alerts rendered | 100 most recent | `AlertsPanel.tsx` (`SHOWN`) |
| List row height | 44 px | `FleetPanel.tsx` (`ROW`) |
| Click radius | 24 px | `LiveMap.tsx` (`PICK_RADIUS`) |
| Icon size by zoom | 5 px under zoom 11.5; 14 px under 14; 20 px from 14 | `vehicle-layer.ts` (`iconSize`) |
| Replay speeds | 1×, 10×, 60× | `ReplayBar.tsx` (`SPEEDS`) |
| Base map styles | OpenFreeMap `positron` (light), `dark` | `LiveMap.tsx` (`styleUrl`) |
| Colour tokens | Light and dark values | `app/globals.css` |

## 10 · Browser checks (`scripts/`)

| Variable | Effect |
| --- | --- |
| `BASE_URL` | The app to test (default `http://127.0.0.1:3100/`); point it at a deployment to check production |
| `CI` | Use the CI path: software WebGL, longer waits, timing measured but not gated |
| `SOFTWARE_GL` | The same rendering path without claiming to be CI |
| `CHROME_PATH` | Which Chrome to drive. The default is the Windows install if present, otherwise Playwright's Chromium |
| `DEBUG`, `VEHICLES`, `MINUTES` | Evaluation scripts: extra output, fleet size, duration |

Budgets for `pnpm bundle:size` are at the top of `scripts/bundle-size.mts`.

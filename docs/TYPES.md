# Data types and contracts

Every type that crosses a boundary: the network, the Worker/page messages,
the alert and zone records, and storage. These are the contracts to keep
stable. Internal types stay in their packages.

The definitions below are copied from the source, shortened only by
dropping comments. When they differ, **the source wins**: the file is named
in each heading.

---

## 1 · On the network (`packages/protocol/src/types.ts`)

```ts
interface Ping {
  vehicleId: number;   // uint32
  seq: number;         // uint32, +1 per report, per vehicle; duplicates share it
  deviceTime: number;  // integer epoch ms, the DEVICE's clock (may be skewed)
  lat: number;         // degrees, carried at 1e-6°
  lon: number;
  speed: number;       // m/s, carried at 0.01 m/s, max 655.35
  heading: number;     // degrees clockwise from north, [0, 360), carried at 0.01°
  flags: number;       // PingFlag bits
}

const PingFlag = { Ignition: 1 << 0, Buffered: 1 << 1 };
const FrameType = { Delta: 0, Snapshot: 1 };

interface Frame {
  type: FrameType;
  frameSeq: number;    // uint32 server cursor; a reconnecting client sends the last one
  baseTime: number;    // integer epoch ms, server clock
  pings: Ping[];
}

// Client → server, once, as text (packages/transport/src/control.ts)
interface Hello { type: "hello"; resumeAfter?: number }

// GET /vehicles (packages/sim/src/vehicle.ts)
interface VehicleInfo { id: number; plate: string; driver: string }
```

Byte layout: [PROTOCOL.md §3](PROTOCOL.md#3--frame-format).

## 2 · Inside the feed (`packages/feed/src/track.ts`, `feed.ts`)

```ts
// A ping as the feed keeps it
interface Sample {
  seq: number; deviceTime: number;
  receivedAt: number;      // server time the ping arrived (the frame's baseTime)
  lat: number; lon: number; speed: number; heading: number; flags: number;
  vx: number; vy: number;  // reported velocity, m/s east and north
}

// The track's current view of a sample
interface ResolvedSample extends Sample {
  time: number;            // device time corrected onto the server clock
  smoothLat: number;
  smoothLon: number;
}

type EstimateMode = "waiting" | "interpolated" | "extrapolated" | "holding" | "parked" | "stale";

// Where a truck is at a display time
interface Estimate {
  lat: number; lon: number; heading: number; speed: number;
  mode: EstimateMode;
  ageMs: number;           // display time − newest sample time (negative while interpolating)
  ignition: boolean;       // the newest report had the engine on
}

interface FeedStats {
  frames: number; framesMissed: number; pings: number; added: number;
  duplicates: number; tooOld: number; resets: number; lateForDisplay: number;
}
```

### Mode codes (`packages/gl/src/reference.ts`)

The same numbering is used in snapshots, in the shader, and by the status
filter.

| Code | Mode | Status group | Drawn as |
| --- | --- | --- | --- |
| 0 | `waiting` | always shown | A small grey dot |
| 1 | `interpolated` | moving | A blue arrow |
| 2 | `extrapolated` | moving | An amber arrow |
| 3 | `holding` | moving | An amber arrow |
| 4 | `parked` | parked | A grey dot |
| 5 | `stale` | stale | A red hollow ring |
| — | any, with an active alert | — | A violet diamond (drawn above the rest) |

## 3 · Worker ↔ page messages

### Page → Worker (`apps/web/src/lib/worker-messages.ts`)

```ts
type FleetConfig =
  | { mode: "demo"; seed: string; vehicleCount: number; startMinute?: number }
  | { mode: "network"; url: string };

type MainToWorker =
  | ({ type: "start" } & FleetConfig)
  | { type: "stop" }
  | { type: "zones"; zones: ZoneSpec[] }                       // the whole list, whenever it changes
  | { type: "alert"; action: "acknowledge" | "resolve"; id: number }
  | { type: "alert"; action: "resolve-cleared" }
  | ({ type: "replay" } & ReplayRequest)                        // enter, scrub, speed, pause
  | { type: "live" };                                          // leave replay
```

### Worker → page (`packages/transport/src/core.ts`)

```ts
type WorkerToMain =
  | { type: "status"; mode: "network" | "demo"; connection: ConnectionStatus;
      feed: FeedStats; delayMs: number;
      history: HistoryStatus | undefined; replayAt: number | undefined }  // 2 Hz
  | { type: "snapshot"; snapshot: FleetSnapshot }                         // 2 Hz, transferred
  | { type: "vehicles"; vehicles: VehicleInfo[] }                         // once
  | { type: "error"; message: string }
  | AlertsMessage                                                         // on change
  | RowsMessage;                                                          // 10 Hz, transferred

interface RowsMessage {
  type: "rows";
  epoch: number;           // session epoch, ms; sample times in `data` are seconds since it
  serverTime: number;
  delayMs: number;
  count: number;           // slots in use; a vehicle's slot never changes
  slots: Uint32Array;      // which slot each row is for
  data: Float32Array;      // 36 floats per row (see §4)
  newIds: number[];        // vehicle ids for newly assigned slots, in slot order
}

interface FleetSnapshot {  // structure of arrays, sorted by id, transferable
  serverTime: number; displayTime: number; delayMs: number; count: number;
  ids: Uint32Array; lat: Float64Array; lon: Float64Array;
  heading: Float32Array; speed: Float32Array;   // speed in m/s
  mode: Uint8Array;        // mode codes (§2)
  ageMs: Float32Array; ignition: Uint8Array;
}

interface AlertsMessage {
  type: "alerts";
  alerts: Alert[];                                  // open alerts, newest first
  zoneCounts: Array<[zoneId: string, trucksInside: number]>;
  raised: number[];                                 // ids raised since the last message: announce these
}

interface ReplayRequest { at: number; wall: number; speed: number; playing: boolean }
interface HistoryStatus { from: number; to: number; bytes: number }

interface ConnectionStatus {
  state: "connecting" | "open" | "waiting" | "stopped";
  attempt: number; nextRetryAt: number | undefined;
  lastFrameAt: number | undefined; lastFrameSeq: number | undefined;
  reconnects: number; resumes: number; snapshots: number; badFrames: number;
}
```

**Why structure-of-arrays:** one typed array per field can be *transferred*
(a constant-time move) instead of cloned. It also leaves no per-truck objects
for the main thread's garbage collector.

## 4 · The GPU texture row (`packages/gl/src/layout.ts`)

Each truck has 9 RGBA32F texels, 36 floats. 200 trucks share one texture
row, 1,800 texels wide.

| Texel | x | y | z | w |
| --- | --- | --- | --- | --- |
| 0–7 (oldest first) | Mercator x − origin | Mercator y − origin | Seconds since epoch | Heading, degrees |
| 8 (metadata) | Velocity x (Mercator/s) | Velocity y | Flags (1 = parked) | Sample count |

With fewer than 8 samples, the row is padded at the front by repeating the
oldest. A separate R8 texture holds one byte per slot: 255 means the truck
has an active alert.

## 5 · Alerts and zones (`packages/alerts/src/engine.ts`)

```ts
type ZoneKind = "restricted" | "depot";

interface ZoneSpec {
  id: string; name: string; kind: ZoneKind;
  alertOnEnter: boolean; alertOnExit: boolean;
  coordinates: number[][][][];   // GeoJSON MultiPolygon: polygons → rings → [lon, lat]
}

type AlertKind = "zone-enter" | "zone-exit" | "speeding" | "offline";

interface Alert {
  id: number; kind: AlertKind; vehicleId: number; zoneId?: string;
  raisedAt: number; lastRaisedAt: number;   // data time, epoch ms
  occurrences: number;                       // a repeat raises the same alert again
  active: boolean;                           // the condition still holds
  clearedAt?: number;
  detail: number;                            // speeding: peak km/h; offline: last report time
  acknowledgedAt?: number;
}
```

**Lifecycle:** raised (active) → condition ends (`active: false`,
`clearedAt`) → resolved (removed). Acknowledging marks it seen. A repeat
while still open sets it active again and clears the acknowledgement. Once
resolved, only a fresh occurrence raises a new alert.

### Zones as GeoJSON (storage, import and export)

```json
{
  "type": "FeatureCollection",
  "features": [{
    "type": "Feature",
    "id": "zone-…",
    "properties": { "id": "zone-…", "name": "Yard", "kind": "depot", "alertOnEnter": false, "alertOnExit": true },
    "geometry": { "type": "MultiPolygon", "coordinates": [[[[3.39, 6.6], [3.4, 6.6], [3.4, 6.61], [3.39, 6.6]]]] }
  }]
}
```

The importer accepts a FeatureCollection, a Feature, or a bare Polygon or
MultiPolygon. Unclosed rings are closed, with a warning. Limits are in
[CONFIGURATION.md §7](CONFIGURATION.md#7--alerts-packagesalerts-default_rules).

## 6 · Replay (`packages/replay`)

A history frame per truck is 7 bytes:

| Field | Type | Unit |
| --- | --- | --- |
| x, y | Int16 each | 2 × 10⁻⁵°-of-longitude steps in Mercator, from the origin |
| heading | Uint8 | 360/256° steps |
| speed | Uint8 | Whole km/h, capped at 255 |
| state | Uint8 | 0 = no data (unknown or stale then), 1 = ignition on, 2 = ignition off |

The replay snapshot has the same shape as `FleetSnapshot`, computed from the
replay rows with `slotEstimate`.

## 7 · The page's view state (`apps/web/src/lib/ui-url.ts`)

```ts
interface UiState {
  vehicle: number | undefined;                // ?v=
  follow: boolean;                            // ?f=1
  groups: ("moving" | "parked" | "stale")[];  // ?s=
  query: string;                              // ?q=
}
interface Camera { lat: number; lng: number; zoom: number }   // ?c=lat,lng,zoom
```

## 8 · What a production backend must provide

The client depends only on §1 (frames, the hello, `/vehicles`). Everything in
§2–7 is computed in the browser. A backend that also evaluates alerts or
stores history server-side would expose `Alert`, `ZoneSpec` and history
through an API. A proposed shape is in [BACKEND.md](BACKEND.md).

# Glossary

Terms as this project uses them.

| Term | Meaning |
| --- | --- |
| **Ping** | One position report from one tracker: vehicle id, sequence number, device time, position, speed, heading, flags |
| **Frame** | What the source sends every 100 ms: a header plus the pings received since the last frame. *Delta* (normal) or *Snapshot* (the newest ping of every vehicle) |
| **frameSeq** | The server's frame counter. A reconnecting client sends the last one it saw, to resume |
| **seq** | A tracker's own report counter. It orders a vehicle's reports, rather than their unreliable timestamps |
| **Device time** | The tracker's clock, which may be minutes wrong |
| **Server time** | The source's clock (a frame's `baseTime`); the reference |
| **Clock offset** | The estimated difference between a device's clock and the server's: the smallest delay seen in the window |
| **Display time** | The moment the map draws: server time minus the display delay |
| **Display delay** | How far behind the newest data the map draws, on purpose (adaptive, 1–5 s, typically about 1.4 s): long enough that a real sample nearly always lies on each side of the drawn moment |
| **Session epoch** | The first server time, floored to a second. Texture times are seconds since it, to keep float32 precise |
| **Feed** | The Worker's model of every truck (`packages/feed`) |
| **Track** | One truck's window of samples (`VehicleTrack`) |
| **Window** | The last 16 samples a track keeps, by sequence number |
| **Smoothing** | Reducing GPS scatter. Here: velocity-aided, using the tracker's reported speed and heading |
| **Estimate** | Where a truck is at a given time, with its mode |
| **Mode** | How an estimate was made: *waiting* (time before the first sample), *interpolated* (between two samples), *extrapolated* (projected past the newest), *holding* (projection capped at 5 s), *parked*, *stale* (silent too long) |
| **Stale** | No report for 10 s while moving, or 90 s while parked. Drawn as a red ring |
| **Offline (alert)** | Silent 2 minutes with the ignition on, or 10 minutes with it off |
| **Buffered** | A ping recorded in a coverage gap and delivered late in a burst; flagged and kept out of the clock estimate |
| **Coverage gap** | An area without mobile signal, where trackers record and send later (simulated as 3 circles of 600 m) |
| **Chaos** | The simulator's deliberately bad network: latency, jitter, duplicates, drops, reordering |
| **Ground truth** | Where the simulator says each truck really is; what evaluations measure against |
| **Evaluation** | A script that scores a component against ground truth (`pnpm --filter @fleet/<pkg> evaluate`) |
| **Snapshot** (Worker → page) | Every truck's estimate at the display time, as parallel typed arrays, twice a second. Not the same as a Snapshot *frame* |
| **Rows** | Changed trucks' packed samples for the GPU texture, ten times a second |
| **Slot** | A truck's permanent row position in the GPU texture |
| **Texture mirror** | The page's copy of the GPU texture (`SampleMirror` in `FleetGpuState`); survives the WebGL context being lost |
| **RTC (relative to centre)** | Positions stored as offsets from a fixed Lagos origin, so float32 stays precise (about 2.4 m steps otherwise) |
| **TypeScript twin** | `gpuEstimate`: the vertex shader's algorithm in TypeScript, for picking, follow, replay and tests |
| **Custom layer** | MapLibre's hook for drawing with your own WebGL; our truck layer |
| **Transferable** | An ArrayBuffer moved (not copied) between the Worker and the page by `postMessage` |
| **Hysteresis / band** | Different thresholds to switch on and off (20 m into or out of a zone; over 60, under 55 km/h), so values near the edge don't flap |
| **Dwell** | How long a condition must hold, unbroken, before it counts (10 s) |
| **Zone** | A polygon that counts trucks and raises entry or exit alerts. *Restricted* (alert on entry) or *depot* (alert on exit) |
| **Signed distance** | Metres from a point to a zone's edge: negative inside |
| **Open alert** | Raised and not yet resolved. *Active* while its condition holds; *ended* when it no longer does |
| **Acknowledge / resolve** | "I've seen it" / "dealt with, remove it" |
| **History** | The recorded hour: one frame of the fleet every 5 s |
| **Replay** | Showing the fleet at a past time through the same renderer |
| **Validity span** | The replay time range a truck's packed frames stay right for; repacked only when time leaves it |
| **Warm-up** | Demo mode simulates 30 s before going live, so trucks aren't all starting from rest |
| **Backpressure** | The server closing a client that falls more than 1 MB behind (code 1013), rather than buffering forever |
| **Resume** | Reconnecting and receiving exactly the frames missed, from the server's 30 s history |
| **Silence watchdog** | Closing a connection after 2 s without a frame, because the server always sends 10 per second |
| **Full-jitter backoff** | Reconnect after a random delay up to an exponentially growing cap (500 ms × 2ⁿ, at most 15 s) |
| **Software WebGL / SwiftShader** | WebGL drawn by the CPU, as on CI machines without a GPU; about 5 fps for this fleet |
| **ADR** | Architecture Decision Record (`docs/adr/`): a decision, its context, and the measurements behind it |

# A five-minute walkthrough

For a reviewer or interviewer. Open the app, the live demo or
`pnpm --filter @fleet/web dev`, and follow along. Each step says what to do,
what to notice, and where the code and the evidence are.

## 1 · Five thousand trucks, smoothly (1 min)

**Do:** load the page, zoom in on a busy road (the Apapa port approach is
good), and add `?hud=1` to the URL.

**Notice:**

- Every truck glides, although each one reports only once a second, late
  and sometimes out of order.
- The overlay shows the truck layer costing well under a millisecond of CPU
  a frame.
- Arrows are moving trucks, grey dots are parked, and red rings are stale:
  the shape says it, not just the colour.

**Why it works:** the map draws about 1.4 s in the past, the adaptive
display delay, so there's nearly always a real sample on either side of the
moment it draws. The GPU interpolates between them for all 5,000 trucks in
one draw call.

- Code: `packages/gl/src/shaders.ts`, and its TypeScript twin
  `packages/gl/src/reference.ts`.
- Evidence: [ADR 0001](adr/0001-own-webgl-layer.md), and the baseline
  comparison with `?layer=baseline`.

## 2 · The feed lies; the map doesn't (1 min)

**Do:** open [Layer 4](LAYERS.md#layer-4--the-feed-ordering-clocks-and-smoothing).

**Notice:** the simulator's chaos layer delivers 3% of pings twice, drops 1%,
reorders 2%, and has trackers with clocks up to 3 minutes wrong, plus
coverage gaps that send everything in a burst.

**How it's handled:** a truck's track is a pure function of the set of
samples it has, whatever order they arrived in, and a property test proves
it. The planned one-euro filter was measured and rejected in favour of
smoothing with the tracker's reported velocity, which halved the error.

- Code: `packages/feed/src/track.ts`.

## 3 · Find, follow, and the accessible map (1 min)

**Do:**

1. Press `/`, type part of a plate, then press Enter.
2. Press `F` to follow the truck, then drag the map.
3. Tab into the list and use the arrow keys.

**Notice:**

- The URL keeps the view, so a copied link reopens it.
- Dragging stops following instead of fighting you.
- The list re-sorts live, but keyboard focus stays on the truck, not the
  row, so Enter never opens a truck you didn't highlight.
- The list is the screen reader's way to everything the canvas shows.

- Code: `apps/web/src/features/live-map/FleetPanel.tsx`.
- Evidence: [Layer 8a](LAYERS.md#layer-8a--find-inspect-follow-list), where
  its "found while building" section lists the bugs the browser checks
  caught.

## 4 · Alerts that don't cry wolf (1 min)

**Do:** open `?at=2230`, which starts at 22:30 Lagos time when some drivers
speed, and wait a minute. Open the Alerts tab, then Zones, and draw a zone.

**Notice:**

- Speeding, silent trackers and zone entries arrive as violet diamonds on
  the map and a list that holds still while you use it.
- There's no flurry of enter/exit alerts for trucks parked by a zone's edge.

**Why:** every edge has a band (20 m, or 5 km/h) and a 10 s dwell. Scored
against the simulator's ground truth: 0 false speeding alerts, against 270
for a naive rule.

- Code: `packages/alerts/src/hysteresis.ts`.
- Evidence: [ADR 0012](adr/0012-alerts-hysteresis-in-the-worker.md). The
  evaluation also found a real bug: silent trackers were judged by speed
  instead of ignition.

## 5 · Replay, through the same renderer (1 min)

**Do:** wait a minute after loading, press Replay, drag the slider, and
play at 60×.

**Notice:**

- The map, list and details panel all show the past.
- Parked trucks are parked, and stale trucks are stale.
- Alerts stay live.

**How:** the Worker records the fleet every 5 s, at 7 bytes a truck, and
packs the recorded frames into the same GPU rows the live map uses. In
Chrome, replayed trucks sit within 1.4 m (p95) of where the live map drew
them.

- Code: `packages/replay/src/history.ts`.
- Evidence: [ADR 0013](adr/0013-replay-from-recorded-estimates.md).

## If there's more time

- The dark mode button (top left): the theme is applied before the first
  paint, and the map switches basemap without dropping the truck layer.
- Every layer's **"found while building"** section in
  [LAYERS.md](LAYERS.md) is the honest record of what went wrong and how it
  was caught.
- [QUALITY.md](QUALITY.md) says what CI gates, what it only measures, and why.

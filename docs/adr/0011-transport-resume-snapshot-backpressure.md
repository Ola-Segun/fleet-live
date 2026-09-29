# 0011 · Transport: resume from history, snapshot as fallback, close slow consumers

**Status:** accepted, 29 Sep 2026 (Layer 5)

## Context

The browser must receive about 4,300 updates a second without touching the main
thread. It must also survive the connection dropping (mobile networks, a
laptop sleeping, a server restart) without holes in the data, and a public demo
must not depend on a free-tier server that sleeps.

## Decision

- **A Web Worker owns the socket and the Layer 4 feed.** The page receives a
  snapshot twice a second as seven typed arrays, transferred without copying.
- **One client message: `hello`, optionally with `resumeAfter`.** The server
  keeps 30 s of encoded frames. A returning client gets exactly the frames
  after its last one. If that point has left the history, or the client is
  new, it gets a **snapshot** (each truck's newest ping) instead. Because the
  feed is order- and duplicate-independent (ADR 0010), a snapshot can overlap
  what the client already has, harmlessly.
- **Reconnect with full-jitter exponential backoff** (500 ms base, 15 s cap),
  reset after 10 s of healthy connection.
- **A silence watchdog.** The server sends 10 frames a second, even empty ones,
  so 2 s without one means the connection is dead even if the socket hasn't
  noticed. The watchdog tears it down rather than waiting on a close handshake.
- **Backpressure: a client that stops reading is closed** (code 1013) once 1 MB
  is queued for it, rather than buffered without limit. It resumes or
  snapshots when it returns.
- **Server heartbeat** (ws ping every 10 s) terminates clients whose TCP died
  silently. **`maxPayload` is 1 KB**, because clients only ever send one hello.
- **Demo mode** runs the simulator in the Worker, paced to the wall clock, and
  every frame is **encoded and decoded** as if it had crossed the network. A
  hidden tab pauses simulated time instead of bursting on return.

## Consequences

- Across forced disconnects every 800 ms, every frame arrives exactly once
  (tested). The feed reports 0 frames missed over a flaky connection (tested).
- One simulation per server, broadcast to every client, so all viewers see the
  same fleet.
- A client offline for more than 30 s gets a snapshot, not the missed history.
  Replay (Layer 9) is where history lives.
- Demo mode spends CPU on an encode/decode it doesn't strictly need. That is
  deliberate: both modes run the same code path.

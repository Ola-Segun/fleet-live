# 0009 · A seeded simulation with named random streams

**Status:** accepted, 29 Sep 2026 (Layer 3)

## Context

The later layers exist to cope with a messy GPS feed. Their bugs will show up
as "that truck jumped backward once". A bug like that can only be fixed if it
can be reproduced, and `Math.random()` can't be seeded, so no run could ever
be repeated.

A single seeded generator is not enough on its own. If every consumer draws
from one stream, adding a truck or turning up the network chaos shifts every
later draw, and the whole fleet changes. A test written against yesterday's
fleet would silently start testing a different one.

## Decision

- **sfc32**, seeded through splitmix32, in `packages/sim/src/random.ts`. It is
  small, fast, has 128 bits of state and passes PractRand.
- **Streams are forked by name from the seed, never from the current state.**
  The streams are `vehicle:<id>:motion`, `vehicle:<id>:device`,
  `vehicle:<id>:identity`, `zones` and `chaos`. A fork returns the same
  sequence however much any other stream has drawn.
- The simulation **never reads the wall clock.** It advances in fixed 100 ms
  steps of simulated time. It runs as fast as the CPU allows in tests, and in
  real time only when a caller paces it.

## Consequences

- The same seed produces the same frames, byte for byte. This is tested.
- Turning the network chaos up or down never changes where any truck drove.
  Adding trucks never changes the existing ones. Both are tested.
- The simulator can expose **ground truth** (`sim.truth(id)`) beside what the
  devices report. Layer 4 can then measure its error against where trucks
  really were, instead of against its own output.
- A consumer must fork its own stream. Drawing from another concern's stream
  would reintroduce the coupling. Code review has to watch for it.

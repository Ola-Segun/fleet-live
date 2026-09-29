# 0003 · A binary protocol, not JSON

**Status:** accepted, 29 Sep 2026 (Layer 1)

## Context

5,000 vehicles pinging at 1 Hz is 5,000 position reports a second, all of which
the browser has to receive, parse and file away without dropping frames.

## Decision

A fixed-layout little-endian binary frame (`packages/protocol`): a 20-byte
header, then 25 bytes per ping. The server batches pings into 10 Hz frames.

- **Positions are int32 microdegrees** (1e-6° ≈ 0.11 m). They are exact integers
  on the wire, so every consumer decodes the same number, and `quantize()` tells
  the sender what the receiver will see.
- **Times are int32 millisecond offsets** from a float64 `baseTime` in the header.
  Signed, because skewed or buffered pings can predate the frame.
- **Decode returns a result, encode throws.** Decoding reads the network, so a bad
  frame is an expected outcome. Encoding reads our own simulator, so a bad value
  there is a bug and should be loud.
- **Decode validates ranges**, because an int32 can hold 2147° and a corrupt frame
  must fail at the boundary.

## Consequences

- One ping is **25 bytes, against 127 bytes** for the same ping as compact JSON:
  about 5× smaller before compression. This is a byte count, not a benchmark.
  Parse cost is measured in Layer 5, not assumed here.
- Frames are not human-readable. Anything that needs to inspect traffic has to go
  through `decodeFrame`.
- A layout change needs a version bump. Decoders reject versions they do not know.

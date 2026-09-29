# 0001 · Our own WebGL2 layer, not deck.gl or stock MapLibre layers

**Status:** accepted, 29 Sep 2026 (Layer 7)

## Context

The map must draw about 5,000 trucks that move every frame, from data that
changes about 4,300 times a second, without stalling the main thread. There
were three candidates:

1. **Stock MapLibre layers** (a GeoJSON source and a circle layer): built and
   measured in Layer 6.
2. **deck.gl**, the industry-standard WebGL data layer library. It would be a
   sound production choice.
3. **A MapLibre custom layer in raw WebGL2**, interpolating on the GPU.

## Decision

Option 3. Each truck's last 8 samples live in an RGBA32F texture. One
instanced draw call renders the fleet, and the vertex shader finds the two
samples around the display time and interpolates, every frame.

## Measured (same page, same laptop, headless Chrome with software WebGL)

| Truck layer | Long tasks in 10 s steady state | Frame interval p95 | Truck layer CPU per frame |
| --- | --- | --- | --- |
| Stock GeoJSON layer, refreshed at 2 Hz | 20–29 | 16.8 ms, but p99 66.7 ms (51–54 fps) | Hidden inside MapLibre (re-tiling + re-upload) |
| **This layer** | **0–1** | **16.8 ms, p99 16.9–17.1 ms (59–60 fps)** | **p50 0.1 ms, p95 0.3–0.4 ms**, at the timer's 0.1 ms resolution |
| No trucks at all | 0 | 16.8 ms, p99 17.0 ms (60 fps) | — |

The WebGL layer is indistinguishable from drawing no trucks at all. It also
moves every truck every frame, where the baseline jumps twice a second.

## Consequences

- deck.gl wasn't measured, so this is not a claim that it would be slower.
  deck.gl does what this layer does, and more. Writing the layer shows the
  mechanics deck.gl hides: instancing, GPU interpolation, relative-to-centre
  precision (ADR 0006), and context-loss recovery.
- The shader's algorithm has a TypeScript twin (`gpuEstimate`) that tests hold
  within 5 cm of Layer 4's `estimate()`. A change to one must be made to the
  other.
- **We own context-loss recovery.** MapLibre 5 destroys the style on context
  loss and does not restore custom layers, so the map owner re-adds the layer.
  Its data lives outside it, in `FleetGpuState`.
- The layer draws in 2-D (`renderingMode: "2d"`). Tilted 3-D views would need
  depth handling it doesn't have.

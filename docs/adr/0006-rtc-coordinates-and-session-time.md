# 0006 · Relative-to-centre positions and session-relative time on the GPU

**Status:** accepted, 29 Sep 2026 (Layer 7)

## Context

GPUs compute in float32. Two values the truck layer needs are too large for
float32 to hold precisely.

- **Position.** MapLibre's matrix expects world-normalised Mercator
  coordinates. In Lagos x ≈ 0.509, where float32 steps by 2⁻²⁴ of the world:
  **2.37 m** east–west, about 8 px at zoom 18. Trucks would wobble and drift off
  roads that MapLibre's own tile-relative layers draw correctly.
- **Time.** Epoch seconds (≈ 1.7 × 10⁹) step by **128 s** in float32. As a
  shader uniform, every truck would freeze and then teleport.

## Decision

- **Positions are float32 offsets from a fixed Lagos origin** (3.38° E,
  6.52° N). The origin is folded back into the projection matrix in **float64
  on the CPU** each frame (`rtcMatrix`), so no large number is ever rounded to
  float32. 22 km from the origin, float32 steps by 2⁻³⁴ of the world: **2.3 mm**.
- **Sample times and the display time are seconds since a session epoch**,
  fixed at the Worker's first report in whole seconds. After a full day that is
  86,400, where float32 steps by 1/128 s.
- **Velocity is converted metres → degrees → Mercator on the same mean-radius
  sphere the feed uses**, so the GPU projects a truck exactly as `estimate()`
  does. Converting with Web Mercator's own sphere (6,378,137 m) disagreed with
  the feed by 0.11%: 5.6 cm after 5 s of extrapolation.

## Consequences

- Each trap is demonstrated in a unit test with `Math.fround` and the next
  representable float32, so the reason for each fix sits in the suite.
- A fleet far from Lagos would need a different origin. The origin is a
  constant, not derived from the data.
- The session epoch resets when the Worker restarts. The page's GPU state
  clears its texture when the epoch changes.

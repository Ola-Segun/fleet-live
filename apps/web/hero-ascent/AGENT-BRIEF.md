# Fleet Live hero: the Ascent (implementation brief)

Audience: an AI coding agent working in the Fleet Live Next.js repo.
Goal: after the signal dial, the fleet lights no longer fade into the horizon. The lanes converge, **brake into a bend,
then shoot up a vertical launch channel** with visible rails. The result must look like a premium SaaS hero, in the
same material language as the dial and the footer.

Look at `reference/00-user-sketch.png` first (the owner's sketch), then `reference/01-desktop-1920x1080.png` (the target).

## 0. What is in this package

| Path | What it is |
| --- | --- |
| `src/ascent.ts` | **New.** The whole feature: motion model, path geometry, rails, hoops, gate, heads, sparks. Framework-free Canvas2D. |
| `src/scene.ts` | The existing `HeroScene`, **already patched** to use the ascent. Drop-in replacement for the file the owner uploaded. |
| `patches/scene.diff` | The same change as a unified diff, in case the repo's `scene.ts` has drifted. Apply by intent, not by line number. |
| `patches/FleetLiveHero.diff` | Accessibility text for the canvas only. No other hero TSX or CSS change is required. |
| `reference/` | Target renders (desktop, 0.12s launch sequence, phone, reduced motion, rail styles) and the original `scene.ts` for baselines. |
| `tools/` | Headless verification: render frames, measure the motion, compare cost. Run with `npm i` then the scripts in `package.json`. |

Status: `src/` was written and iterated against headless renders (node-canvas) and passes
`tsc --strict --noUncheckedIndexedAccess`. **It has not been run in a real browser.** Section 9 lists what you must verify there.

## 1. Integration steps

1. Copy `src/ascent.ts` next to the hero's `scene.ts` (same folder as `FleetLiveHero.tsx`).
2. Replace the repo's `scene.ts` with `src/scene.ts`, or apply `patches/scene.diff` by intent if the repo copy differs.
   The diff touches: the import, the `Placed` interface, laneZ's parameter type, the constructor, `resize()`, the
   top of `render()` (replaces `drawRails()`), agent placement, `drawAgent()`, the three alert helpers, and removes `drawRails()`.
3. Apply `patches/FleetLiveHero.diff` (the canvas `aria-label` now mentions the launch channel).
4. Run `npm run typecheck` and the checks in section 8.
5. Do **not** change the hero CSS unless a check in section 8 fails. The canvas already sits under the glass nav, so
   the lights pass behind the blurred nav pill, which is intended.

Optional: pass `ascent` overrides through `new HeroScene(canvas, { ascent: { ... } })` (section 7). Expose a prop on
`FleetLiveHero` only if the owner asks.

## 2. Design decisions (and why)

**Rails: machined metal with an inset light, plus a glass veil. Not literal glass tubes.**
The owner suggested glass-like railings and asked for a better way. Literal glass in Canvas2D over a dark teal
background reads as flat translucent rectangles: no refraction, low contrast, and it competes with the vehicles.
The hero's own material vocabulary is "anodized metal + frosted glass + one cool key light" (see the dial). So:

- **Guard rails** are tapered ribbons: dark anodized body, a 1px key-light edge on the left, a dark seam on the right,
  an inset **lime light channel** (brighter as it climbs), and a soft additive halo. They taper with perspective on the
  ground and stay constant in the channel.
- **Glass** appears only where glass is convincing: a frosted **veil** between the rails (a faint cool tint that is
  strongest in the climb), two brushed sheen strips, and glass-band hoops with a specular line.
- `railStyle: 'glass'` is available as a one-line alternative (translucent rods with brighter edges). See
  `reference/03-rail-style-machined-vs-glass.png`. Default is `machined`.

**Fittings (each earns its place):**
- **Lane fan:** all 13 lanes (5 on phones) now run from the dial back to the bend as hairlines, so the fleet is always
  visibly on rails. This is the "visible background railings" request.
- **Hoops (accelerator rings):** 8 glass hoops along the climb, placed at **equal time intervals**, so their spacing
  grows with speed (measured at 1080p: 31, 37, 43, 50, 57, 64, 72px from the bottom up). They are quiet until a vehicle
  passes, then light in sequence behind it. The spacing itself communicates acceleration. Perspective is physical: a
  hoop is a flat line at eye level and opens into an ellipse above and below it, with the near arc in front of the traffic.
- **Throat gate:** a machined collar where the bend ends and the climb begins, with one index light per lane that
  flashes as that lane's vehicle is launched. It is the "handoff" from ground to ascent.
- **Light spill:** as a vehicle whips past, its light spills onto both guard rails at its height.
- **Exit glow:** a soft glow where the lights leave the top of the hero (behind the nav). It swells when a vehicle exits.
- **Sparks:** up to 48 tiny additive sparks shed as vehicles enter the climb.
- **Column glow:** a faint vertical light inside the channel that swells with traffic.

## 3. Motion spec

Vehicles are **stateless**: position is a pure function of time. This keeps reduced-motion's static frame, the alert
system and tests simple. `Ascent.state(offset, sp, t)` returns `{ ascending, u, x }`.

Each vehicle loops: **ground phase** (log-depth `u` from the dial to the bend) then **climb phase** (`x` from 0 to 1).

**Ground phase.** `u` advances at the existing rate `sp` times a multiplier `m(u)`:
- `m = 1` near the dial (identical to the original, so alerts are unaffected),
- ramps up to `cruise` (3.0) between depth 20 and 28 so the far approach reads as motion, not a crawl,
- **brakes** to `brake` (0.36) over the last `brakeSpan` (0.17) of `u` before the bend.
The time law is the integral of `1/m`, inverted once into a lookup table.

**Climb phase.** Fraction of the climb covered at time fraction `x`: `q(x) = c*x + (1-c)*x^p` with `c = 0.05`, `p = 2.7`.
It starts slow and ends very fast. The climb duration is derived so the top speed is `topSpeed` (1150 px/s at 1080p).

Measured at 1920x1080 (`npm run analyze`):

| Where | Screen speed |
| --- | --- |
| Ground approach at 25%, 50%, 75%, 95% of ground time | 74, 40, 21, 17 px/s |
| **Entering the bend** | **12 px/s** (the "slows down" moment) |
| Climb at 0%, 25%, 50%, 75%, 100% of climb time | 22, 127, 364, 704, **1132 px/s** (the "shoots up") |

Other numbers: climb takes 1.12s; ground cycle is 15.3s; **2 to 4 vehicles are on the climb at all times**; 39 vehicles on desktop.

**Even launches.** All vehicles share one rate (`sp = 0.054`), and `Ascent.stratify()` re-phases them once (after the
first frame, when the climb time is known) so launches are spread evenly with +-35% jitter. Do not give vehicles
different rates again: it makes launches bunch and leaves the column empty at times (measured: min 0 in flight).

**Streaks.** A vehicle's trail length is `0.19 * speed` (clamped 10 to 260px at 1080p), so the streak lengthens visibly
as it accelerates. Brightness continues from the ground value at the bend (no pop), then flares.

**Alerts.** The zone-exit alert uses `stateU()` (time-based, ground-only) instead of the old constant-rate formula, so
its geometry stays consistent. The boost ramp starts at depth 20 on purpose: alert vehicles (depth 9 to 21) behave as before.

## 4. Geometry spec

Everything is screen-space, recomputed every frame from the scene's projection (so pointer parallax, scroll zoom and
the entry zoom move the channel with the world).

- **Ground:** each lane (plus two virtual guard lanes just outside the bundle) is sampled in 14 log-spaced depths from
  the dial back to `bendDepth` (30).
- **Bend:** a cubic Bezier from the lane's ground end, leaving along its perspective tangent and arriving **vertical**,
  lifted by `bendRise` (84px at 1080p). Control length is 0.4 of the chord.
- **Channel:** the lane bundle is compressed to `taper` (0.5) of its width, plus `guardGap` (12px) per side for the guard
  rails. Channel centre is the lane-bundle centre at the bend, so it lines up with the vanishing point (about x = 0.66w at 1920).
- **Climb:** straight up to `top` (-30px, above the hero edge on desktop).
- Rail width: perspective-scaled on the ground (1.3 to 7px), `railWidth` (4.6px) in the channel.

## 5. Render pipeline (order matters)

Inside `HeroScene.render()`:
1. existing atmosphere/curtain
2. `asc.frame(af)` (geometry, hoop positions, decay of light state) then, once, `asc.stratify()`
3. `asc.drawBack()`: column glow, glass veil + sheen, hoop back arcs, lane hairlines, guard rails, throat gate
4. vehicles sorted far to near; vehicles on the climb draw first via `asc.drawHead()`, ground vehicles as before
5. existing dial
6. `asc.drawFront()`: hoop front arcs and clamps, exit glow, sparks
7. existing alert overlay

All ascent drawing is `source-over` or `lighter`. **No `mix-blend-mode`, no `filter`, no `shadowBlur`** (footer README rule; cost).

## 6. Responsive, reduced motion, accessibility

- **Phones (< 820px):** 5 lanes, channel gain 0.8, 0.72 size scale, 5 hoops, and the channel ends at `VY - 0.24 * H`
  instead of leaving the hero, fading out near its top. On phones the copy block sits above the horizon, so the climb
  runs up behind the lower part of the copy. **Verify legibility with the real copy** (section 9); if the sub-line is
  hard to read, shorten the climb: lower the `0.24`, or set `top` from `layout.topInset`.
- **Reduced motion:** static frame at `t = 9` (existing behaviour). It shows vehicles frozen mid-launch with lit hoops
  (`reference/05-reduced-motion-static.png`). No sparks, no decay, no exit pulse. Keep it that way.
- **Accessibility:** the canvas stays `role="img"`; its label is updated (patch). The channel is decorative.
- **Scroll:** channel gain eases to 50% as the hero scrolls away (`1 - 0.5 * scroll`).

## 7. Config reference (`ASCENT` in `src/ascent.ts`, override via `SceneOptions.ascent`)

| Key | Default | Effect |
| --- | --- | --- |
| `bendDepth` | 30 | Where lanes leave the ground. Lower = bigger, lower bend. |
| `bendRise` | 84 | Bend height (px at 1080p). More = rounder bend. |
| `taper` / `guardGap` / `railWidth` | 0.5 / 12 / 4.6 | Channel width, rail gap, rail thickness. The owner's sketch is narrower than lanes-at-bend; do not go below `taper 0.4`, vehicle glows overlap. |
| `topSpeed` | 1150 | Speed at the top (px/s at 1080p). Sets the climb duration. |
| `launchPower` / `launchBase` | 2.7 / 0.05 | Climb curve: higher power = slower start, harder launch. |
| `cruise` / `brake` / `brakeSpan` | 3.0 / 0.36 / 0.17 | Ground approach: far-zone boost, braking multiplier, how long it brakes for. |
| `rings` | 8 | Hoop count on desktop. |
| `ringDecay` | 0.16 | Seconds a hoop stays lit. |
| `sparks` / `gate` | true / true | Toggle fittings. |
| `railStyle` | `'machined'` | `'glass'` for translucent rods. |

## 8. Verification

```bash
npm i
npm run typecheck          # strict, noUncheckedIndexedAccess
npm run analyze            # climb time, vehicles in flight, speed profile (expect the table in section 3)
npm run frame              # writes out/frame-t10_24.png; compare with reference/01-desktop-1920x1080.png
npm run perf               # relative cost vs reference/scene.original.ts (software canvas, see section 9)
```

Acceptance checklist:
- [ ] `analyze`: speed at bend entry is below 20 px/s; top-of-climb speed above 1000 px/s; vehicles in flight never 0.
- [ ] 1920x1080: channel rises from the lane fan at about x = 0.66w, reads like `00-user-sketch.png`, does not touch the headline.
- [ ] 1440, 1280, 1100px: the channel does not collide with the headline's last word. If it does at a width, shift the
      channel right or dim it where it overlaps the copy; do not move the headline.
- [ ] 390x844: copy is still legible (WCAG AA for the sub-line against the canvas).
- [ ] `prefers-reduced-motion`: static frame, no animation frames requested.
- [ ] Zone-exit alert still appears near the dial, not up the channel.
- [ ] Counters still increment as before.
- [ ] No console errors; `HeroScene.destroy()` leaves no listeners (unchanged).

## 9. Not verified: do these in a real browser

I rendered with node-canvas (Cairo), not Chrome. So:
1. **Performance.** In software raster the new scene costs about 83 ms vs 63 ms per frame (about +30%), dominated by the
   large veil fill, the column-glow stretch and the guard-rail gradients. That is not representative of a GPU-backed
   canvas, but **profile in Chrome** (Performance panel, 1920x1080, DPR 2, 4x CPU throttle). Budget: added scripting plus
   raster under about 2 ms/frame on desktop. If over budget, in this order: (a) cache the static back layer
   (rails, veil, hoop backs) in an offscreen canvas keyed on `VX, VY, Fe, cz, ch, W, H` and redraw only when they change;
   (b) drop the two sheen strips; (c) lower `rings`; (d) cap DPR at 1.5 for the channel.
2. **The real hero.** My renders composite the canvas over an approximated background with a stand-in headline and nav.
   Check the real CSS scrim, the glass nav (lights should be visible but blurred behind it), and the real headline wrap.
3. **Phones with real copy** (section 6).
4. **Device pixel ratio.** All widths are CSS px; confirm hairlines (1.2px) look right at DPR 1, 2 and 3.
5. **Safari.** `ctx.roundRect` has a rect fallback; confirm the gate renders.

## 10. Rules

- Keep `render()` allocation-free: scratch buffers in `Ascent` are preallocated, keep it that way (no `new`, no array
  literals in per-frame paths).
- Keep ascent state stateless where possible; the only mutable per-frame state is light decay, the spark pool and
  `prevX` edge detection. Do not add per-vehicle objects.
- Do not add dependencies. Do not add `mix-blend-mode`, CSS filters or large blurred layers over the canvas.
- Do not change the headline, copy or buttons. Do not make the vehicles bigger to compensate for the narrow channel.
- Keep the lime accent as the single accent. Do not add new colours.
- If you change a number, re-run `npm run analyze` and update the table in section 3.

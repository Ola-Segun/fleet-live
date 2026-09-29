import { FLAG_PARKED, FLOATS_PER_VEHICLE, SAMPLES_PER_VEHICLE } from "./layout";

/** Estimate modes as the shader numbers them. Shared with the page's snapshot so both agree. */
export const MODE_CODES = {
  waiting: 0,
  interpolated: 1,
  extrapolated: 2,
  holding: 3,
  parked: 4,
  stale: 5,
} as const;
export type ModeName = keyof typeof MODE_CODES;
export const MODES: readonly ModeName[] = ["waiting", "interpolated", "extrapolated", "holding", "parked", "stale"];

export interface StalenessRules {
  /** Seconds past the newest sample a moving truck is projected. */
  extrapolateS: number;
  movingStaleS: number;
  parkedStaleS: number;
}

export const DEFAULT_STALENESS: StalenessRules = { extrapolateS: 5, movingStaleS: 10, parkedStaleS: 90 };

export interface GpuEstimate {
  /** Mercator offset from the origin. */
  x: number;
  y: number;
  heading: number;
  mode: number;
}

const f = Math.fround;

/**
 * The vertex shader's algorithm, line for line, in TypeScript. Arithmetic is
 * rounded to float32 where the GPU works in float32, so tests check what the
 * GPU will compute, not an idealised version.
 *
 * It reads one vehicle's 36 packed floats and a display time in session
 * seconds. It is kept deliberately parallel to `VEHICLE_VERTEX_SHADER`: a change
 * to one must be made to the other, and the correspondence test compares this
 * with Layer 4's `estimate()`.
 */
export function gpuEstimate(data: Float32Array, offset: number, time: number, rules: StalenessRules = DEFAULT_STALENESS): GpuEstimate | undefined {
  const at = (k: number) => offset + k * 4;
  const meta = at(SAMPLES_PER_VEHICLE);
  if (data[meta + 3]! < 1) return undefined;

  const t = f(time);
  const first = at(0);
  const last = at(SAMPLES_PER_VEHICLE - 1);

  if (t < data[first + 2]!) {
    return { x: data[first]!, y: data[first + 1]!, heading: data[first + 3]!, mode: MODE_CODES.waiting };
  }

  if (t < data[last + 2]!) {
    for (let k = 0; k < SAMPLES_PER_VEHICLE - 1; k++) {
      const a = at(k);
      const b = at(k + 1);
      if (t >= data[a + 2]! && t < data[b + 2]!) {
        const span = f(data[b + 2]! - data[a + 2]!);
        const u = f(f(t - data[a + 2]!) / Math.max(span, 1e-6));
        return {
          x: f(data[a]! + f(f(data[b]! - data[a]!) * u)),
          y: f(data[a + 1]! + f(f(data[b + 1]! - data[a + 1]!) * u)),
          heading: lerpHeading32(data[a + 3]!, data[b + 3]!, u),
          mode: MODE_CODES.interpolated,
        };
      }
    }
  }

  const age = f(t - data[last + 2]!);
  const heading = data[last + 3]!;
  if (data[meta + 2]! === FLAG_PARKED) {
    return { x: data[last]!, y: data[last + 1]!, heading, mode: age > rules.parkedStaleS ? MODE_CODES.stale : MODE_CODES.parked };
  }
  const s = Math.min(age, rules.extrapolateS);
  return {
    x: f(data[last]! + f(data[meta]! * s)),
    y: f(data[last + 1]! + f(data[meta + 1]! * s)),
    heading,
    mode: age > rules.movingStaleS ? MODE_CODES.stale : age > rules.extrapolateS ? MODE_CODES.holding : MODE_CODES.extrapolated,
  };
}

function lerpHeading32(a: number, b: number, u: number): number {
  // GLSL mod(x, y) = x − y·floor(x / y), which differs from JS `%` for negatives.
  const mod = (x: number, y: number) => x - y * Math.floor(x / y);
  const delta = mod(b - a + 540, 360) - 180;
  return f(mod(a + delta * u, 360));
}

export { FLOATS_PER_VEHICLE };

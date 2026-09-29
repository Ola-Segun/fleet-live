import { ORIGIN_X, ORIGIN_Y } from "./layout";

/**
 * MapLibre's projection matrix with the Lagos origin folded in:
 * `M · T(originX, originY, 0)`, column-major.
 *
 * This runs in float64 on the CPU every frame, *before* anything becomes
 * float32. That's the other half of relative-to-centre rendering: the GPU
 * multiplies small float32 offsets by a matrix that already contains the big
 * translation at full precision, so no large number is ever rounded to float32.
 *
 * Only the translation column changes: column 3 becomes M·(ox, oy, 0, 1).
 */
export function rtcMatrix<T extends Float32Array | Float64Array>(m: ArrayLike<number>, out: T): T {
  for (let i = 0; i < 12; i++) out[i] = m[i]!;
  for (let r = 0; r < 4; r++) out[12 + r] = m[r]! * ORIGIN_X + m[4 + r]! * ORIGIN_Y + m[12 + r]!;
  return out;
}

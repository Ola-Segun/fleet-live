import { PingFlag } from "@fleet/protocol";
import type { ResolvedSample } from "@fleet/feed";
import { EARTH_RADIUS_M } from "@fleet/routes";

/*
 * How each vehicle is laid out in the GPU's sample texture (RGBA32F).
 *
 *   texel 0–7   the last 8 samples, oldest first: (x, y, t, heading)
 *   texel 8     metadata: (vx, vy, flags, sampleCount)
 *
 * x, y are **Web Mercator offsets from a fixed Lagos origin**, not absolute
 * Mercator coordinates. Absolute x in Lagos is ≈ 0.509, where float32 can only
 * step by 2⁻²⁴ ≈ 6 × 10⁻⁸ of the world, about 2.4 m east–west, which is ~8 px at
 * zoom 18. Offsets are small numbers with millimetre steps. The origin is folded
 * back into the matrix in float64 on the CPU (see matrix.ts).
 *
 * t is **seconds since the session epoch**, not epoch time. Epoch seconds
 * (≈ 1.7 × 10⁹) step by 128 s in float32; session seconds after a whole day
 * (86,400) step by 1/128 s.
 *
 * 8 samples cover the widest display delay (5 s) with room to spare at 1 Hz, and
 * four minutes of a parked truck at one report per 30 s.
 */
export const SAMPLES_PER_VEHICLE = 8;
export const TEXELS_PER_VEHICLE = SAMPLES_PER_VEHICLE + 1;
export const FLOATS_PER_VEHICLE = TEXELS_PER_VEHICLE * 4;
/**
 * Vehicles per texture row. 200 × 9 = 1,800 texels wide, under the 2,048 that
 * WebGL2 guarantees as a minimum MAX_TEXTURE_SIZE, so the layout works on any
 * conforming device. A single column of 5,000+ rows would not.
 */
export const VEHICLES_PER_ROW = 200;
export const TEXTURE_WIDTH = VEHICLES_PER_ROW * TEXELS_PER_VEHICLE;

export const FLAG_PARKED = 1;

/** Lagos, the RTC origin: every position on the GPU is an offset from here. */
export const ORIGIN_LNG = 3.38;
export const ORIGIN_LAT = 6.52;

/** Web Mercator, as MapLibre computes it: the world is [0, 1] × [0, 1], y growing southwards. */
export const mercatorX = (lng: number): number => (180 + lng) / 360;
export const mercatorY = (lat: number): number =>
  (180 - (180 / Math.PI) * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360))) / 360;

export const ORIGIN_X = mercatorX(ORIGIN_LNG);
export const ORIGIN_Y = mercatorY(ORIGIN_LAT);

/**
 * Metres per degree of latitude, on the same mean-radius sphere the feed and
 * the route geometry use. Velocity is converted metres → degrees → Mercator
 * through this, so the GPU projects a truck exactly as `estimate()` does.
 * Converting straight to Mercator with Web Mercator's own sphere (6,378,137 m)
 * disagreed with the feed by 0.11%: 5.6 cm after 5 s of extrapolation.
 */
export const METRES_PER_DEG = (EARTH_RADIUS_M * Math.PI) / 180;

export function textureHeight(capacity: number): number {
  return Math.max(1, Math.ceil(capacity / VEHICLES_PER_ROW));
}

/** Mercator offset from the origin back to [lat, lon]: the inverse of what packVehicle writes. */
export function fromOffset(dx: number, dy: number): [lat: number, lon: number] {
  const x = dx + ORIGIN_X;
  const y = dy + ORIGIN_Y;
  const lat = (360 / Math.PI) * Math.atan(Math.exp(((180 - y * 360) * Math.PI) / 180)) - 90;
  return [lat, x * 360 - 180];
}

/** Where vehicle `slot`'s 36 floats start in a mirror's data array. */
export function slotOffset(slot: number): number {
  return (Math.floor(slot / VEHICLES_PER_ROW) * TEXTURE_WIDTH + (slot % VEHICLES_PER_ROW) * TEXELS_PER_VEHICLE) * 4;
}

/** Texel coordinates of texel `k` of vehicle `slot`. The shader computes the same. */
export function texelOf(slot: number, k: number): [x: number, y: number] {
  return [(slot % VEHICLES_PER_ROW) * TEXELS_PER_VEHICLE + k, Math.floor(slot / VEHICLES_PER_ROW)];
}

/**
 * Writes one vehicle's 36 floats into `out` at `offset`: its newest 8 samples
 * (padded at the front by repeating the oldest, so the shader never branches on
 * a count) and its metadata. `epoch` is the session epoch, ms.
 *
 * Velocity comes from the device's reported speed and heading (precomputed on
 * insert as vx, vy in m/s east and north), converted to Mercator units per
 * second through degrees (see METRES_PER_DEG).
 */
export function packVehicle(samples: readonly ResolvedSample[], epoch: number, out: Float32Array, offset: number): void {
  const n = samples.length;
  if (n === 0) {
    out.fill(0, offset, offset + FLOATS_PER_VEHICLE);
    return;
  }
  const newest = samples.slice(-SAMPLES_PER_VEHICLE);
  for (let k = 0; k < SAMPLES_PER_VEHICLE; k++) {
    const s = newest[Math.max(0, k - (SAMPLES_PER_VEHICLE - newest.length))]!;
    const o = offset + k * 4;
    out[o] = mercatorX(s.smoothLon) - ORIGIN_X;
    out[o + 1] = mercatorY(s.smoothLat) - ORIGIN_Y;
    out[o + 2] = (s.time - epoch) / 1000;
    out[o + 3] = s.heading;
  }
  const last = newest[newest.length - 1]!;
  const cosLat = Math.cos((last.smoothLat * Math.PI) / 180);
  const parked = !(last.flags & PingFlag.Ignition) || last.speed < 0.5;
  const m = offset + SAMPLES_PER_VEHICLE * 4;
  // m/s → degrees/s → Mercator units/s. dX/dλ = 1/360; dY/dφ = −sec φ / 360 (y grows southwards).
  out[m] = last.vx / (METRES_PER_DEG * cosLat) / 360;
  out[m + 1] = -(last.vy / METRES_PER_DEG) / (360 * cosLat);
  out[m + 2] = parked ? FLAG_PARKED : 0;
  out[m + 3] = newest.length;
}

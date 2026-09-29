import { FLOATS_PER_VEHICLE, TEXTURE_WIDTH, VEHICLES_PER_ROW, textureHeight } from "./layout";

/**
 * The page's copy of the GPU sample texture, as one Float32Array.
 *
 * The Worker sends only the vehicles that changed, as (slot, 36 floats) rows.
 * They are written here, and the whole array is uploaded in one
 * `texSubImage2D` the next time the layer draws. At 5,000 vehicles that's
 * 25 rows × 1,800 texels × 16 bytes = 720 KB, cheap for any GPU and one call
 * instead of hundreds.
 *
 * The copy also survives a lost WebGL context: when the context comes back,
 * the texture is rebuilt from here, with no need to ask the Worker again.
 */
export class SampleMirror {
  data: Float32Array;
  capacity: number;
  count = 0;
  dirty = true;

  constructor(capacity = 1024) {
    this.capacity = roundUp(capacity);
    this.data = new Float32Array(TEXTURE_WIDTH * textureHeight(this.capacity) * 4);
  }

  get height(): number {
    return textureHeight(this.capacity);
  }

  /** Apply changed rows from the Worker. `slots[i]`'s 36 floats are at `rows[i * 36 …]`. */
  apply(slots: Uint32Array, rows: Float32Array, count: number): void {
    if (count > this.capacity) this.grow(count);
    this.count = Math.max(this.count, count);
    for (let i = 0; i < slots.length; i++) {
      const slot = slots[i]!;
      const x = (slot % VEHICLES_PER_ROW) * FLOATS_PER_VEHICLE;
      const y = Math.floor(slot / VEHICLES_PER_ROW);
      this.data.set(rows.subarray(i * FLOATS_PER_VEHICLE, (i + 1) * FLOATS_PER_VEHICLE), y * TEXTURE_WIDTH * 4 + x);
    }
    if (slots.length > 0) this.dirty = true;
  }

  private grow(count: number): void {
    const next = new Float32Array(TEXTURE_WIDTH * textureHeight(roundUp(count)) * 4);
    next.set(this.data);
    this.data = next;
    this.capacity = roundUp(count);
    this.dirty = true;
  }
}

/** Capacity in whole texture rows, so growing never reshuffles existing slots. */
const roundUp = (n: number) => Math.max(VEHICLES_PER_ROW, Math.ceil(n / VEHICLES_PER_ROW) * VEHICLES_PER_ROW);

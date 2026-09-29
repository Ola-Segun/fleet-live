/**
 * A seeded random number generator with independent named streams.
 *
 * `Math.random()` can't be seeded, so a run can never be repeated. This uses
 * sfc32 (Chris Doty-Humphrey's Small Fast Chaotic generator, 128-bit state,
 * passes PractRand), seeded through splitmix32.
 *
 * **Streams are forked by name, from the seed, not from the current state.**
 * `rng.fork("vehicle:42:motion")` gives the same sequence no matter how many
 * numbers anything else has drawn. That is what keeps the simulation stable
 * under change: adding a vehicle, or turning the chaos up, does not alter the
 * path any other truck drives. A single shared stream would make every change
 * ripple through every later draw.
 */
export interface Rng {
  /** The seed this stream was created from. */
  readonly seed: number;
  /** Uniform in [0, 1). */
  next(): number;
  /** Uniform in [min, max). */
  range(min: number, max: number): number;
  /** Uniform integer in [min, max], both inclusive. */
  int(min: number, max: number): number;
  /** Gaussian (Box–Muller). */
  normal(mean?: number, sd?: number): number;
  chance(probability: number): boolean;
  pick<T>(items: readonly T[]): T;
  /** An independent stream derived from this stream's seed and a label. */
  fork(label: string): Rng;
}

/** FNV-1a over UTF-16 code units, mixed with a seed, then murmur3's fmix32 finaliser. */
export function hash32(text: string, seed = 0): number {
  let h = (0x811c9dc5 ^ seed) >>> 0;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

function splitmix32(state: number): () => number {
  let a = state | 0;
  return () => {
    a = (a + 0x9e3779b9) | 0;
    let t = a ^ (a >>> 16);
    t = Math.imul(t, 0x21f0aaad);
    t ^= t >>> 15;
    t = Math.imul(t, 0x735a2d97);
    return (t ^ (t >>> 15)) >>> 0;
  };
}

function sfc32(a: number, b: number, c: number, d: number): () => number {
  return () => {
    a |= 0;
    b |= 0;
    c |= 0;
    d |= 0;
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    return (t >>> 0) / 4_294_967_296;
  };
}

export function createRng(seed: number | string): Rng {
  const numericSeed = typeof seed === "string" ? hash32(seed) : seed >>> 0;
  const init = splitmix32(numericSeed);
  const next = sfc32(init(), init(), init(), init());
  // Discard the first outputs, as sfc32's author recommends, so similar seeds diverge.
  for (let i = 0; i < 12; i++) next();

  const rng: Rng = {
    seed: numericSeed,
    next,
    range: (min, max) => min + next() * (max - min),
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    normal: (mean = 0, sd = 1) => {
      // 1 − next() is in (0, 1], so the logarithm is never of zero.
      const u = 1 - next();
      const v = next();
      return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    },
    chance: (probability) => next() < probability,
    pick: <T>(items: readonly T[]): T => {
      if (items.length === 0) throw new RangeError("cannot pick from an empty list");
      return items[Math.floor(next() * items.length)]!;
    },
    fork: (label) => createRng(hash32(label, numericSeed)),
  };
  return rng;
}

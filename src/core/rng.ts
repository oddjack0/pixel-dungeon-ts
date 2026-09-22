/**
 * Seeded RNG (mulberry32). One instance per run — ALL game randomness
 * (dungeon gen, drops, combat rolls) flows through it, so runs are
 * deterministic and replayable from the seed.
 *
 * API (per SPEC contract §5):
 *   int(a, b)          integer in [a, b)
 *   float(a, b)        float in [a, b)
 *   intRange(a, b)     integer in [a, b] (inclusive)
 *   normalIntRange(a,b) triangular integer in [a, b] (watabou's NormalIntRange)
 *   pick(arr)          uniform element
 */
export class RNG {
  /** Internal mulberry32 state. Serialized for save/load. */
  private s: number;
  /** The original seed (for deriving depth-varying sub-seeds). */
  readonly seed: number;

  constructor(seed: number) {
    this.seed = seed >>> 0;
    this.s = this.seed || 0x9e3779b9;
  }

  /** Float in [0, 1). The single entropy source. */
  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Float in [min, max). */
  float(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** Integer in [min, max). Matches watabou's `Random.Int(min, max)`. */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * Math.max(0, max - min));
  }

  /** Integer in [min, max], inclusive. */
  intRange(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  /**
   * Triangular integer in [min, max]: the average of two uniform draws
   * over [min, max+1), truncated to int — watabou's `Random.NormalIntRange`.
   */
  normalIntRange(min: number, max: number): number {
    const a = this.float(min, max + 1);
    const b = this.float(min, max + 1);
    return Math.floor((a + b) / 2);
  }

  /** True with probability p (0..1). */
  chance(p: number): boolean {
    return this.next() < p;
  }

  /** Uniform random element. */
  pick<T>(arr: readonly T[]): T {
    if (arr.length === 0) throw new Error('RNG.pick: empty array');
    return arr[Math.floor(this.next() * arr.length)];
  }

  /** In-place Fisher–Yates shuffle. */
  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      const tmp = arr[i]!;
      arr[i] = arr[j]!;
      arr[j] = tmp;
    }
    return arr;
  }

  /** Serialize internal state for save/load (round-trips the stream exactly). */
  serialize(): number {
    return this.s >>> 0;
  }

  /** Restore a stream previously captured with serialize(). */
  static restore(seed: number, state: number): RNG {
    const rng = new RNG(seed);
    rng.s = state >>> 0;
    return rng;
  }

  /**
   * Derive an independent sub-stream, e.g. one per depth, without
   * disturbing the parent stream's draw order.
   */
  subSeed(salt: number): RNG {
    let h = (this.seed ^ Math.imul(salt | 0, 0x9e3779b9)) >>> 0;
    h = Math.imul(h ^ (h >>> 16), 0x21f0aaad);
    h = Math.imul(h ^ (h >>> 15), 0x735a2d97);
    return new RNG((h ^ (h >>> 15)) >>> 0);
  }
}

/** Stable string -> uint32 hash, for turning e.g. "?seed=dragon" into a numeric seed. */
export function hashSeed(text: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

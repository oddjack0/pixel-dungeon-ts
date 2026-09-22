/**
 * Seeded RNG contract for the mechanics layer (SPEC contract 5, binding).
 *
 * `src/core/rng.ts` provides the single run-wide `RNG` (mulberry32); it
 * satisfies this interface structurally. ALL randomness flows through it —
 * there is no second stream (save determinism depends on the single
 * serialized stream).
 *
 * Bounds mirror watabou's `com.watabou.utils.Random` semantics (see
 * references/mechanics-reference.md, "RNG conventions"):
 *   Random.Float(x)          -> [0, x)
 *   Random.Int(a, b)         -> [a, b)
 *   Random.IntRange(a, b)    -> [a, b]
 *   Random.NormalIntRange    -> triangular int in [a, b]
 */
export interface MechanicsRng {
  /** Uniform float in [min, max). Port of Random.Float(min, max) / Random.Float(x). */
  float(min: number, max: number): number;
  /** Uniform int in [min, max). Port of Random.Int(a, b). */
  int(min: number, max: number): number;
  /** Uniform int in [min, max]. Port of Random.IntRange(a, b). */
  intRange(min: number, max: number): number;
  /** Triangular (bell-ish) int in [min, max]. Port of Random.NormalIntRange(a, b). */
  normalIntRange(min: number, max: number): number;
  /** Uniform element of arr. Port of Random.element(arr). */
  pick<T>(arr: readonly T[]): T;
}

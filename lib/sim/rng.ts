import { xoroshiro128plus } from "pure-rand/generator/xoroshiro128plus";
import { uniformInt } from "pure-rand/distribution/uniformInt";
import { uniformFloat64 } from "pure-rand/distribution/uniformFloat64";

// The single source of entropy for the simulation core.
// Never call the global Math random function in lib/sim/, workers/, or any
// downstream module; thread an RNG argument instead.
//
// Determinism guarantee: two RNG instances created with the same seed will
// produce identical sequences of values regardless of call order between them.
//
// Implementation note: pure-rand v8 uses a mutable generator model — each
// distribution call (uniformInt, uniformFloat64) invokes gen.next() internally,
// advancing the generator state in place. The factory closes over a single
// mutable xoroshiro128plus instance; callers interact only with this RNG interface.
//
// nextFloat() uses pure-rand's uniformFloat64 which generates a 53-bit mantissa
// from the generator's output, producing values uniformly in [0, 1).

export interface RNG {
  /** Uniform integer in [min, max] inclusive. Throws if min > max. */
  nextInt(min: number, max: number): number;
  /** Uniform float in [0, 1). */
  nextFloat(): number;
  /** Uniformly pick one element. Throws if items is empty. */
  pick<T>(items: readonly T[]): T;
  /**
   * Weighted pick. weights[i] is the relative probability of items[i].
   * Throws if lengths mismatch, any weight is negative, or all weights are zero.
   */
  pickWeighted<T>(items: readonly T[], weights: readonly number[]): T;
  /**
   * Return a new array that is a random permutation of items.
   * Does NOT mutate the input array.
   */
  shuffle<T>(items: readonly T[]): T[];
}

export function createRNG(seed: number): RNG {
  const gen = xoroshiro128plus(seed);

  return {
    nextInt(min: number, max: number): number {
      if (min > max) {
        throw new RangeError(
          `nextInt: min (${min}) must be <= max (${max})`
        );
      }
      return uniformInt(gen, min, max);
    },

    nextFloat(): number {
      return uniformFloat64(gen);
    },

    pick<T>(items: readonly T[]): T {
      if (items.length === 0) {
        throw new RangeError("pick: items array must not be empty");
      }
      return items[uniformInt(gen, 0, items.length - 1)];
    },

    pickWeighted<T>(items: readonly T[], weights: readonly number[]): T {
      if (items.length !== weights.length) {
        throw new RangeError(
          `pickWeighted: items.length (${items.length}) !== weights.length (${weights.length})`
        );
      }
      let total = 0;
      for (const w of weights) {
        if (w < 0) {
          throw new RangeError(`pickWeighted: negative weight ${w}`);
        }
        total += w;
      }
      if (total === 0) {
        throw new RangeError("pickWeighted: all weights are zero");
      }
      const draw = uniformFloat64(gen) * total;
      let cumulative = 0;
      for (let i = 0; i < items.length; i++) {
        cumulative += weights[i];
        if (draw < cumulative) return items[i];
      }
      // Fallback: floating-point rounding can push draw == total exactly.
      return items[items.length - 1];
    },

    shuffle<T>(items: readonly T[]): T[] {
      const result = [...items];
      for (let i = result.length - 1; i > 0; i--) {
        const j = uniformInt(gen, 0, i);
        const tmp = result[i];
        result[i] = result[j];
        result[j] = tmp;
      }
      return result;
    },
  };
}

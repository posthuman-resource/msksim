// Cosine similarity and top-K token vector helpers for preferential attachment.
// Per docs/spec.md §11 OQ7 — "use softmax over cosine similarity between
// top-weighted token vectors, with a temperature parameter."
//
// This module is client-safe, server-safe, and worker-safe — it deliberately
// does NOT carry `import 'server-only'`. Step 20 imports it from the Web Worker.
//
// All functions are pure and deterministic:
//   - same inputs → same output
//   - no Math.random, no Date.now, no global state
//   - floating-point is IEEE 754 deterministic on x86/ARM

import type { Inventory } from './types';

// ─── Public types ─────────────────────────────────────────────────────────────

/**
 * A flat weight vector keyed on the `${language}:${lexeme}` composite string
 * produced by `tokenKey()`. Using a flat Map (vs. nested Map<Language, Map<…>>)
 * lets cosine similarity walk the union of keys in a single loop.
 * Map iteration order is insertion order (ES2015 guarantee), so token vectors
 * are portable across postMessage without needing custom serialization.
 */
export type TokenVector = ReadonlyMap<string, number>;

// ─── cosineSimilarity ─────────────────────────────────────────────────────────

/**
 * Cosine similarity between two token weight vectors.
 *
 * Range: [0, 1] (weights are non-negative per the Zod schema, so the dot
 * product is always non-negative and the result never falls below 0).
 *
 * Edge cases:
 *   - Either or both vectors have zero L2 norm → returns 0.
 *     This treats zero-weight agents as "orthogonal to everyone," which the
 *     downstream softmax then collapses to a uniform distribution (no preference).
 *   - Both vectors are empty → returns 0 (not NaN).
 *
 * Implementation: single pass over the union of keys to accumulate
 * dotProduct, normASq, normBSq without allocating intermediate arrays.
 */
export function cosineSimilarity(a: TokenVector, b: TokenVector): number {
  let dotProduct = 0;
  let normASq = 0;
  let normBSq = 0;

  // Walk keys from `a`, contributing to normASq and dotProduct.
  for (const [key, av] of a) {
    const bv = b.get(key) ?? 0;
    dotProduct += av * bv;
    normASq += av * av;
  }

  // Walk keys from `b` for any keys not already seen in `a`.
  for (const [key, bv] of b) {
    normBSq += bv * bv;
    // Cross-terms for keys shared with `a` were already counted above.
    if (!a.has(key)) {
      // dotProduct += 0 * bv (a has no entry → contributes 0)
      // normASq += 0 (no a-contribution for this key)
    }
  }

  const denom = Math.sqrt(normASq) * Math.sqrt(normBSq);
  if (denom === 0) return 0;
  return dotProduct / denom;
}

// ─── euclideanDistanceSq ──────────────────────────────────────────────────────

/**
 * Squared Euclidean distance between two token weight vectors.
 *
 * Used by the gaussian success policy (step 33) — the kernel
 * `Ps = exp(-‖a - b‖² / (2σ²))` evaluates the squared norm directly, so we
 * skip the `Math.sqrt` and let the caller hand the value to `Math.exp`.
 *
 * Range: [0, ∞).
 *
 * Edge cases:
 *   - Identical vectors → 0 (exact, not just close-to-zero).
 *   - Two empty vectors → 0 (no NaN, no division).
 *   - Missing keys are treated as 0 weight (so `(av - 0)² = av²`).
 *
 * Symmetric in its arguments by construction: every key in `a` and every
 * key in `b` is visited exactly once. No allocations beyond iterator state.
 */
export function euclideanDistanceSq(a: TokenVector, b: TokenVector): number {
  let sum = 0;

  // Walk keys from `a` — captures both shared keys and a-only keys.
  for (const [key, av] of a) {
    const bv = b.get(key) ?? 0;
    const diff = av - bv;
    sum += diff * diff;
  }

  // Walk keys from `b` for any keys not already seen in `a` (b-only keys).
  for (const [key, bv] of b) {
    if (!a.has(key)) {
      // a-side missing → diff = 0 - bv = -bv → squared = bv²
      sum += bv * bv;
    }
  }

  return sum;
}

// ─── topKTokenVector ──────────────────────────────────────────────────────────

/**
 * Build a `TokenVector` from an agent's full `Inventory` by:
 *   1. Flattening the nested `Language → Referent → TokenLexeme → Weight` map
 *      into `"${language}:${lexeme}"` → weight pairs.
 *   2. Summing weights across referents when the same `(language, lexeme)`
 *      appears under multiple referents. (The surface lexeme is what a partner
 *      overhears; the referent is internal semantics.)
 *   3. Filtering out zero-weight entries (agents with weight 0 on a token have
 *      effectively unlearned it).
 *   4. Sorting descending by weight; ties broken lexicographically by key so
 *      the result is bit-identical on every run and every machine.
 *   5. Taking the top `k` entries (or all if fewer than `k` non-zero weights).
 *
 * Returns an empty Map when the inventory is empty or has only zero weights.
 * An empty TokenVector fed into `cosineSimilarity` returns 0, which the
 * softmax downstream treats as "no preference" → uniform selection.
 */
export function topKTokenVector(inventory: Inventory, k: number): TokenVector {
  // Phase 1: accumulate weights across referents.
  const accumulated = new Map<string, number>();
  for (const [language, refMap] of inventory) {
    for (const [, lexMap] of refMap) {
      for (const [lexeme, weight] of lexMap) {
        if (weight <= 0) continue;
        const key = `${language}:${lexeme}`;
        accumulated.set(key, (accumulated.get(key) ?? 0) + weight);
      }
    }
  }

  if (accumulated.size === 0) return new Map();

  // Phase 2: sort descending by weight; lexicographic tiebreaker for determinism.
  const sorted = Array.from(accumulated.entries()).sort(([keyA, wA], [keyB, wB]) => {
    if (wB !== wA) return wB - wA;
    return keyA < keyB ? -1 : keyA > keyB ? 1 : 0;
  });

  // Phase 3: take top k.
  const result = new Map<string, number>();
  const limit = Math.min(k, sorted.length);
  for (let i = 0; i < limit; i++) {
    result.set(sorted[i][0], sorted[i][1]);
  }
  return result;
}

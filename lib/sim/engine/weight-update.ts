// Pure weight-update helper for the Naming Game tick loop.
// Per docs/spec.md §3.3 step 6 and §11 Open Question 5.
//
// This module is client-safe, server-safe, and worker-safe — no `import 'server-only'`.
// It is imported by both lib/sim/engine.ts and the step-20 Web Worker via Comlink.

import type { Language, Referent, TokenLexeme, Weight } from '@/lib/schema/primitives';
import type { Inventory } from '../types';
import { inventoryIncrement, inventorySet } from '../types';

/**
 * Return a new Inventory with the specified token weight updated by `delta`.
 *
 * In `'additive'` mode (spec §11 OQ5 default):
 *   - Increments the weight by `delta`, floored at 0.
 *   - A negative `delta` (Δ⁻ penalty) is permitted; the floor prevents weights
 *     going below zero (spec §3.3 "floored at 0").
 *   - If the `(language, referent, lexeme)` cell is absent, it is treated as
 *     weight 0 before the increment (inventoryIncrement's contract).
 *
 * In `'l1-normalized'` mode (spec §11 OQ5 configurable alternative):
 *   - First applies the additive increment (with floor at 0).
 *   - Then renormalizes the `(language, referent)` sub-map so Σ weights = 1.0.
 *   - Edge case: if the sub-map is missing after the increment, returns the
 *     intermediate result unchanged.
 *   - Edge case: if the post-increment total is 0 (degenerate — all weights
 *     were zero and delta ≤ 0), normalization is undefined; returns intermediate
 *     unchanged to avoid a divide-by-zero. Callers should ensure this cannot
 *     happen in production configs (deltaPositive > 0, initial weights > 0).
 *   - Cross-cell isolation: only the `(language, referent)` sub-map that
 *     contains the updated lexeme is renormalized; other sub-maps are untouched.
 *
 * Never mutates the input inventory. Returns a new Inventory on every call via
 * inventorySet / inventoryIncrement's structural-sharing path.
 */
export function updateWeight(
  inventory: Inventory,
  language: Language,
  referent: Referent,
  lexeme: TokenLexeme,
  delta: number,
  mode: 'additive' | 'l1-normalized',
): Inventory {
  switch (mode) {
    case 'additive':
      return inventoryIncrement(inventory, language, referent, lexeme, delta, 0);

    case 'l1-normalized': {
      // Step 1: apply additive increment (floor at 0).
      const intermediate = inventoryIncrement(inventory, language, referent, lexeme, delta, 0);

      // Step 2: extract the (language, referent) sub-map from the intermediate.
      const refMap = intermediate.get(language)?.get(referent);
      if (!refMap) {
        // Sub-map absent — shouldn't happen after an increment, but guard anyway.
        return intermediate;
      }

      // Step 3: compute total weight for this (language, referent) cell.
      let total = 0;
      for (const w of refMap.values()) {
        total += w;
      }

      // Step 4: if total is zero (degenerate), leave entries at zero.
      if (total <= 0) {
        return intermediate;
      }

      // Step 5: renormalize by walking each (lex, weight) pair and rebuilding.
      // Thread returned inventories through the loop (immutable-write discipline).
      let current: Inventory = intermediate;
      for (const [lex, weight] of refMap) {
        current = inventorySet(current, language, referent, lex, (weight / total) as Weight);
      }
      return current;
    }
  }
}

import { describe, it, expect } from 'vitest';
import { updateWeight } from './weight-update';
import { emptyInventory, inventorySet, inventoryGet } from '../types';
import type { Language, Referent, TokenLexeme, Weight } from '@/lib/schema/primitives';

// Branded helpers for test fixtures
const L1 = 'L1' as Language;
const yellowRef = 'yellow-like' as Referent;
const redRef = 'red-like' as Referent;
const yellowTok = 'yellow' as TokenLexeme;
const gulTok = 'gul' as TokenLexeme;
const redTok = 'red' as TokenLexeme;

// Serialize inventory to a comparable string (Maps don't JSON.stringify usefully)
function serializeInventory(inv: ReturnType<typeof emptyInventory>): string {
  const entries: [string, [string, [string, number][]][]][] = [];
  for (const [lang, refMap] of inv) {
    const refs: [string, [string, number][]][] = [];
    for (const [ref, lexMap] of refMap) {
      refs.push([ref, Array.from(lexMap.entries()).sort()]);
    }
    entries.push([lang, refs.sort((a, b) => a[0].localeCompare(b[0]))]);
  }
  return JSON.stringify(entries.sort((a, b) => a[0].localeCompare(b[0])));
}

describe('updateWeight', () => {
  // ── Test 1: Additive mode adds delta on existing weights ────────────────────
  it('additive mode adds delta to an existing weight', () => {
    const inv = inventorySet(emptyInventory(), L1, yellowRef, yellowTok, 1.0 as Weight);
    const before = serializeInventory(inv);

    const result = updateWeight(inv, L1, yellowRef, yellowTok, 2.0, 'additive');

    // Weight should be 1.0 + 2.0 = 3.0
    expect(inventoryGet(result, L1, yellowRef, yellowTok)).toBe(3.0);
    // Input must be unchanged (immutable-return assertion)
    expect(serializeInventory(inv)).toBe(before);
    expect(inv).not.toBe(result);
  });

  // ── Test 2: Additive mode floors at zero ────────────────────────────────────
  it('additive mode floors at zero (delta exceeds current weight)', () => {
    const inv = inventorySet(emptyInventory(), L1, yellowRef, yellowTok, 1.0 as Weight);

    const result = updateWeight(inv, L1, yellowRef, yellowTok, -5.0, 'additive');

    // 1.0 + (-5.0) = -4.0, but floored at 0
    expect(inventoryGet(result, L1, yellowRef, yellowTok)).toBe(0);
  });

  // ── Test 3: Additive mode creates missing entries ───────────────────────────
  it('additive mode creates a missing entry from weight 0', () => {
    const inv = emptyInventory();

    const result = updateWeight(inv, L1, yellowRef, yellowTok, 1.0, 'additive');

    expect(inventoryGet(result, L1, yellowRef, yellowTok)).toBe(1.0);
  });

  // ── Test 4: L1-normalized mode renormalizes after increment ─────────────────
  it('l1-normalized mode renormalizes the (language, referent) sub-map', () => {
    // Start: {yellow: 1.0, gul: 1.0}
    let inv = inventorySet(emptyInventory(), L1, yellowRef, yellowTok, 1.0 as Weight);
    inv = inventorySet(inv, L1, yellowRef, gulTok, 1.0 as Weight);

    // Increment yellow by 2.0 → raw: {yellow: 3.0, gul: 1.0}, total = 4.0
    // Normalized: {yellow: 0.75, gul: 0.25}
    const result = updateWeight(inv, L1, yellowRef, yellowTok, 2.0, 'l1-normalized');

    expect(inventoryGet(result, L1, yellowRef, yellowTok)).toBeCloseTo(0.75, 9);
    expect(inventoryGet(result, L1, yellowRef, gulTok)).toBeCloseTo(0.25, 9);

    // Sum must be ~1.0
    const w1 = inventoryGet(result, L1, yellowRef, yellowTok)!;
    const w2 = inventoryGet(result, L1, yellowRef, gulTok)!;
    expect(Math.abs(w1 + w2 - 1.0)).toBeLessThan(1e-9);
  });

  // ── Test 5: L1-normalized, single-entry sub-map normalizes to 1.0 ───────────
  it('l1-normalized mode with a single-entry sub-map normalizes to 1.0', () => {
    const inv = inventorySet(emptyInventory(), L1, yellowRef, yellowTok, 0.5 as Weight);

    // 0.5 + 1.0 = 1.5, total = 1.5, normalized = 1.0
    const result = updateWeight(inv, L1, yellowRef, yellowTok, 1.0, 'l1-normalized');

    expect(inventoryGet(result, L1, yellowRef, yellowTok)).toBeCloseTo(1.0, 9);
  });

  // ── Test 6: L1-normalized preserves other (language, referent) sub-maps ─────
  it('l1-normalized mode does not touch other referent sub-maps', () => {
    // Build: {yellow-like: {yellow: 1.0}, red-like: {red: 1.0}}
    let inv = inventorySet(emptyInventory(), L1, yellowRef, yellowTok, 1.0 as Weight);
    inv = inventorySet(inv, L1, redRef, redTok, 1.0 as Weight);

    const result = updateWeight(inv, L1, yellowRef, yellowTok, 1.0, 'l1-normalized');

    // yellow-like: single entry → normalized to 1.0
    expect(inventoryGet(result, L1, yellowRef, yellowTok)).toBeCloseTo(1.0, 9);
    // red-like: completely untouched
    expect(inventoryGet(result, L1, redRef, redTok)).toBe(1.0);
  });

  // ── Test 7: L1-normalized handles zero-total edge case ──────────────────────
  it('l1-normalized handles zero-total edge case without dividing by zero', () => {
    // Degenerate: {yellow: 0.0}
    const inv = inventorySet(emptyInventory(), L1, yellowRef, yellowTok, 0.0 as Weight);

    // Increment by 0.0 → total stays 0 → must not throw, weight stays 0
    expect(() => updateWeight(inv, L1, yellowRef, yellowTok, 0.0, 'l1-normalized')).not.toThrow();

    const result = updateWeight(inv, L1, yellowRef, yellowTok, 0.0, 'l1-normalized');
    expect(inventoryGet(result, L1, yellowRef, yellowTok)).toBe(0.0);
  });

  // ── Test 8: updateWeight is immutable for both modes ────────────────────────
  it('updateWeight never mutates the input inventory (both modes)', () => {
    let inv = inventorySet(emptyInventory(), L1, yellowRef, yellowTok, 1.0 as Weight);
    inv = inventorySet(inv, L1, yellowRef, gulTok, 1.0 as Weight);

    const beforeAdditive = serializeInventory(inv);
    updateWeight(inv, L1, yellowRef, yellowTok, 0.5, 'additive');
    expect(serializeInventory(inv)).toBe(beforeAdditive);

    const beforeNormalized = serializeInventory(inv);
    updateWeight(inv, L1, yellowRef, yellowTok, 0.5, 'l1-normalized');
    expect(serializeInventory(inv)).toBe(beforeNormalized);
  });
});

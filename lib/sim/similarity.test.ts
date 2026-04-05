import { describe, it, expect } from 'vitest';
import { cosineSimilarity, topKTokenVector, type TokenVector } from './similarity';
import { emptyInventory, inventorySet } from './types';
import type { Inventory } from './types';

// Helper: build a TokenVector directly from a plain object.
function tv(entries: Record<string, number>): TokenVector {
  return new Map(Object.entries(entries));
}

// Helper: build a single-language inventory with one referent.
// lang/ref/lex are plain strings cast to the branded types at runtime.
function inv1(language: string, referent: string, tokens: Record<string, number>): Inventory {
  let inventory = emptyInventory();
  for (const [lex, weight] of Object.entries(tokens)) {
    inventory = inventorySet(
      inventory,
      language as Parameters<typeof inventorySet>[1],
      referent as Parameters<typeof inventorySet>[2],
      lex as Parameters<typeof inventorySet>[3],
      weight as Parameters<typeof inventorySet>[4],
    );
  }
  return inventory;
}

// Helper: build an inventory with two referents for the same language.
function inv2ref(
  language: string,
  ref1: string,
  tokens1: Record<string, number>,
  ref2: string,
  tokens2: Record<string, number>,
): Inventory {
  let inventory = emptyInventory();
  for (const [lex, weight] of Object.entries(tokens1)) {
    inventory = inventorySet(
      inventory,
      language as Parameters<typeof inventorySet>[1],
      ref1 as Parameters<typeof inventorySet>[2],
      lex as Parameters<typeof inventorySet>[3],
      weight as Parameters<typeof inventorySet>[4],
    );
  }
  for (const [lex, weight] of Object.entries(tokens2)) {
    inventory = inventorySet(
      inventory,
      language as Parameters<typeof inventorySet>[1],
      ref2 as Parameters<typeof inventorySet>[2],
      lex as Parameters<typeof inventorySet>[3],
      weight as Parameters<typeof inventorySet>[4],
    );
  }
  return inventory;
}

// ─── cosineSimilarity tests ───────────────────────────────────────────────────

describe('cosineSimilarity', () => {
  // Test 1
  it('identical vectors → 1.0', () => {
    const a = tv({ 'L1:yellow': 1.0, 'L1:red': 0.5 });
    const result = cosineSimilarity(a, a);
    expect(result).toBeCloseTo(1.0, 10);
  });

  // Test 2
  it('orthogonal vectors (disjoint keys) → 0', () => {
    const a = tv({ 'L1:yellow': 1.0 });
    const b = tv({ 'L1:red': 1.0 });
    expect(cosineSimilarity(a, b)).toBe(0);
  });

  // Test 3
  it('one zero vector (empty map) → 0, not NaN', () => {
    const a = tv({ 'L1:yellow': 1.0 });
    const b: TokenVector = new Map();
    const result = cosineSimilarity(a, b);
    expect(result).toBe(0);
    expect(Number.isNaN(result)).toBe(false);
  });

  // Test 4
  it('both zero vectors → 0, not NaN, not Infinity', () => {
    const a: TokenVector = new Map();
    const b: TokenVector = new Map();
    const result = cosineSimilarity(a, b);
    expect(result).toBe(0);
    expect(Number.isNaN(result)).toBe(false);
    expect(Number.isFinite(result) || result === 0).toBe(true);
  });

  // Test 5
  it('scale-invariant: scaled vector gives same result as unscaled', () => {
    const a = tv({ 'L1:yellow': 1.0, 'L1:red': 1.0 });
    const b = tv({ 'L1:yellow': 10.0, 'L1:red': 10.0 });
    expect(cosineSimilarity(a, b)).toBeCloseTo(1.0, 10);
  });

  // Test 6
  it('symmetric: cosineSimilarity(a, b) === cosineSimilarity(b, a)', () => {
    const pairs: Array<[TokenVector, TokenVector]> = [
      [tv({ 'L1:yellow': 3.0, 'L1:red': 1.0 }), tv({ 'L1:yellow': 1.0, 'L2:jaune': 2.0 })],
      [tv({ 'L1:yellow': 1.0 }), tv({ 'L1:yellow': 0.5, 'L1:red': 0.5 })],
      [tv({ 'L1:yellow': 2.0, 'L2:jaune': 3.0 }), tv({ 'L1:yellow': 3.0, 'L2:jaune': 2.0 })],
    ];
    for (const [a, b] of pairs) {
      expect(cosineSimilarity(a, b)).toBeCloseTo(cosineSimilarity(b, a), 12);
    }
  });

  // Partial-overlap case: ensures both a-only keys and b-only keys are handled
  it('partial overlap: keys in b not in a do not contribute to dot product', () => {
    const a = tv({ 'L1:yellow': 1.0 });
    const b = tv({ 'L1:yellow': 1.0, 'L1:red': 1.0 });
    // dot = 1*1 = 1, |a| = 1, |b| = sqrt(2)
    const expected = 1 / Math.sqrt(2);
    expect(cosineSimilarity(a, b)).toBeCloseTo(expected, 10);
  });
});

// ─── topKTokenVector tests ────────────────────────────────────────────────────

describe('topKTokenVector', () => {
  // Test 7
  it('returns top-K entries by weight', () => {
    const inventory = inv1('L1', 'yellow-like', { yellow: 10, red: 5, green: 1 });
    const result = topKTokenVector(inventory, 2);
    expect(result.size).toBe(2);
    expect(result.get('L1:yellow')).toBe(10);
    expect(result.get('L1:red')).toBe(5);
    expect(result.has('L1:green')).toBe(false);
  });

  // Test 8
  it('returns all entries when K exceeds inventory size', () => {
    const inventory = inv1('L1', 'yellow-like', { yellow: 10, red: 5, green: 1 });
    const result = topKTokenVector(inventory, 10);
    expect(result.size).toBe(3);
  });

  // Test 9
  it('filters out zero-weight entries', () => {
    const inventory = inv1('L1', 'yellow-like', { yellow: 10, red: 0, green: 1 });
    const result = topKTokenVector(inventory, 10);
    expect(result.size).toBe(2);
    expect(result.has('L1:red')).toBe(false);
    expect(result.get('L1:yellow')).toBe(10);
    expect(result.get('L1:green')).toBe(1);
  });

  // Test 10
  it('empty inventory returns empty map', () => {
    const result = topKTokenVector(emptyInventory(), 5);
    expect(result.size).toBe(0);
  });

  // Test 11
  it('sums weights across referents for the same (language, lexeme)', () => {
    // L1:"yellow" under two different referents — same surface lexeme
    const inventory = inv2ref('L1', 'yellow-ref', { yellow: 2 }, 'red-ref', { yellow: 3 });
    const result = topKTokenVector(inventory, 10);
    // Both are under "L1:yellow" but with different referents → sum to 5
    expect(result.get('L1:yellow')).toBe(5);
  });

  // Test 12
  it('lexicographic tiebreaker is deterministic', () => {
    // Two tokens with equal weight; lexicographic order should pick "L1:apple"
    const inventory = inv2ref('L1', 'ref', { apple: 1.0 }, 'ref2', { banana: 1.0 });
    // Note: two different referents, so these won't be summed — they're separate lexemes.
    const result1 = topKTokenVector(inventory, 1);
    const result2 = topKTokenVector(inventory, 1);

    // Both runs must agree
    expect([...result1.entries()]).toEqual([...result2.entries()]);

    // With k=1 and tied weights, lexicographic tiebreaker picks "L1:apple" over "L1:banana"
    expect(result1.has('L1:apple')).toBe(true);
    expect(result1.has('L1:banana')).toBe(false);
  });

  it('inventory with all zero weights returns empty map', () => {
    // inventorySet allows weight 0
    let inventory = emptyInventory();
    inventory = inventorySet(
      inventory,
      'L1' as Parameters<typeof inventorySet>[1],
      'ref' as Parameters<typeof inventorySet>[2],
      'yellow' as Parameters<typeof inventorySet>[3],
      0 as Parameters<typeof inventorySet>[4],
    );
    expect(topKTokenVector(inventory, 10).size).toBe(0);
  });
});

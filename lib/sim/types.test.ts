import { describe, expect, it } from 'vitest';
import {
  type AgentId,
  type Language,
  type Referent,
  type TokenLexeme,
  emptyInventory,
  inventoryGet,
  inventoryIncrement,
  inventorySet,
  makeAgentId,
  makeToken,
  tokenKey,
} from '@/lib/sim/types';
import {
  Language as LSchema,
  Referent as RSchema,
  TokenLexeme as TLSchema,
} from '@/lib/schema/primitives';

// Helpers: cast raw strings to their branded types at the schema boundary.
const L1 = LSchema.parse('L1');
const L2 = LSchema.parse('L2');
const red = RSchema.parse('red');
const blue = RSchema.parse('blue');
const redLex = TLSchema.parse('red');
const rougeLex = TLSchema.parse('rouge');

describe('tokenKey', () => {
  // ─── Test 14 ──────────────────────────────────────────────────────────────
  it('formats as language:lexeme', () => {
    const token = makeToken(L1, redLex);
    expect(tokenKey(token)).toBe('L1:red');
  });

  it('is deterministic for the same inputs', () => {
    const a = makeToken(L1, redLex);
    const b = makeToken(L1, redLex);
    expect(tokenKey(a)).toBe(tokenKey(b));
  });
});

describe('emptyInventory', () => {
  // ─── Test 15 ──────────────────────────────────────────────────────────────
  it('returns a Map with size 0', () => {
    expect(emptyInventory().size).toBe(0);
  });
});

describe('inventorySet', () => {
  // ─── Test 16 ──────────────────────────────────────────────────────────────
  it('is pure: original inventory is unchanged after a set', () => {
    const inv0 = emptyInventory();
    const inv1 = inventorySet(inv0, L1, red, redLex, 1.0);

    expect(inv0.size).toBe(0);
    expect(inv1.size).toBe(1);
    expect(inventoryGet(inv1, L1, red, redLex)).toBe(1.0);
    expect(inventoryGet(inv0, L1, red, redLex)).toBeUndefined();
  });

  // ─── Test 17 ──────────────────────────────────────────────────────────────
  it('preserves untouched branches', () => {
    const inv0 = inventorySet(emptyInventory(), L1, red, redLex, 1.0);
    const inv1 = inventorySet(inv0, L1, red, rougeLex, 0.5);

    expect(inventoryGet(inv1, L1, red, redLex)).toBe(1.0);
    expect(inventoryGet(inv1, L1, red, rougeLex)).toBe(0.5);
    // Original unchanged
    expect(inventoryGet(inv0, L1, red, rougeLex)).toBeUndefined();
  });

  it('creates nested levels on demand', () => {
    const inv = inventorySet(emptyInventory(), L2, blue, rougeLex, 3.0);
    expect(inventoryGet(inv, L2, blue, rougeLex)).toBe(3.0);
    expect(inventoryGet(inv, L1, blue, rougeLex)).toBeUndefined();
  });
});

describe('inventoryIncrement', () => {
  // ─── Test 18 ──────────────────────────────────────────────────────────────
  it('adds delta to an existing weight', () => {
    const base = inventorySet(emptyInventory(), L1, red, redLex, 1.0);
    const result = inventoryIncrement(base, L1, red, redLex, 2.0);
    expect(inventoryGet(result, L1, red, redLex)).toBe(3.0);
  });

  // ─── Test 19 ──────────────────────────────────────────────────────────────
  it('floors the result at 0 by default', () => {
    const base = inventorySet(emptyInventory(), L1, red, redLex, 1.0);
    const result = inventoryIncrement(base, L1, red, redLex, -5);
    expect(inventoryGet(result, L1, red, redLex)).toBe(0);
  });

  it('respects a custom floor', () => {
    const base = inventorySet(emptyInventory(), L1, red, redLex, 2.0);
    const result = inventoryIncrement(base, L1, red, redLex, -10, 1.0);
    expect(inventoryGet(result, L1, red, redLex)).toBe(1.0);
  });

  // ─── Test 20 ──────────────────────────────────────────────────────────────
  it('creates the entry when the key is absent', () => {
    const result = inventoryIncrement(emptyInventory(), L1, red, redLex, 1.0);
    expect(inventoryGet(result, L1, red, redLex)).toBe(1.0);
  });
});

describe('brand type safety (compile-time)', () => {
  // ─── Test 21 ──────────────────────────────────────────────────────────────
  // These @ts-expect-error annotations are compile-time tests checked by
  // `npm run typecheck`. If a brand collapses (accepts plain strings), the
  // annotation itself becomes an error and the typecheck fails — exactly the
  // signal we want. No runtime assertions are needed here.

  it('AgentId rejects plain string assignment (compile-time)', () => {
    // @ts-expect-error: plain string is not assignable to AgentId
    const _id: AgentId = 'not-wrapped';
    void _id;
    // If we get here at runtime it's fine — the guard is in the compiler.
  });

  it('Language rejects plain string assignment (compile-time)', () => {
    // @ts-expect-error: plain string is not assignable to Language
    const _lang: Language = 'L1';
    void _lang;
  });

  it('Referent rejects plain string assignment (compile-time)', () => {
    // @ts-expect-error: plain string is not assignable to Referent
    const _ref: Referent = 'red';
    void _ref;
  });

  it('TokenLexeme rejects plain string assignment (compile-time)', () => {
    // @ts-expect-error: plain string is not assignable to TokenLexeme
    const _lex: TokenLexeme = 'rouge';
    void _lex;
  });

  it('makeAgentId produces an assignable AgentId', () => {
    const id: AgentId = makeAgentId('agent-001');
    expect(id).toBe('agent-001');
  });
});

describe('round-trip serialization', () => {
  // ─── Test 22 ──────────────────────────────────────────────────────────────
  // Demonstrates that the Inventory shape is serializable to a flat
  // quadruple array and back. This is the form step 20's worker will use
  // when posting state across the postMessage boundary.
  it('serializes and round-trips via flat quadruples', () => {
    type Quad = [string, string, string, number];

    function flatten(inv: ReturnType<typeof emptyInventory>): Quad[] {
      const out: Quad[] = [];
      for (const [lang, byRef] of inv) {
        for (const [ref, byLex] of byRef) {
          for (const [lex, weight] of byLex) {
            out.push([lang, ref, lex, weight]);
          }
        }
      }
      return out;
    }

    function rebuild(quads: Quad[]): ReturnType<typeof emptyInventory> {
      let inv = emptyInventory();
      for (const [lang, ref, lex, weight] of quads) {
        inv = inventorySet(
          inv,
          LSchema.parse(lang),
          RSchema.parse(ref),
          TLSchema.parse(lex),
          weight,
        );
      }
      return inv;
    }

    const original = inventorySet(
      inventorySet(inventorySet(emptyInventory(), L1, red, redLex, 1.0), L1, red, rougeLex, 0.5),
      L2,
      blue,
      rougeLex,
      2.0,
    );

    const quads = flatten(original);
    expect(quads).toHaveLength(3);

    const rebuilt = rebuild(quads);
    expect(inventoryGet(rebuilt, L1, red, redLex)).toBe(1.0);
    expect(inventoryGet(rebuilt, L1, red, rougeLex)).toBe(0.5);
    expect(inventoryGet(rebuilt, L2, blue, rougeLex)).toBe(2.0);
    expect(inventoryGet(rebuilt, L1, blue, redLex)).toBeUndefined();
  });
});

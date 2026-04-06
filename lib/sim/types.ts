// Core simulation types for the Naming Game.
// Per docs/spec.md §3.1, §3.2, §3.3, §3.5.
//
// This module is client-safe, server-safe, and worker-safe — it deliberately
// does NOT carry `import 'server-only'`, unlike lib/db/ and lib/auth/.
// Step 20 imports it from the Web Worker entrypoint.
//
// Language, Referent, TokenLexeme, Weight, and AgentClass are re-exported
// from lib/schema/primitives so that Zod-validated values are directly
// assignable to these types without a cast. AgentId is defined locally
// because it has no Zod schema counterpart.

export type { AgentClass, Language, Referent, TokenLexeme, Weight } from '@/lib/schema/primitives';

// ─── Branded primitives ───────────────────────────────────────────────────────

/** Utility type for nominal/opaque strings. Used for AgentId. */
type Brand<Base, Tag extends string> = Base & { readonly __brand: Tag };

/** Opaque identifier for a simulation agent (uuid v4). */
export type AgentId = Brand<string, 'AgentId'>;

// ─── Token ────────────────────────────────────────────────────────────────────

import type { Language, TokenLexeme } from '@/lib/schema/primitives';

/** A (language, lexeme) pair per docs/spec.md §3.5. */
export type Token = {
  readonly language: Language;
  readonly lexeme: TokenLexeme;
};

/**
 * A string key derived from a Token: `${language}:${lexeme}`.
 * Used to index Maps and cross postMessage boundaries.
 */
export type TokenKey = string;

// ─── Inventory ────────────────────────────────────────────────────────────────

import type { Referent, Weight } from '@/lib/schema/primitives';

/**
 * Nested weight map per docs/spec.md §3.2.
 * Shape: Language → Referent → TokenLexeme → Weight.
 * ReadonlyMap enforces that callers must use inventorySet / inventoryIncrement
 * rather than mutating the map directly.
 */
export type Inventory = ReadonlyMap<
  Language,
  ReadonlyMap<Referent, ReadonlyMap<TokenLexeme, Weight>>
>;

// ─── Interaction record ───────────────────────────────────────────────────────

/** One completed interaction stored in an agent's interactionMemory. */
export type InteractionRecord = {
  readonly tick: number;
  readonly partnerId: AgentId;
  readonly language: Language;
  readonly referent: Referent;
  readonly token: TokenLexeme;
  readonly success: boolean;
};

// ─── Agent state ──────────────────────────────────────────────────────────────

import type { AgentClass } from '@/lib/schema/primitives';

/**
 * Full agent state snapshot per docs/spec.md §3.2.
 * Note: `speakerLanguagePolicy` is a behavioral concern added in step 12;
 * this type covers data fields only.
 */
export type AgentState = {
  readonly id: AgentId;
  readonly class: AgentClass;
  /** Linearised position index on the topology graph. */
  readonly position: number;
  readonly inventory: Inventory;
  readonly interactionMemory: readonly InteractionRecord[];
};

// ─── Factory helpers ──────────────────────────────────────────────────────────

/** Thin type-asserting wrappers. Runtime no-ops; validation happens at the Zod boundary. */
export function makeAgentId(raw: string): AgentId {
  return raw as AgentId;
}

export function makeToken(lang: Language, lex: TokenLexeme): Token {
  return { language: lang, lexeme: lex };
}

/** Composite string key for a token: `"${language}:${lexeme}"`. */
export function tokenKey(token: Token): TokenKey {
  return `${token.language}:${token.lexeme}`;
}

// ─── Inventory helpers ────────────────────────────────────────────────────────

/** Returns an empty inventory. */
export function emptyInventory(): Inventory {
  return new Map<Language, ReadonlyMap<Referent, ReadonlyMap<TokenLexeme, Weight>>>();
}

/** Look up a weight; returns undefined if any level is absent. */
export function inventoryGet(
  inv: Inventory,
  lang: Language,
  ref: Referent,
  lex: TokenLexeme,
): Weight | undefined {
  return inv.get(lang)?.get(ref)?.get(lex);
}

/**
 * Return a new Inventory with the given weight set.
 * Does NOT mutate the input. Clones each Map level along the write path;
 * untouched branches are shared structurally.
 */
export function inventorySet(
  inv: Inventory,
  lang: Language,
  ref: Referent,
  lex: TokenLexeme,
  weight: Weight,
): Inventory {
  // Work with fully mutable Maps internally, then return as Inventory.
  type L3 = Map<TokenLexeme, Weight>;
  type L2 = Map<Referent, L3>;
  type L1 = Map<Language, L2>;

  const src = inv as unknown as L1;
  const l1: L1 = new Map(src);
  const l2: L2 = new Map(l1.get(lang) ?? new Map<Referent, L3>());
  const l3: L3 = new Map(l2.get(ref) ?? new Map<TokenLexeme, Weight>());
  l3.set(lex, weight);
  l2.set(ref, l3);
  l1.set(lang, l2);
  return l1 as unknown as Inventory;
}

/**
 * Return a new Inventory with the given weight incremented by delta.
 * Applies a floor (default 0) so weights never go below it.
 * If the entry is absent, it is treated as 0 before the increment.
 */
export function inventoryIncrement(
  inv: Inventory,
  lang: Language,
  ref: Referent,
  lex: TokenLexeme,
  delta: number,
  floor = 0,
): Inventory {
  const current = inventoryGet(inv, lang, ref, lex) ?? 0;
  const next = Math.max(floor, current + delta);
  return inventorySet(inv, lang, ref, lex, next as Weight);
}

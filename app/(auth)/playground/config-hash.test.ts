// app/(auth)/playground/config-hash.test.ts — unit tests for canonicalStringify and hash helpers.
//
// Runs under the default Vitest `node` environment.
// Node ≥ 20.9 exposes globalThis.crypto.subtle natively — no browser harness needed.

import { describe, it, expect } from 'vitest';
import type { ExperimentConfig } from '@/lib/schema/experiment';
import { canonicalStringify, computeConfigHash, computeConfigHashShort } from './config-hash';

// ─── Canonical fixture ────────────────────────────────────────────────────────
//
// Minimal valid ExperimentConfig-shaped object with known field values.
// Uses seed=42 and empty vocabularySeed objects so the fixture is stable across
// any future defaultVocabularySeed changes. The fixture is cast to ExperimentConfig
// because the test does not exercise Zod parsing (only the hash helper's pure logic).

const FIXTURE_CONFIG: ExperimentConfig = {
  seed: 42,
  tickCount: 5000,
  deltaPositive: 0.1,
  deltaNegative: 0,
  retryLimit: 3,
  interactionProbability: 1,
  weightUpdateRule: 'additive',
  schedulerMode: 'random',
  interactionMemorySize: 50,
  sampleInterval: 10,
  languagePolicies: [],
  preferentialAttachment: {
    enabled: true,
    warmUpTicks: 100,
    temperature: 1,
    similarityMetric: 'cosine',
    topK: 10,
  },
  classificationThresholds: {
    assimilationHigh: 0.7,
    segregationLow: 0.3,
    assimilationLow: 0.3,
    segregationHigh: 0.7,
  },
  convergence: { consensusWindowTicks: 100 },
  world1: {
    agentCount: 50,
    monolingualBilingualRatio: 1.5,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    topology: { type: 'lattice', width: 20, height: 20, neighborhood: 'moore' } as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    referents: ['yellow-like', 'red-like'] as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vocabularySeed: {} as any,
  },
  world2: {
    agentCount: 50,
    monolingualBilingualRatio: 1.5,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    topology: { type: 'lattice', width: 20, height: 20, neighborhood: 'moore' } as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    referents: ['yellow-like', 'red-like'] as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vocabularySeed: {} as any,
  },
};

// Pre-computed SHA-256 of canonicalStringify(FIXTURE_CONFIG).
// Computed once via `node /tmp/claude/compute-hash.mjs` and committed here as a regression guard.
// If this test fails after a change to canonicalStringify or TextEncoder handling, that change
// broke the determinism invariant for config hashing.
const FIXTURE_HASH = '8f916704d270a368a3075c2bc2efb8a22b153eca4e11e9f67d5d178b40f780d3';

// ─── Test suites ─────────────────────────────────────────────────────────────

describe('canonicalStringify', () => {
  it('produces identical strings for objects with different key orderings', () => {
    const a = { a: 1, b: 2 };
    const b = { b: 2, a: 1 };
    expect(canonicalStringify(a)).toBe(canonicalStringify(b));
  });

  it('sorts nested object keys at every level', () => {
    const nested = { z: { y: 1, x: 2 }, a: { d: 3, c: 4 } };
    const result = canonicalStringify(nested);
    // Outer keys: a, z (sorted). Inner keys: c/d and x/y (sorted).
    expect(result).toBe('{"a":{"c":4,"d":3},"z":{"x":2,"y":1}}');
  });

  it('preserves array element order (arrays are ordered data)', () => {
    const arr = [3, 1, 2];
    expect(canonicalStringify(arr)).toBe('[3,1,2]');
  });

  it('throws on NaN', () => {
    expect(() => canonicalStringify(NaN)).toThrow(/non-finite/);
  });

  it('throws on Infinity', () => {
    expect(() => canonicalStringify(Infinity)).toThrow(/non-finite/);
  });
});

describe('computeConfigHash — known-answer test', () => {
  it('produces the pre-computed SHA-256 hex for the canonical fixture', async () => {
    const hash = await computeConfigHash(FIXTURE_CONFIG);
    expect(hash).toBe(FIXTURE_HASH);
  });
});

describe('computeConfigHash — canonicalization invariance', () => {
  it('returns the same hash regardless of top-level key order', async () => {
    // Construct the same fixture with keys in reverse order.
    const reordered: ExperimentConfig = {
      world2: FIXTURE_CONFIG.world2,
      world1: FIXTURE_CONFIG.world1,
      seed: FIXTURE_CONFIG.seed,
      convergence: FIXTURE_CONFIG.convergence,
      classificationThresholds: FIXTURE_CONFIG.classificationThresholds,
      preferentialAttachment: FIXTURE_CONFIG.preferentialAttachment,
      languagePolicies: FIXTURE_CONFIG.languagePolicies,
      sampleInterval: FIXTURE_CONFIG.sampleInterval,
      interactionMemorySize: FIXTURE_CONFIG.interactionMemorySize,
      schedulerMode: FIXTURE_CONFIG.schedulerMode,
      weightUpdateRule: FIXTURE_CONFIG.weightUpdateRule,
      interactionProbability: FIXTURE_CONFIG.interactionProbability,
      retryLimit: FIXTURE_CONFIG.retryLimit,
      deltaNegative: FIXTURE_CONFIG.deltaNegative,
      deltaPositive: FIXTURE_CONFIG.deltaPositive,
      tickCount: FIXTURE_CONFIG.tickCount,
    };
    const hash = await computeConfigHash(reordered);
    expect(hash).toBe(FIXTURE_HASH);
  });
});

describe('computeConfigHashShort', () => {
  it('returns exactly 8 characters', async () => {
    const short = await computeConfigHashShort(FIXTURE_CONFIG);
    expect(short).toHaveLength(8);
  });

  it('is a prefix of the full hash', async () => {
    const [full, short] = await Promise.all([
      computeConfigHash(FIXTURE_CONFIG),
      computeConfigHashShort(FIXTURE_CONFIG),
    ]);
    expect(full.startsWith(short)).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';
import { createRNG } from '@/lib/sim/rng';
import { makeAgentId, emptyInventory, inventorySet } from '@/lib/sim/types';
import type { AgentState } from '@/lib/sim/types';
import type { AgentClass, Language } from '@/lib/schema/primitives';
import type { LanguagePolicyEntry } from '@/lib/schema/policy';
import type { PolicyConfig } from '@/lib/sim/policy';
import { defaultLanguagePolicies } from '@/lib/schema/defaults';
import { createDefaultPolicy } from './default';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const L1 = 'L1' as Language;
const L2 = 'L2' as Language;

function makeAgent(agentClass: AgentClass): AgentState {
  return {
    id: makeAgentId(`test-${agentClass}`),
    class: agentClass,
    position: 0,
    inventory: emptyInventory(),
    interactionMemory: [],
  };
}

/** Build a minimal PolicyConfig with just the entries needed for the test. */
function makePolicyConfig(
  entries: LanguagePolicyEntry[],
  overrides?: Partial<{ l1Label: Language; l2Label: Language }>,
): PolicyConfig {
  return {
    policyName: 'default',
    entries,
    l1Label: overrides?.l1Label ?? L1,
    l2Label: overrides?.l2Label ?? L2,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('createDefaultPolicy', () => {
  // ─── Test 1: W1-Bi → W1-Mono always L1 ────────────────────────────────────
  it('W1-Bi → W1-Mono yields L1 in 100% of trials regardless of RNG state', () => {
    const entry: LanguagePolicyEntry = {
      speakerClass: 'W1-Bi',
      hearerClass: 'W1-Mono',
      ruleId: 'w1bi-to-w1mono-always-l1',
    };
    const speaker = makeAgent('W1-Bi');
    const hearer = makeAgent('W1-Mono');

    for (const seed of [0, 1, 42]) {
      const rng = createRNG(seed);
      const policy = createDefaultPolicy(makePolicyConfig([entry]));
      const results = Array.from({ length: 1000 }, () => policy({ speaker, hearer, rng }));
      expect(results.every((r) => r === L1)).toBe(true);
    }
  });

  // ─── Test 2: W1-Mono → W1-Mono always L1 ──────────────────────────────────
  it('W1-Mono → W1-Mono yields L1 in 100% of trials', () => {
    const entry: LanguagePolicyEntry = {
      speakerClass: 'W1-Mono',
      hearerClass: 'W1-Mono',
      ruleId: 'always-l1',
    };
    const speaker = makeAgent('W1-Mono');
    const hearer = makeAgent('W1-Mono');

    for (const seed of [0, 1, 42]) {
      const rng = createRNG(seed);
      const policy = createDefaultPolicy(makePolicyConfig([entry]));
      const results = Array.from({ length: 1000 }, () => policy({ speaker, hearer, rng }));
      expect(results.every((r) => r === L1)).toBe(true);
    }
  });

  // ─── Test 3: W2-Native → W2-Native always L2 ───────────────────────────────
  it('W2-Native → W2-Native yields L2 in 100% of trials', () => {
    const entry: LanguagePolicyEntry = {
      speakerClass: 'W2-Native',
      hearerClass: 'W2-Native',
      ruleId: 'always-l2',
    };
    const speaker = makeAgent('W2-Native');
    const hearer = makeAgent('W2-Native');

    for (const seed of [0, 1, 42]) {
      const rng = createRNG(seed);
      const policy = createDefaultPolicy(makePolicyConfig([entry]));
      const results = Array.from({ length: 1000 }, () => policy({ speaker, hearer, rng }));
      expect(results.every((r) => r === L2)).toBe(true);
    }
  });

  // ─── Test 4: W1-Bi → W1-Bi with 0.5 bias → ~50% L1 ───────────────────────
  it('W1-Bi → W1-Bi with L1 bias 0.5 yields L1 in ~50% of 10,000 trials', () => {
    const entry: LanguagePolicyEntry = {
      speakerClass: 'W1-Bi',
      hearerClass: 'W1-Bi',
      ruleId: 'w1bi-to-w1bi-configurable',
      languageBias: { L1: 0.5, L2: 0.5 },
    };
    const speaker = makeAgent('W1-Bi');
    const hearer = makeAgent('W1-Bi');
    const rng = createRNG(99);
    const policy = createDefaultPolicy(makePolicyConfig([entry]));

    let l1Count = 0;
    const N = 10_000;
    for (let i = 0; i < N; i++) {
      if (policy({ speaker, hearer, rng }) === L1) l1Count++;
    }

    // 3σ binomial interval: p=0.5, n=10000 → σ≈50, 3σ=150
    expect(l1Count).toBeGreaterThanOrEqual(5000 - 150);
    expect(l1Count).toBeLessThanOrEqual(5000 + 150);
    // Soft check: the coin is actually flipping, not stuck on one value.
    expect(l1Count).toBeGreaterThan(0);
    expect(l1Count).toBeLessThan(N);
  });

  // ─── Test 5: W2-Immigrant → W2-Native with 0.2 L1 bias → ~80% L2 ─────────
  it('W2-Immigrant → W2-Native with L1 bias 0.2 yields L2 ~80% of the time', () => {
    const entry: LanguagePolicyEntry = {
      speakerClass: 'W2-Immigrant',
      hearerClass: 'W2-Native',
      ruleId: 'w2imm-to-w2native-both',
      languageBias: { L1: 0.2, L2: 0.8 },
    };
    const speaker = makeAgent('W2-Immigrant');
    const hearer = makeAgent('W2-Native');
    const rng = createRNG(77);
    const policy = createDefaultPolicy(makePolicyConfig([entry]));

    let l2Count = 0;
    const N = 10_000;
    for (let i = 0; i < N; i++) {
      if (policy({ speaker, hearer, rng }) === L2) l2Count++;
    }

    // 3σ binomial interval: p=0.8, n=10000 → σ≈40, 3σ=120
    expect(l2Count).toBeGreaterThanOrEqual(8000 - 120);
    expect(l2Count).toBeLessThanOrEqual(8000 + 120);
  });

  // ─── Test 6: W2-Immigrant → W2-Immigrant with 0.5 bias → ~50% L1 ──────────
  it('W2-Immigrant → W2-Immigrant with L1 bias 0.5 yields L1 in ~50% of 10,000 trials', () => {
    const entry: LanguagePolicyEntry = {
      speakerClass: 'W2-Immigrant',
      hearerClass: 'W2-Immigrant',
      ruleId: 'w2imm-to-w2imm-both',
      languageBias: { L1: 0.5, L2: 0.5 },
    };
    const speaker = makeAgent('W2-Immigrant');
    const hearer = makeAgent('W2-Immigrant');
    const rng = createRNG(55);
    const policy = createDefaultPolicy(makePolicyConfig([entry]));

    let l1Count = 0;
    const N = 10_000;
    for (let i = 0; i < N; i++) {
      if (policy({ speaker, hearer, rng }) === L1) l1Count++;
    }

    // 3σ binomial interval: p=0.5, n=10000 → σ≈50, 3σ=150
    expect(l1Count).toBeGreaterThanOrEqual(5000 - 150);
    expect(l1Count).toBeLessThanOrEqual(5000 + 150);
    expect(l1Count).toBeGreaterThan(0);
    expect(l1Count).toBeLessThan(N);
  });

  // ─── Test 7: Determinism — same seed, same inputs, same output sequence ────
  it('produces bit-identical output sequences from two RNGs with the same seed', () => {
    const entry: LanguagePolicyEntry = {
      speakerClass: 'W1-Bi',
      hearerClass: 'W1-Bi',
      ruleId: 'w1bi-to-w1bi-configurable',
      languageBias: { L1: 0.7, L2: 0.3 },
    };
    const speaker = makeAgent('W1-Bi');
    const hearer = makeAgent('W1-Bi');
    const policy = createDefaultPolicy(makePolicyConfig([entry]));

    const rngA = createRNG(42);
    const rngB = createRNG(42);
    const seqA = Array.from({ length: 100 }, () => policy({ speaker, hearer, rng: rngA }));
    const seqB = Array.from({ length: 100 }, () => policy({ speaker, hearer, rng: rngB }));
    expect(seqA).toEqual(seqB);
  });

  // ─── Test 8: Cross-world fallthrough cells do not throw ────────────────────
  it('cross-world fallthrough cells return a language without throwing', () => {
    // Cross-world cells that are unreachable in v1 but must not undefined-crash.
    // The defaultLanguagePolicies assigns "always-l1" (W1 speakers cross-world)
    // and "always-l2" (W2 speakers cross-world) as defensive fallbacks.
    const crossWorldEntries: LanguagePolicyEntry[] = [
      { speakerClass: 'W1-Mono', hearerClass: 'W2-Native', ruleId: 'always-l1' },
      { speakerClass: 'W1-Mono', hearerClass: 'W2-Immigrant', ruleId: 'always-l1' },
      { speakerClass: 'W1-Bi', hearerClass: 'W2-Native', ruleId: 'always-l1' },
      { speakerClass: 'W1-Bi', hearerClass: 'W2-Immigrant', ruleId: 'always-l1' },
      { speakerClass: 'W2-Native', hearerClass: 'W1-Mono', ruleId: 'always-l2' },
      { speakerClass: 'W2-Native', hearerClass: 'W1-Bi', ruleId: 'always-l2' },
      { speakerClass: 'W2-Immigrant', hearerClass: 'W1-Mono', ruleId: 'always-l1' },
      { speakerClass: 'W2-Immigrant', hearerClass: 'W1-Bi', ruleId: 'always-l1' },
    ];
    const policy = createDefaultPolicy(makePolicyConfig(crossWorldEntries));
    const rng = createRNG(0);
    const validLanguages = new Set([L1, L2]);

    for (const entry of crossWorldEntries) {
      const speaker = makeAgent(entry.speakerClass);
      const hearer = makeAgent(entry.hearerClass);
      const result = policy({ speaker, hearer, rng });
      expect(validLanguages.has(result)).toBe(true);
    }
  });

  // ─── Test 9: Renamed language labels are honored ───────────────────────────
  it('honors renamed language labels and never returns the hardcoded default strings', () => {
    const firstLang = 'firstLanguage' as Language;
    const secondLang = 'secondLanguage' as Language;

    const entries: LanguagePolicyEntry[] = [
      {
        speakerClass: 'W1-Bi',
        hearerClass: 'W1-Mono',
        ruleId: 'w1bi-to-w1mono-always-l1',
      },
      {
        speakerClass: 'W2-Native',
        hearerClass: 'W2-Native',
        ruleId: 'always-l2',
      },
      {
        speakerClass: 'W1-Bi',
        hearerClass: 'W1-Bi',
        ruleId: 'w1bi-to-w1bi-configurable',
        languageBias: { L1: 1.0, L2: 0.0 }, // always L1 for determinism
      },
    ];
    const policy = createDefaultPolicy(
      makePolicyConfig(entries, { l1Label: firstLang, l2Label: secondLang }),
    );
    const rng = createRNG(0);

    // W1-Bi → W1-Mono must return firstLanguage, not "L1"
    expect(policy({ speaker: makeAgent('W1-Bi'), hearer: makeAgent('W1-Mono'), rng })).toBe(
      firstLang,
    );

    // W2-Native → W2-Native must return secondLanguage, not "L2"
    expect(
      policy({
        speaker: makeAgent('W2-Native'),
        hearer: makeAgent('W2-Native'),
        rng,
      }),
    ).toBe(secondLang);

    // W1-Bi → W1-Bi with L1 bias 1.0 must return firstLanguage, not "L1"
    expect(policy({ speaker: makeAgent('W1-Bi'), hearer: makeAgent('W1-Bi'), rng })).toBe(
      firstLang,
    );
  });

  // ─── Test: configurable entry with no bias defaults to 50/50 ──────────────
  it('configurable entry with absent languageBias defaults to ~50% L1', () => {
    const entry: LanguagePolicyEntry = {
      speakerClass: 'W1-Bi',
      hearerClass: 'W1-Bi',
      ruleId: 'w1bi-to-w1bi-configurable',
      // No languageBias — should default to 0.5
    };
    const speaker = makeAgent('W1-Bi');
    const hearer = makeAgent('W1-Bi');
    const rng = createRNG(12);
    const policy = createDefaultPolicy(makePolicyConfig([entry]));

    let l1Count = 0;
    const N = 10_000;
    for (let i = 0; i < N; i++) {
      if (policy({ speaker, hearer, rng }) === L1) l1Count++;
    }

    expect(l1Count).toBeGreaterThanOrEqual(5000 - 150);
    expect(l1Count).toBeLessThanOrEqual(5000 + 150);
  });

  // ─── Test: missing entry throws a clear error ──────────────────────────────
  it('throws a descriptive error for a class pair not present in entries', () => {
    // Only has W1-Bi→W1-Mono; calling with W2-Native→W2-Native should throw.
    const policy = createDefaultPolicy(
      makePolicyConfig([
        {
          speakerClass: 'W1-Bi',
          hearerClass: 'W1-Mono',
          ruleId: 'w1bi-to-w1mono-always-l1',
        },
      ]),
    );
    const rng = createRNG(0);
    expect(() =>
      policy({
        speaker: makeAgent('W2-Native'),
        hearer: makeAgent('W2-Native'),
        rng,
      }),
    ).toThrow('W2-Native__W2-Native');
  });

  // ─── Smoke test: full defaultLanguagePolicies matrix compiles + runs ───────
  it('works with the full defaultLanguagePolicies matrix from defaults.ts', () => {
    const policy = createDefaultPolicy(makePolicyConfig(defaultLanguagePolicies));
    const rng = createRNG(0);

    const classes: AgentClass[] = ['W1-Mono', 'W1-Bi', 'W2-Native', 'W2-Immigrant'];
    const validLanguages = new Set([L1, L2]);

    for (const sc of classes) {
      for (const hc of classes) {
        const result = policy({
          speaker: makeAgent(sc),
          hearer: makeAgent(hc),
          rng,
        });
        expect(validLanguages.has(result)).toBe(true);
      }
    }
  });

  // ─── Test: inventory-based mirrorHearer fixture used in registry tests ─────
  it('inventorySet helper builds an inventory readable by the test fixtures', () => {
    // Confirms the helper used by registry.test.ts's mirrorHearer tests works.
    const ref = 'yellow-like' as import('@/lib/schema/primitives').Referent;
    const lex = 'yellow' as import('@/lib/schema/primitives').TokenLexeme;
    const inv = inventorySet(
      emptyInventory(),
      L1,
      ref,
      lex,
      2.0 as import('@/lib/schema/primitives').Weight,
    );
    expect(inv.get(L1)?.get(ref)?.get(lex)).toBe(2.0);
  });
});

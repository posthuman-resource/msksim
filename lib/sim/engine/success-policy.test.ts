// Tests for the gaussian success policy (step 33).
//
// All tests run under Vitest's default `node` environment. Pure TypeScript;
// no DOM, no Next.js. Hand-built fixtures verify the kernel arithmetic and
// the determinism contract (deterministic mode unchanged; gaussian mode
// emits a numeric successProbability and respects σ-driven limits).

import { describe, it, expect } from 'vitest';
import { tick } from '../engine';
import type { SimulationState, InteractionEvent } from '../engine';
import { bootstrapExperiment } from '../bootstrap';
import { createRNG } from '../rng';
import { ExperimentConfig } from '@/lib/schema/experiment';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildState(config: ExperimentConfig, seed: number): SimulationState {
  const { world1, world2 } = bootstrapExperiment(config, seed);
  return { world1, world2, tickNumber: 0, config };
}

function runTicks(
  state: SimulationState,
  rng: ReturnType<typeof createRNG>,
  n: number,
): InteractionEvent[] {
  const events: InteractionEvent[] = [];
  for (let i = 0; i < n; i++) {
    events.push(...tick(state, rng).interactions);
  }
  return events;
}

/** Small well-mixed two-world config; supplies a successPolicy override. */
function configWithPolicy(
  successPolicy:
    | { kind: 'deterministic' }
    | { kind: 'gaussian'; sigma?: number; gaussianTopK?: number },
  agentCount = 6,
): ExperimentConfig {
  return ExperimentConfig.parse({
    world1: { agentCount, topology: { type: 'well-mixed' } },
    world2: { agentCount, topology: { type: 'well-mixed' } },
    schedulerMode: 'sequential',
    successPolicy,
  });
}

// All 16 (speaker, hearer) entries pinned to "always-l1" so no policy coin flips
// confound the per-step RNG accounting in the σ=∞ comparison test.
const agentClasses = ['W1-Mono', 'W1-Bi', 'W2-Native', 'W2-Immigrant'] as const;
const alwaysL1Policies = agentClasses.flatMap((s) =>
  agentClasses.map((h) => ({
    speakerClass: s,
    hearerClass: h,
    ruleId: 'always-l1' as const,
  })),
);

// ─── Test 1: deterministic mode is reproducible ───────────────────────────────

describe('successPolicy: deterministic (default)', () => {
  it('two same-seed runs produce byte-identical InteractionEvents', () => {
    const config = configWithPolicy({ kind: 'deterministic' });

    const state1 = buildState(config, 42);
    const events1 = runTicks(state1, createRNG(42), 50);

    const state2 = buildState(config, 42);
    const events2 = runTicks(state2, createRNG(42), 50);

    expect(JSON.stringify(events1)).toBe(JSON.stringify(events2));
  });

  it('every emitted event has successProbability === null', () => {
    const config = configWithPolicy({ kind: 'deterministic' });
    const state = buildState(config, 42);
    const events = runTicks(state, createRNG(42), 5);

    expect(events.length).toBeGreaterThan(0);
    for (const e of events) {
      expect(e.successProbability).toBeNull();
    }
  });
});

// ─── Test 2: gaussian mode is reproducible and well-typed ─────────────────────

describe('successPolicy: gaussian', () => {
  it('two same-seed runs produce byte-identical InteractionEvents', () => {
    const config = configWithPolicy({ kind: 'gaussian', sigma: 1.0, gaussianTopK: 10 });

    const state1 = buildState(config, 42);
    const events1 = runTicks(state1, createRNG(42), 50);

    const state2 = buildState(config, 42);
    const events2 = runTicks(state2, createRNG(42), 50);

    expect(JSON.stringify(events1)).toBe(JSON.stringify(events2));
  });

  it('every emitted event has a numeric successProbability in [0, 1]', () => {
    const config = configWithPolicy({ kind: 'gaussian', sigma: 1.0 });
    const state = buildState(config, 42);
    const events = runTicks(state, createRNG(42), 5);

    expect(events.length).toBeGreaterThan(0);
    for (const e of events) {
      expect(typeof e.successProbability).toBe('number');
      expect(e.successProbability).toBeGreaterThanOrEqual(0);
      expect(e.successProbability).toBeLessThanOrEqual(1);
    }
  });

  // Hand-computed Ps for a controlled fixture.
  //   speaker (W1-Mono): only "yellow" (weight 1.0). Top-K → { "L1:yellow": 1.0 }.
  //   hearer (W1-Bi):    only "yellow" (weight 0.5). Top-K → { "L1:yellow": 0.5 }.
  //   distSq = (1.0 - 0.5)² = 0.25
  //   Ps     = exp(-0.25 / (2·1²)) = exp(-0.125) ≈ 0.8824969…
  it('emits hand-computed Ps for a known two-agent fixture', () => {
    const vocabSeed = {
      'W1-Mono': {
        L1: { 'yellow-like': [{ lexeme: 'yellow', initialWeight: 1.0 }] },
      },
      'W1-Bi': {
        L1: { 'yellow-like': [{ lexeme: 'yellow', initialWeight: 0.5 }] },
      },
      'W2-Native': {},
      'W2-Immigrant': {},
    };

    const config = ExperimentConfig.parse({
      world1: {
        agentCount: 2,
        // ratio 1.0 → Math.round(2*1/2)=1 mono + 1 bi.
        monolingualBilingualRatio: 1.0,
        topology: { type: 'well-mixed' },
        referents: ['yellow-like'],
        vocabularySeed: vocabSeed,
      },
      world2: {
        agentCount: 1,
        topology: { type: 'well-mixed' },
        referents: ['yellow-like'],
        vocabularySeed: vocabSeed,
      },
      languagePolicies: alwaysL1Policies,
      schedulerMode: 'sequential',
      preferentialAttachment: { enabled: false },
      retryLimit: 0,
      successPolicy: { kind: 'gaussian', sigma: 1.0, gaussianTopK: 10 },
    });

    const state = buildState(config, 0);
    const events = runTicks(state, createRNG(0), 1);

    expect(events.length).toBeGreaterThan(0);
    const expectedPs = Math.exp(-0.125);
    for (const e of events) {
      expect(e.successProbability).not.toBeNull();
      expect(Math.abs(e.successProbability! - expectedPs)).toBeLessThan(1e-9);
    }
  });

  it('limit σ → ∞: Ps → 1 for every interaction', () => {
    const config = configWithPolicy({ kind: 'gaussian', sigma: 1e9, gaussianTopK: 10 }, 6);
    const state = buildState(config, 1);
    const events = runTicks(state, createRNG(1), 10);

    expect(events.length).toBeGreaterThan(0);
    for (const e of events) {
      expect(e.successProbability).not.toBeNull();
      expect(Math.abs(e.successProbability! - 1.0)).toBeLessThan(1e-6);
    }
  });

  it('limit σ → 0 with identical vectors: Ps === 1 (exact)', () => {
    // All W1-Mono agents share the identical seeded vocabulary, so their
    // top-K token vectors are identical → distSq = 0 → exp(0) = 1 exactly,
    // independent of σ.
    const monoOnlyVocab = {
      'W1-Mono': {
        L1: { 'yellow-like': [{ lexeme: 'yellow', initialWeight: 1.0 }] },
      },
      'W1-Bi': {},
      'W2-Native': {},
      'W2-Immigrant': {},
    };

    const config = ExperimentConfig.parse({
      world1: {
        agentCount: 4,
        monolingualBilingualRatio: 1e9, // effectively all monolingual
        topology: { type: 'well-mixed' },
        referents: ['yellow-like'],
        vocabularySeed: monoOnlyVocab,
      },
      world2: {
        agentCount: 1,
        topology: { type: 'well-mixed' },
        referents: ['yellow-like'],
        vocabularySeed: monoOnlyVocab,
      },
      languagePolicies: alwaysL1Policies,
      schedulerMode: 'sequential',
      preferentialAttachment: { enabled: false },
      retryLimit: 0,
      // First tick only — before any weight updates have differentiated agents.
      successPolicy: { kind: 'gaussian', sigma: 1e-9, gaussianTopK: 10 },
    });

    const state = buildState(config, 0);
    const events = runTicks(state, createRNG(0), 1);

    expect(events.length).toBeGreaterThan(0);
    for (const e of events) {
      expect(e.successProbability).toBe(1);
      expect(e.success).toBe(true);
    }
  });

  it('limit σ → 0 with differing vectors: Ps ≈ 0 (and success === false)', () => {
    // W1-Mono: only L1 tokens. W1-Bi: L1 + L2 tokens. distSq ≥ 2 (the L2 entries
    // are present on the bi side and absent on the mono side, contributing 2·1²).
    // With σ = 1e-9, exp(-2/2e-18) underflows to 0.0 → rng.nextFloat() < 0 is false.
    const config = ExperimentConfig.parse({
      world1: {
        agentCount: 2,
        monolingualBilingualRatio: 1.0, // 1 mono + 1 bi
        topology: { type: 'well-mixed' },
      },
      world2: {
        agentCount: 1,
        topology: { type: 'well-mixed' },
      },
      languagePolicies: alwaysL1Policies,
      schedulerMode: 'sequential',
      preferentialAttachment: { enabled: false },
      retryLimit: 0,
      successPolicy: { kind: 'gaussian', sigma: 1e-9, gaussianTopK: 10 },
    });

    const state = buildState(config, 0);
    const events = runTicks(state, createRNG(0), 1);

    expect(events.length).toBeGreaterThan(0);
    for (const e of events) {
      expect(e.successProbability).not.toBeNull();
      expect(e.successProbability!).toBeLessThan(1e-100);
      expect(e.success).toBe(false);
    }
  });
});

// ─── Test 3: gaussian-mode interaction count matches deterministic ────────────

describe('successPolicy: gaussian RNG accounting', () => {
  // Invariant: the gaussian arm must add no spurious interactions or retries
  // versus the deterministic arm. With σ=1e9 every Ps rounds to 1.0, so the
  // success/failure outcome is identical between modes for the same fixture and
  // the per-tick interaction count is unchanged. (Per-step RNG state divergence
  // after the inserted nextFloat() means we cannot compare event sequences
  // verbatim — only the count and per-event success outcome.)
  it('σ=1e9 gaussian emits the same number of events as deterministic mode', () => {
    const detConfig = configWithPolicy({ kind: 'deterministic' });
    const gConfig = configWithPolicy({ kind: 'gaussian', sigma: 1e9, gaussianTopK: 10 });

    const detEvents = runTicks(buildState(detConfig, 7), createRNG(7), 1);
    const gEvents = runTicks(buildState(gConfig, 7), createRNG(7), 1);

    expect(detEvents.length).toBeGreaterThan(0);
    expect(gEvents.length).toBe(detEvents.length);

    // Both modes succeed at every interaction (det because all hearers know
    // every seeded token; gaussian because Ps≈1).
    expect(detEvents.every((e) => e.success)).toBe(true);
    expect(gEvents.every((e) => e.success)).toBe(true);
  });
});

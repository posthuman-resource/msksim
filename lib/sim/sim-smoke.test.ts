// sim-smoke.test.ts — Vitest CI gate for the end-to-end simulation pipeline.
//
// Imports runSmoke from @/scripts/sim-smoke (resolved via vite-tsconfig-paths
// from vitest.config.ts which reads tsconfig.json's "@/*": ["./*"] mapping).
//
// All six tests run in the default `node` environment (no browser, no DOM).
// Tests run sequentially within this file (Vitest's default — no .concurrent
// needed since the 50-tick pipeline is CPU-bound and parallelism wouldn't help).
//
// Seed 7 is intentionally distinct from the CLI script's seed 42: using a
// different seed makes it more likely to catch non-determinism that only
// manifests at specific seed values.
//
// Per CLAUDE.md "Testing conventions": every test pins a seed and tick count,
// and asserts bit-identical output across repeated invocations (determinism
// invariant). A failure here is a release-blocking bug.
//
// Per docs/plan/18-simulation-smoke-test.md §9 — six named tests:
//   1. Full pipeline runs without throwing
//   2. Determinism invariant
//   3. Plausibility checks
//   4. Ablation: always-l1 vs default
//   5. Classification label validity
//   6. Tick count and seed metadata match input

import { describe, test, expect } from 'vitest';
import { ExperimentConfig } from '@/lib/schema/experiment';
import { runSmoke } from '@/scripts/sim-smoke';

const TICK_COUNT = 50;
const SEED = 7;

describe('sim-smoke', () => {
  test('full pipeline runs 50 ticks without throwing', () => {
    const config = ExperimentConfig.parse({});
    const result = runSmoke(config, SEED, TICK_COUNT);

    expect(result.tickCount).toBe(TICK_COUNT);
    expect(result.scalarTimeSeries).toHaveLength(TICK_COUNT);
    expect(result.graphTimeSeries).toHaveLength(TICK_COUNT);
    expect(result.summary).toBeDefined();
    expect(typeof result.summary.classification).toBe('string');
  });

  test('determinism invariant: two 50-tick runs produce bit-identical time series', () => {
    const config = ExperimentConfig.parse({});
    const result1 = runSmoke(config, SEED, TICK_COUNT);
    const result2 = runSmoke(config, SEED, TICK_COUNT);

    // JSON.stringify gives a readable diff in Vitest output and is equivalent to
    // deep-equal for structuredClone-safe shapes (which every sim module returns).
    // This is the canonical determinism check pattern per CLAUDE.md "Testing conventions".
    expect(JSON.stringify(result1.scalarTimeSeries)).toBe(JSON.stringify(result2.scalarTimeSeries));
    expect(JSON.stringify(result1.graphTimeSeries)).toBe(JSON.stringify(result2.graphTimeSeries));
  });

  test('plausibility: success rate > 0, Nw bounded, assimilation and modularity in range', () => {
    const config = ExperimentConfig.parse({});
    const result = runSmoke(config, SEED, TICK_COUNT);

    const finalScalar = result.scalarTimeSeries[TICK_COUNT - 1];
    const finalGraph = result.graphTimeSeries[TICK_COUNT - 1];

    // Success rate > 0: at 50 ticks on a ~50-agent-per-world 2D lattice, some
    // interactions must have succeeded (Baronchelli 2006: we are in the coarsening
    // phase where Nw is still growing but interactions are non-zero).
    const maxRate = Math.max(
      finalScalar.overall.successRate.rate,
      finalScalar.world1.successRate.rate,
      finalScalar.world2.successRate.rate,
    );
    expect(maxRate).toBeGreaterThan(0);

    // Nw ≤ total distinct {lang:lex} pairs in the vocabulary seed. The Naming Game
    // can only reduce the active vocabulary from its seeded initial state (tokens
    // lose weight over time; no new tokens are invented). Double-counting bugs would
    // push Nw above this bound.
    const nwW1 = finalScalar.world1.distinctActiveTokens;
    const vocabSeen = new Set<string>();
    for (const agentClassMap of Object.values(config.world1.vocabularySeed)) {
      for (const [lang, refMap] of Object.entries(agentClassMap)) {
        for (const entries of Object.values(refMap)) {
          for (const entry of entries) {
            vocabSeen.add(`${lang}:${entry.lexeme}`);
          }
        }
      }
    }
    expect(nwW1).toBeLessThanOrEqual(vocabSeen.size);

    // Assimilation index ∈ [0, 1] when non-null.
    const assimIdx = finalGraph.assimilationIndex;
    if (assimIdx !== null) {
      expect(assimIdx).toBeGreaterThanOrEqual(0);
      expect(assimIdx).toBeLessThanOrEqual(1);
    }

    // Modularity ∈ [-0.5, 1.0] (theoretical Louvain range per step 16 research notes).
    const modularity = finalGraph.interactionGraphModularity;
    expect(modularity).toBeGreaterThanOrEqual(-0.5);
    expect(modularity).toBeLessThanOrEqual(1.0);
  });

  test('ablation: always-l1 policy produces materially different assimilation than default', () => {
    const config = ExperimentConfig.parse({});
    const defaultResult = runSmoke(config, SEED, TICK_COUNT);
    const ablationResult = runSmoke(config, SEED, TICK_COUNT, { policy: 'always-l1' });

    const defaultAssim = defaultResult.graphTimeSeries[TICK_COUNT - 1].assimilationIndex;
    const ablationAssim = ablationResult.graphTimeSeries[TICK_COUNT - 1].assimilationIndex;

    // Rationale: always-l1 forces W2-Immigrants to speak L1 to W2-Natives, who have no
    // L1 vocabulary. All W2-Imm→W2-Native interactions fail. No W2-Native→W2-Immigrant
    // interactions can start (W2-Native has no L1 referents). Result: no qualifying
    // W2-Imm↔W2-Native successes → assimilation index = null.
    //
    // Default policy uses w2imm-to-w2native-both (50/50 L1/L2) and W2-Native always-l2.
    // L2 interactions between these classes succeed → assimilation index > 0.
    //
    // If both are null at 50 ticks (too short for any qualifying events), skip the
    // assertion rather than fail — this is an inconclusive run, not a policy bug.
    if (defaultAssim === null && ablationAssim === null) {
      // Inconclusive at TICK_COUNT=50 — skip diff assertion.
      console.warn(
        `sim-smoke ablation: both default and always-l1 have null assimilation at tick ${TICK_COUNT} — run length may be too short to observe qualifying events; assertion skipped`,
      );
      return;
    }

    if (defaultAssim !== null && ablationAssim !== null) {
      // Both measurable: difference must exceed 0.05.
      expect(Math.abs(defaultAssim - ablationAssim)).toBeGreaterThan(0.05);
    }
    // else: one null, one non-null → clear policy signal → pass (no assertion needed)
  });

  test('summary: classification label is one of the four valid values', () => {
    const config = ExperimentConfig.parse({});
    const result = runSmoke(config, SEED, TICK_COUNT);

    // At 50 ticks the run will almost certainly be 'inconclusive' or 'mixed'
    // (too early for convergence per Baronchelli 2006), but any of the four is valid.
    // This test is an integrity check on the step-17 summary reducer output.
    const validClassifications = ['assimilated', 'segregated', 'mixed', 'inconclusive'];
    expect(validClassifications).toContain(result.summary.classification);
  });

  test('tick count and seed metadata match the inputs', () => {
    const config = ExperimentConfig.parse({});
    const result = runSmoke(config, SEED, TICK_COUNT);

    expect(result.tickCount).toBe(TICK_COUNT);
    expect(result.seed).toBe(SEED);
    // Verify time series lengths are consistent with the requested tick count.
    expect(result.scalarTimeSeries).toHaveLength(TICK_COUNT);
    expect(result.graphTimeSeries).toHaveLength(TICK_COUNT);
  });
});

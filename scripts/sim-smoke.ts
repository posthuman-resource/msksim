/**
 * sim-smoke.ts — End-to-end smoke test for the msksim simulation core.
 *
 * Composes the full pipeline: RNG (step 09) → bootstrap (step 11) → engine tick
 * loop (step 13) → scalar metrics (step 15) → graph metrics (step 16) → run
 * summary (step 17). This is the last pure-TypeScript integration check before
 * the Web Worker integration (steps 19-20) arrives. If this script runs cleanly,
 * the same lib/sim/* modules will bundle cleanly under Turbopack's worker graph
 * in step 20 — both resolve the same module-purity invariant (no fs, no path,
 * no next/*, no react, no server-only boundaries).
 *
 * Usage:
 *   npx tsx scripts/sim-smoke.ts [tickCount]
 *   npm run sim:smoke
 *   npm run sim:smoke -- 50    (note the `--` separator required by npm)
 *
 * Checks performed (all must pass for exit 0):
 *   1. Determinism: two same-seed runs produce bit-identical time series.
 *   2. Ablation: default policy vs always-l1 differs by > 0.05 in assimilation.
 *   3. Plausibility: successRate > 0, Nw ≤ vocab bound, assimilation ∈ [0,1],
 *      modularity ∈ [-0.5, 1.0].
 *
 * Exit codes: 0 = all checks passed, 1 = check failed, 2 = bad arguments.
 *
 * No `import 'server-only'` — lib/sim/ is cross-boundary shared (CLAUDE.md).
 */

import { ExperimentConfig } from '@/lib/schema/experiment';
import { bootstrapExperiment } from '@/lib/sim/bootstrap';
import { tick } from '@/lib/sim/engine';
import type { SimulationState } from '@/lib/sim/engine';
import { computeScalarMetrics } from '@/lib/sim/metrics/scalar';
import { computeGraphMetrics } from '@/lib/sim/metrics/graph';
import {
  createInteractionGraph,
  updateInteractionGraph,
} from '@/lib/sim/metrics/interaction-graph';
import { computeRunSummary } from '@/lib/sim/metrics/summary';
import type {
  ScalarMetricsSnapshot,
  GraphMetricsSnapshot,
  RunSummary,
} from '@/lib/sim/metrics/types';
import type { Language } from '@/lib/schema/primitives';
import type { PolicyName } from '@/lib/sim/policy';

// ── Public types ──────────────────────────────────────────────────────────────

export type SmokeResult = {
  readonly scalarTimeSeries: ScalarMetricsSnapshot[];
  readonly graphTimeSeries: GraphMetricsSnapshot[];
  readonly summary: RunSummary;
  /** Wall-clock milliseconds for the tick loop (reporting only — not simulation logic). */
  readonly wallClockMs: number;
  readonly tickCount: number;
  readonly seed: number;
};

// ── Core function ─────────────────────────────────────────────────────────────

/**
 * Run the full simulation pipeline for `tickCount` ticks.
 *
 * Pure given (config, seed, tickCount, opts): no I/O, no Math.random, no
 * wall-clock-dependent simulation logic (wall-clock is captured for reporting only).
 * Two calls with identical arguments produce bit-identical SmokeResult objects
 * (except wallClockMs which varies per machine).
 *
 * @param config    - Parsed ExperimentConfig (typically ExperimentConfig.parse({}))
 * @param seed      - Deterministic RNG seed (canonical smoke seed: 42)
 * @param tickCount - Number of ticks to simulate
 * @param opts.policy - Policy override. Only 'always-l1' and 'always-l2' are
 *   supported: they remap all per-pair languagePolicies entries to the
 *   corresponding ruleId. The engine hardcodes policyName:'default', so
 *   ablation is achieved by rewriting the per-pair entries, not the policyName.
 *   'random' and 'mirror-hearer' cannot be expressed as ruleIds and are ignored.
 */
export function runSmoke(
  config: ExperimentConfig,
  seed: number,
  tickCount: number,
  opts?: { policy?: PolicyName },
): SmokeResult {
  // Wall-clock start (measurement only — not part of simulation logic).
  const nsStart = process.hrtime.bigint();

  // Apply policy override by rewriting the per-pair languagePolicies entries.
  // The engine hardcodes policyName: 'default' so the only hook for ablation
  // is the entries array. 'always-l1' and 'always-l2' are valid LanguagePolicyRuleId
  // values. Other PolicyNames ('random', 'mirror-hearer') have no ruleId equivalent
  // and leave the config unchanged.
  let effectiveConfig = config;
  if (opts?.policy === 'always-l1' || opts?.policy === 'always-l2') {
    const overrideRuleId = opts.policy; // 'always-l1' | 'always-l2'
    effectiveConfig = {
      ...config,
      languagePolicies: config.languagePolicies.map((entry) => ({
        ...entry,
        ruleId: overrideRuleId,
      })),
    };
  }

  // Bootstrap: create worlds and the single shared RNG from config + seed.
  const { world1, world2, rng } = bootstrapExperiment(effectiveConfig, seed);

  // Derive L2 label (same derivation the engine uses internally, per engine.ts).
  // world.languages is sorted alphabetically by bootstrap's deriveLanguages helper,
  // so [0] = L1 and [1] = L2 in the default config.
  const l2Label = (world1.languages[1] ?? world2.languages[1] ?? world1.languages[0]) as Language;

  // Initialize simulation state.
  let state: SimulationState = {
    world1,
    world2,
    tickNumber: 0,
    config: effectiveConfig,
  };

  // Initialize cumulative interaction graph (step 16 — caller-owned per design).
  const interactionGraph = createInteractionGraph();

  // Initialize per-tick time series arrays.
  const scalarTimeSeries: ScalarMetricsSnapshot[] = [];
  const graphTimeSeries: GraphMetricsSnapshot[] = [];

  // Tick loop. Each iteration: tick → update graph → compute metrics → advance state.
  for (let t = 0; t < tickCount; t++) {
    const tickResult = tick(state, rng);

    // Merge successful interactions into the cumulative graph before computing metrics.
    updateInteractionGraph(interactionGraph, tickResult.interactions);

    // Compute per-tick metrics from the post-tick agent inventories.
    const scalar = computeScalarMetrics(
      tickResult.state.world1,
      tickResult.state.world2,
      tickResult.interactions,
    );
    const graph = computeGraphMetrics(
      tickResult.state.world1,
      tickResult.state.world2,
      interactionGraph,
      tickResult.interactions,
      { tick: t, l2Label, rng },
    );

    scalarTimeSeries.push(scalar);
    graphTimeSeries.push(graph);

    // Advance to next tick's state (the engine mutates state in place; this
    // assignment is a no-op but makes the data flow visible to future readers).
    state = tickResult.state;
  }

  // Compute end-of-run summary from the full time series.
  const summary = computeRunSummary(scalarTimeSeries, graphTimeSeries, effectiveConfig);

  const wallClockMs = Number(process.hrtime.bigint() - nsStart) / 1_000_000;

  return Object.freeze({
    scalarTimeSeries,
    graphTimeSeries,
    summary,
    wallClockMs,
    tickCount,
    seed,
  });
}

// ── CLI main block ────────────────────────────────────────────────────────────
// tsx evaluates import.meta.url as the current file's URL (esbuild emulates
// this via __filename in CJS mode), so the guard fires only when the file is
// invoked directly, not when imported by the test suite.

if (import.meta.url === `file://${process.argv[1]}`) {
  // 1. Parse tick-count argument.
  const rawArg = process.argv[2];
  const tickCount = rawArg !== undefined ? Number.parseInt(rawArg, 10) : 200;
  if (Number.isNaN(tickCount) || tickCount < 1 || tickCount > 100_000) {
    console.error('Usage: npx tsx scripts/sim-smoke.ts [tickCount]');
    console.error('  tickCount: integer 1–100000 (default 200)');
    process.exit(2);
  }

  // 2. Parse the PDF canonical config (every field at its spec default).
  const config = ExperimentConfig.parse({});
  let hasFailure = false;

  // 3. Primary run (canonical reproducibility seed 42).
  const result = runSmoke(config, 42, tickCount);

  // 4. Determinism check: two same-seed runs must be bit-identical.
  const result2 = runSmoke(config, 42, tickCount);
  const scalarMatch =
    JSON.stringify(result.scalarTimeSeries) === JSON.stringify(result2.scalarTimeSeries);
  const graphMatch =
    JSON.stringify(result.graphTimeSeries) === JSON.stringify(result2.graphTimeSeries);

  if (!scalarMatch || !graphMatch) {
    const mismatchedSeries = !scalarMatch ? result.scalarTimeSeries : result.graphTimeSeries;
    const mismatchedSeries2 = !scalarMatch ? result2.scalarTimeSeries : result2.graphTimeSeries;
    const firstIdx = mismatchedSeries.findIndex(
      (_, i) => JSON.stringify(mismatchedSeries[i]) !== JSON.stringify(mismatchedSeries2[i]),
    );
    console.error('FAIL determinism: time series mismatch');
    console.error(`Determinism violation at tick ${firstIdx}`);
    console.error(`  expected: ${JSON.stringify(mismatchedSeries[firstIdx])}`);
    console.error(`  actual:   ${JSON.stringify(mismatchedSeries2[firstIdx])}`);
    hasFailure = true;
  }

  // 5. Policy ablation check: always-l1 must produce materially different assimilation.
  // Rationale (Baronchelli 2006 / Dall'Asta 2008): default policy allows W2-Immigrants
  // to speak L2 to W2-Natives (w2imm-to-w2native-both), producing L2 successes and a
  // non-zero assimilation index. With always-l1, W2-Immigrants speak L1 to W2-Natives
  // who have no L1 vocabulary → all fail → no qualifying W2-Imm↔W2-Native successes
  // → assimilation index = null. The one-null / one-non-null case is a clear signal.
  const ablation = runSmoke(config, 42, tickCount, { policy: 'always-l1' });
  const defaultAssim = result.graphTimeSeries[tickCount - 1]?.assimilationIndex ?? null;
  const ablationAssim = ablation.graphTimeSeries[tickCount - 1]?.assimilationIndex ?? null;

  if (defaultAssim === null && ablationAssim === null) {
    console.error(
      `FAIL ablation: both default and always-l1 have null assimilation at tick ${tickCount} — ablation unmeasurable (run longer or check policy wiring)`,
    );
    hasFailure = true;
  } else if (defaultAssim !== null && ablationAssim !== null) {
    const diff = Math.abs(defaultAssim - ablationAssim);
    if (diff <= 0.05) {
      console.error(
        `FAIL ablation: |default(${defaultAssim.toFixed(4)}) - always-l1(${ablationAssim.toFixed(4)})| = ${diff.toFixed(4)} ≤ 0.05`,
      );
      hasFailure = true;
    }
  }
  // else: one null, one non-null → clear policy signal → pass

  // 6. Plausibility checks (all failures are accumulated before reporting).
  const finalScalar = result.scalarTimeSeries[tickCount - 1];
  const finalGraph = result.graphTimeSeries[tickCount - 1];

  // 6a. Success rate > 0 (we are in the coarsening phase, not flat-zero).
  const overallRate = finalScalar?.overall.successRate.rate ?? 0;
  const w1Rate = finalScalar?.world1.successRate.rate ?? 0;
  const w2Rate = finalScalar?.world2.successRate.rate ?? 0;
  const maxRate = Math.max(overallRate, w1Rate, w2Rate);
  if (maxRate <= 0) {
    console.error(
      `FAIL plausibility: successRate = 0 at tick ${tickCount} — engine may not be firing interactions`,
    );
    hasFailure = true;
  }

  // 6b. Nw ≤ total distinct {lang:lex} pairs seeded (can only shrink from seeded inventory).
  const nwW1 = finalScalar?.world1.distinctActiveTokens ?? 0;
  const nwW2 = finalScalar?.world2.distinctActiveTokens ?? 0;
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
  const maxVocabTokens = vocabSeen.size;
  if (nwW1 > maxVocabTokens) {
    console.error(
      `FAIL plausibility: world1 Nw=${nwW1} > max vocab tokens=${maxVocabTokens} (double-counting bug?)`,
    );
    hasFailure = true;
  }

  // 6c. Assimilation index ∈ [0, 1] when non-null.
  const assimIdx = finalGraph?.assimilationIndex ?? null;
  if (assimIdx !== null && (assimIdx < 0 || assimIdx > 1)) {
    console.error(`FAIL plausibility: assimilationIndex=${assimIdx} not in [0, 1]`);
    hasFailure = true;
  }

  // 6d. Modularity ∈ [-0.5, 1.0] (theoretical Louvain range per step 16 research notes).
  const modularity = finalGraph?.interactionGraphModularity ?? 0;
  if (modularity < -0.5 || modularity > 1.0) {
    console.error(`FAIL plausibility: interactionGraphModularity=${modularity} not in [-0.5, 1.0]`);
    hasFailure = true;
  }

  // 7. Compact text report (six to eight lines, no ANSI color — runs in CI and plain terminals).
  const segIdx = finalGraph?.segregationIndex ?? 0;
  const deterStr = scalarMatch && graphMatch ? 'OK (bit-identical across two runs)' : 'FAIL';
  const defaultAssimStr = defaultAssim != null ? defaultAssim.toFixed(4) : 'null';
  const ablationAssimStr = ablationAssim != null ? ablationAssim.toFixed(4) : 'null';
  const diffStr =
    defaultAssim != null && ablationAssim != null
      ? Math.abs(defaultAssim - ablationAssim).toFixed(4)
      : '(one or both null — clear policy signal)';

  console.log(
    `sim-smoke: tick count = ${tickCount}, wall-clock = ${result.wallClockMs.toFixed(1)}ms`,
  );
  console.log(`  Nw: world1 = ${nwW1}, world2 = ${nwW2}`);
  console.log(`  success rate: world1 = ${w1Rate.toFixed(4)}, world2 = ${w2Rate.toFixed(4)}`);
  console.log(
    `  assimilation index = ${assimIdx ?? 'null'}, segregation index = ${segIdx.toFixed(4)}`,
  );
  console.log(`  classification = ${result.summary.classification}`);
  console.log(`  time-to-consensus = ${result.summary.timeToConsensus ?? 'not reached'}`);
  console.log(`  determinism: ${deterStr}`);
  console.log(
    `  ablation: default=${defaultAssimStr} vs always-l1=${ablationAssimStr} Δassim=${diffStr} (threshold 0.05) ${hasFailure ? 'SEE ERRORS ABOVE' : 'OK'}`,
  );

  process.exit(hasFailure ? 1 : 0);
}

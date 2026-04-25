// End-of-run summary metrics reducer.
// Consumes the full per-tick ScalarMetricsSnapshot[] and GraphMetricsSnapshot[] time series
// produced by steps 15 and 16, and returns a single RunSummary object.
//
// Per docs/spec.md §7.3: mean/median/max of each per-tick metric, convergence status,
// time-to-consensus, and run classification.
//
// Pure function — no I/O, no randomness, no side effects, no runtime state.
// No `import 'server-only'` — this module loads in the step-20 Web Worker (client context)
// as well as in Server Components. See CLAUDE.md "Next.js 16 deltas from training data" §1.

import type { ExperimentConfig } from '@/lib/schema/experiment';
import type {
  ScalarMetricsSnapshot,
  GraphMetricsSnapshot,
  RunSummary,
  ConvergenceStatus,
  RunClassification,
} from './types';

// ─── Flatten helpers ──────────────────────────────────────────────────────────

/**
 * Flatten a ScalarMetricsSnapshot into a dot-separated key → number map.
 * Keys: 'world1.successRate', 'world1.nw', 'world1.matchingRate',
 *       'world1.perLanguage.{lang}.meanTokenWeight', 'world1.perLanguage.{lang}.tokenWeightVariance',
 *       'world2.*' analogously, 'overall.successRate'.
 * successRateByClassPair is omitted — per-class-pair breakdowns are already in the raw snapshots
 * and add 48+ keys that are not referenced by any downstream consumer in v1.
 */
function flattenScalar(snapshot: ScalarMetricsSnapshot): Record<string, number> {
  const out: Record<string, number> = {};

  // world1
  out['world1.successRate'] = snapshot.world1.successRate.rate;
  out['world1.nw'] = snapshot.world1.distinctActiveTokens;
  out['world1.matchingRate'] = snapshot.world1.matchingRate;
  out['world1.spatialHomophily'] = snapshot.world1.spatialHomophily;
  for (const [lang, m] of Object.entries(snapshot.world1.perLanguage)) {
    out[`world1.perLanguage.${lang}.meanTokenWeight`] = m.meanTokenWeight;
    out[`world1.perLanguage.${lang}.tokenWeightVariance`] = m.tokenWeightVariance;
  }

  // world2
  out['world2.successRate'] = snapshot.world2.successRate.rate;
  out['world2.nw'] = snapshot.world2.distinctActiveTokens;
  out['world2.matchingRate'] = snapshot.world2.matchingRate;
  out['world2.spatialHomophily'] = snapshot.world2.spatialHomophily;
  for (const [lang, m] of Object.entries(snapshot.world2.perLanguage)) {
    out[`world2.perLanguage.${lang}.meanTokenWeight`] = m.meanTokenWeight;
    out[`world2.perLanguage.${lang}.tokenWeightVariance`] = m.tokenWeightVariance;
  }

  // overall
  out['overall.successRate'] = snapshot.overall.successRate.rate;

  return out;
}

/**
 * Flatten a GraphMetricsSnapshot into a dot-separated key → number map.
 * Uses a 'graph.' prefix on all keys to prevent collisions with scalar metric keys.
 * assimilationIndex (number | null) is encoded as NaN when null, preserving the
 * "no qualifying interactions this tick" signal. The NaN-skip policy in mean/median/max
 * handles this correctly without loss of information.
 */
function flattenGraph(snapshot: GraphMetricsSnapshot): Record<string, number> {
  return {
    'graph.world1.largestClusterSize': snapshot.world1.largestClusterSize,
    'graph.world1.clusterCount': snapshot.world1.clusterCount,
    'graph.world2.largestClusterSize': snapshot.world2.largestClusterSize,
    'graph.world2.clusterCount': snapshot.world2.clusterCount,
    'graph.modularity': snapshot.interactionGraphModularity,
    // null → NaN: "no qualifying interactions this tick" is analogous to an empty denominator
    'graph.assimilation': snapshot.assimilationIndex ?? NaN,
    'graph.segregation': snapshot.segregationIndex,
  };
}

/**
 * Merge scalar and graph snapshots into per-metric number arrays.
 * Keys from flattenScalar and flattenGraph have no overlap by construction
 * (graph keys are prefixed with 'graph.'; scalar keys start with 'world' or 'overall').
 */
function collectSeries(
  scalarSnapshots: ScalarMetricsSnapshot[],
  graphSnapshots: GraphMetricsSnapshot[],
): Record<string, number[]> {
  const series: Record<string, number[]> = {};

  for (const snap of scalarSnapshots) {
    const flat = flattenScalar(snap);
    for (const [key, value] of Object.entries(flat)) {
      if (!series[key]) series[key] = [];
      series[key].push(value);
    }
  }

  for (const snap of graphSnapshots) {
    const flat = flattenGraph(snap);
    for (const [key, value] of Object.entries(flat)) {
      if (!series[key]) series[key] = [];
      series[key].push(value);
    }
  }

  return series;
}

// ─── Scalar reducers ──────────────────────────────────────────────────────────

/**
 * Arithmetic mean of values, skipping NaN entries.
 * NaN per-tick values represent empty denominators (e.g., zero interactions) and must
 * not propagate — propagating NaN would corrupt the summary for any run with a single
 * tick that had no interactions, even if 9999 other ticks were valid.
 * If ALL values are NaN (degenerate run with zero interactions throughout), returns NaN.
 */
function mean(values: number[]): number {
  const valid = values.filter((v) => !Number.isNaN(v));
  if (valid.length === 0) return NaN;
  return valid.reduce((a, b) => a + b, 0) / valid.length;
}

/**
 * Median of values, skipping NaN entries.
 * For even-length samples, returns the arithmetic mean of the two middle elements
 * (standard definition per Wikipedia: Median). NaN-skip policy matches mean().
 * If ALL values are NaN, returns NaN.
 */
function median(values: number[]): number {
  const valid = values.filter((v) => !Number.isNaN(v)).sort((a, b) => a - b);
  if (valid.length === 0) return NaN;
  const mid = Math.floor(valid.length / 2);
  return valid.length % 2 === 1 ? valid[mid] : (valid[mid - 1] + valid[mid]) / 2;
}

/**
 * Maximum of values, skipping NaN entries. NaN-skip policy matches mean().
 * If ALL values are NaN, returns NaN.
 */
function max(values: number[]): number {
  const valid = values.filter((v) => !Number.isNaN(v));
  if (valid.length === 0) return NaN;
  return Math.max(...valid);
}

// ─── Time-to-consensus ────────────────────────────────────────────────────────

/**
 * Detect the first tick at which Nw stabilizes at its asymptotic value for
 * ≥ windowTicks consecutive ticks.
 *
 * Algorithm (O(T) using a running counter):
 * - Asymptote = nwSeries[last], the candidate stable value.
 * - Walk forward, counting consecutive matches. When count reaches windowTicks,
 *   the stable window started at (i - windowTicks + 1).
 *
 * Returns null when:
 * - The series is shorter than windowTicks + 1 (not enough data).
 * - asymptote === 0 (physically impossible; treated as corrupted run).
 * - The trailing windowTicks values are not all at asymptote (run never stabilized).
 *
 * Per docs/spec.md §7.1: "Tick at which Nw first stabilizes at its asymptote for
 * ≥ windowTicks ticks." Baronchelli 2016 §2: consensus is the absorbing state where Nw = 1.
 *
 * Exported for direct unit-test access.
 */
export function computeTimeToConsensus(nwSeries: number[], windowTicks: number): number | null {
  if (nwSeries.length < windowTicks + 1) return null;

  const asymptote = nwSeries[nwSeries.length - 1];
  if (asymptote === 0) return null;

  let count = 0;
  for (let i = 0; i < nwSeries.length; i++) {
    if (nwSeries[i] === asymptote) {
      count++;
      if (count >= windowTicks) {
        return i - windowTicks + 1; // first tick of the stable window
      }
    } else {
      count = 0;
    }
  }

  return null;
}

// ─── Convergence status ───────────────────────────────────────────────────────

/**
 * Determine convergence status from the Nw time series and divergence signal.
 * Decision tree (order matters — diverged is checked before converged/metastable):
 * 1. isDiverged  → 'diverged'   (weights blew up; dynamics untrustworthy)
 * 2. timeToConsensus !== null && asymptote === 1 → 'converged'
 * 3. timeToConsensus !== null && asymptote > 1  → 'metastable'
 * 4. otherwise → 'unresolved'
 */
function determineConvergenceStatus(
  nwSeries: number[],
  isDiverged: boolean,
  timeToConsensus: number | null,
): ConvergenceStatus {
  if (isDiverged) return 'diverged';

  if (timeToConsensus !== null) {
    const asymptote = nwSeries[nwSeries.length - 1];
    return asymptote === 1 ? 'converged' : 'metastable';
  }

  return 'unresolved';
}

// ─── Classification ───────────────────────────────────────────────────────────

/**
 * Classify a run based on the final assimilation and segregation indices.
 * Decision tree (per docs/spec.md §7.3):
 * 1. NaN input → 'inconclusive' (no qualifying W2-Imm↔W2-Native interactions)
 * 2. assimilation > assimilationHigh AND segregation < segregationLow → 'assimilated'
 * 3. assimilation < assimilationLow AND segregation > segregationHigh → 'segregated'
 * 4. otherwise → 'mixed'
 *
 * Thresholds come from ExperimentConfig.classificationThresholds (user-configurable,
 * per spec §7.3 "user-configurable thresholds"). This function never hardcodes defaults —
 * it trusts the Zod schema to have filled them before the config reaches here.
 *
 * Exported for direct unit-test access.
 */
export function classifyRun(
  finalAssimilation: number,
  finalSegregation: number,
  thresholds: {
    assimilationHigh: number;
    segregationLow: number;
    assimilationLow: number;
    segregationHigh: number;
  },
): RunClassification {
  if (Number.isNaN(finalAssimilation) || Number.isNaN(finalSegregation)) return 'inconclusive';
  if (
    finalAssimilation > thresholds.assimilationHigh &&
    finalSegregation < thresholds.segregationLow
  ) {
    return 'assimilated';
  }
  if (
    finalAssimilation < thresholds.assimilationLow &&
    finalSegregation > thresholds.segregationHigh
  ) {
    return 'segregated';
  }
  return 'mixed';
}

// ─── Main entry point ─────────────────────────────────────────────────────────

/**
 * Compute the end-of-run summary from the full per-tick time series.
 *
 * @param scalarTimeSeries - Per-tick scalar snapshots from step 15.
 * @param graphTimeSeries  - Per-tick graph snapshots from step 16.
 * @param config           - Experiment config supplying classification thresholds and
 *                           convergence window (both user-configurable per spec §7.3).
 * @returns A frozen RunSummary (JSON-serializable, structuredClone-safe).
 *
 * Empty series edge case: returns meanMetrics/{}/..., timeToConsensus=null,
 * convergenceStatus='unresolved', classification='inconclusive'.
 *
 * NaN handling: per-tick NaN values (empty denominators) are skipped in
 * mean/median/max. If an entire metric series is NaN, the aggregated field is NaN.
 *
 * Divergence detection: if any meanTokenWeight value in the series is non-finite or
 * exceeds 1e15, the run is classified as 'diverged'. The engine guard (step 13/15)
 * may also emit Infinity; this fallback catches it regardless of which signal fires.
 * TODO(step 15 follow-up): replace with an explicit divergence flag from ScalarMetricsSnapshot
 * if step 15 adds one, per docs/plan/17-run-summary-metrics.md §7 step 6.
 */
export function computeRunSummary(
  scalarTimeSeries: ScalarMetricsSnapshot[],
  graphTimeSeries: GraphMetricsSnapshot[],
  config: ExperimentConfig,
): RunSummary {
  // 1. Collect all metric time series into flat per-key arrays.
  const series = collectSeries(scalarTimeSeries, graphTimeSeries);

  // 2. Compute mean/median/max for every metric key.
  const meanMetrics: Record<string, number> = {};
  const medianMetrics: Record<string, number> = {};
  const maxMetrics: Record<string, number> = {};
  for (const [key, values] of Object.entries(series)) {
    meanMetrics[key] = mean(values);
    medianMetrics[key] = median(values);
    maxMetrics[key] = max(values);
  }

  // 3. Extract the per-tick Nw series for both worlds; use their max at each tick.
  //    "Converged" means both worlds have stabilized — the run is not done until the
  //    global maximum Nw across worlds reaches its asymptote.
  const nw1 = series['world1.nw'] ?? [];
  const nw2 = series['world2.nw'] ?? [];
  const nwLen = Math.max(nw1.length, nw2.length);
  const nwSeries: number[] = [];
  for (let i = 0; i < nwLen; i++) {
    nwSeries.push(Math.max(nw1[i] ?? 0, nw2[i] ?? 0));
  }

  // 4. Detect divergence: any meanTokenWeight exceeding finite range.
  const weightKeys = Object.keys(series).filter((k) => k.includes('.meanTokenWeight'));
  let isDiverged = false;
  outer: for (const key of weightKeys) {
    for (const v of series[key]) {
      if (!Number.isFinite(v) || Math.abs(v) > 1e15) {
        isDiverged = true;
        break outer;
      }
    }
  }

  // 5. Time-to-consensus and convergence status.
  const windowTicks = config.convergence.consensusWindowTicks;
  const timeToConsensus = computeTimeToConsensus(nwSeries, windowTicks);
  const convergenceStatus = determineConvergenceStatus(nwSeries, isDiverged, timeToConsensus);

  // 6. Classification from the FINAL tick's assimilation and segregation indices.
  //    Per spec §7.3 "computed from the final assimilation and segregation indices."
  const lastGraph = graphTimeSeries.length > 0 ? graphTimeSeries[graphTimeSeries.length - 1] : null;
  const finalAssimilation = lastGraph?.assimilationIndex ?? NaN;
  const finalSegregation = lastGraph?.segregationIndex ?? NaN;
  const classification = classifyRun(
    finalAssimilation,
    finalSegregation,
    config.classificationThresholds,
  );

  // 7. Return a frozen RunSummary. Object.freeze prevents accidental downstream mutation.
  //    The nested maps are also frozen so the structuredClone-safe contract is explicit.
  return Object.freeze({
    meanMetrics: Object.freeze(meanMetrics),
    medianMetrics: Object.freeze(medianMetrics),
    maxMetrics: Object.freeze(maxMetrics),
    convergenceStatus,
    timeToConsensus,
    classification,
  });
}

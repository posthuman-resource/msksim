// ScalarMetricsSnapshot and related types for per-tick scalar observables.
// Per docs/spec.md §7.1 — five metrics:
//   1. Communication success rate
//   2. Mean token weight
//   3. Token weight variance
//   4. Number of distinct active tokens (Nw)
//   5. Matching rate
//
// Client-safe, server-safe, worker-safe — no `import 'server-only'`.
// lib/sim/ must bundle into the step-20 Web Worker (client context in Turbopack).
// See CLAUDE.md "Next.js 16 deltas" for the no-server-only invariant.

import type { AgentClass, Language } from '../types';

// ─── Class-pair key ───────────────────────────────────────────────────────────

/**
 * Key for (speakerClass, hearerClass) pairs in SuccessRateByClassPair.
 * Exhaustive union of all 16 possible (AgentClass × AgentClass) combinations
 * so TypeScript catches missing cells at compile time.
 */
export type ClassPairKey = `${AgentClass}__${AgentClass}`;

// ─── Success rate ─────────────────────────────────────────────────────────────

/**
 * Success/total/rate triple used throughout scalar metrics.
 * rate is NaN when total === 0 (canonical "undefined" marker).
 * Recharts/d3 skip NaN as a time-series gap; a literal 0 would plot as a
 * misleading "100% failure" data point on the live dashboard.
 */
export type SuccessRate = {
  readonly successful: number;
  readonly total: number;
  readonly rate: number;
};

/**
 * Record keyed by `${speakerClass}__${hearerClass}`.
 * All 16 cells are always present, even when total === 0 for a cell
 * (rate: NaN in that case). Downstream consumers can index by a fixed shape.
 */
export type SuccessRateByClassPair = Record<ClassPairKey, SuccessRate>;

// ─── Per-language and per-world ───────────────────────────────────────────────

/** Mean and variance of non-zero token weights for a single language in one world. */
export type PerLanguageScalarMetrics = {
  /** Mean of all strictly-positive token weights. NaN when none exist. */
  readonly meanTokenWeight: number;
  /**
   * Sample variance (divisor n−1) of strictly-positive token weights.
   * NaN when fewer than 2 positive weights exist.
   * Divisor n−1 matches R's var() default (the CSV export target, step 30).
   */
  readonly tokenWeightVariance: number;
};

/** All scalar observables for one world at one tick. */
export type PerWorldScalarMetrics = {
  readonly successRate: SuccessRate;
  readonly successRateByClassPair: SuccessRateByClassPair;
  /**
   * Nw: count of distinct (language, lexeme) pairs with any weight > 0 across
   * the whole agent population. The canonical Naming Game observable per
   * Dall'Asta et al. 2008 (arXiv:0803.0398).
   */
  readonly distinctActiveTokens: number;
  /**
   * Fraction of unordered agent pairs whose top-weighted token for a given
   * referent agrees, averaged over referents.
   * NaN when fewer than 2 agents in the world.
   */
  readonly matchingRate: number;
  /** Per-language breakdown of mean/variance, keyed by language label. */
  readonly perLanguage: Record<Language, PerLanguageScalarMetrics>;
};

// ─── Top-level snapshot ───────────────────────────────────────────────────────

/**
 * Flat, JSON-serializable snapshot of per-tick scalar observables.
 * Produced by computeScalarMetrics; consumed by steps 17, 20, 22, and 30.
 *
 * tick is nullable: computeScalarMetrics does not know the tick number; the
 * step-20 worker stamps it after the call. Keeping the field here (rather than
 * in a wrapper object) keeps the serialized shape flat for step-30's long-format
 * CSV export (one row per tick, no nested unwrapping).
 *
 * overall omits distinctActiveTokens, matchingRate, and perLanguage because those
 * metrics are per-world by spec §7.1 — merging across worlds is meaningless (the
 * two worlds do not share agents or topology).
 */
// ─── Graph metrics snapshot ───────────────────────────────────────────────────

/**
 * Per-tick snapshot of graph-derived observables.
 * Produced by computeGraphMetrics (step 16); consumed by steps 17, 20, 22, 23.
 *
 * interactionGraphModularity and segregationIndex are Louvain Q scores,
 * range [-1, +1]; values > 0.3 conventionally indicate non-trivial community
 * structure (Blondel et al. 2008; Wikipedia: Louvain method).
 *
 * assimilationIndex is null when the tick contains no successful W2-Immigrant ↔
 * W2-Native interactions (0/0 is undefined; null is chosen over NaN because JSON
 * round-trips null faithfully while NaN becomes null silently).
 */
export interface GraphMetricsSnapshot {
  readonly tick: number;
  readonly world1: {
    readonly largestClusterSize: number;
    readonly clusterCount: number;
  };
  readonly world2: {
    readonly largestClusterSize: number;
    readonly clusterCount: number;
  };
  /** Louvain modularity of the cumulative successful-interaction graph. */
  readonly interactionGraphModularity: number;
  /**
   * Among successful W2-Immigrant ↔ W2-Native interactions this tick,
   * the fraction that occurred in L2. null when no such interactions exist.
   */
  readonly assimilationIndex: number | null;
  /** Louvain modularity of the W2-Immigrant subgraph of the interaction graph. */
  readonly segregationIndex: number;
}

export type ScalarMetricsSnapshot = {
  readonly tick: number | null;
  readonly world1: PerWorldScalarMetrics;
  readonly world2: PerWorldScalarMetrics;
  readonly overall: {
    readonly successRate: SuccessRate;
    readonly successRateByClassPair: SuccessRateByClassPair;
  };
};

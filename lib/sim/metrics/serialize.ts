// lib/sim/metrics/serialize.ts — Serialize TickReport[] ↔ long-format tick_metrics rows.
//
// Pure TypeScript, no React, no DB, no 'use server'. Client-safe and worker-safe.
// Used by:
//   - persistCompletedRun Server Action (forward: TickReport[] → metric rows)
//   - run detail page (inverse: metric rows → TickReport[] → MetricsHistory → dashboard)
//
// The metric shapes declared here must stay in lockstep with the dashboard's
// shaper functions in metrics-dashboard.tsx. See docs/plan/26-run-persistence-and-browser.md §7.

import type { TickReport } from '@/workers/simulation.worker';
import type { RunClassification } from '@/lib/sim/metrics/types';
import type { Language } from '@/lib/sim/types';

// ─── Metric shape descriptors ─────────────────────────────────────────────────

interface MetricShape {
  name: string;
  world: 'world1' | 'world2' | 'both';
  extract: (r: TickReport) => number | null | undefined;
}

/**
 * Compute the mean of meanTokenWeight across all languages in a perLanguage record.
 * Mirrors meanOverLanguages in metrics-dashboard.tsx.
 */
function meanOverLanguages(
  perLanguage: Record<Language, { meanTokenWeight: number }>,
): number {
  const vals = Object.values(perLanguage)
    .map((v) => v.meanTokenWeight)
    .filter((v) => !isNaN(v));
  if (vals.length === 0) return NaN;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

/**
 * Compute the mean of tokenWeightVariance across all languages in a perLanguage record.
 */
function varianceOverLanguages(
  perLanguage: Record<Language, { tokenWeightVariance: number }>,
): number {
  const vals = Object.values(perLanguage)
    .map((v) => v.tokenWeightVariance)
    .filter((v) => !isNaN(v));
  if (vals.length === 0) return NaN;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

const SCALAR_METRICS: ReadonlyArray<MetricShape> = [
  { name: 'success_rate', world: 'world1', extract: (r) => r.scalar.world1.successRate.rate },
  { name: 'success_rate', world: 'world2', extract: (r) => r.scalar.world2.successRate.rate },
  { name: 'success_rate', world: 'both', extract: (r) => r.scalar.overall.successRate.rate },
  {
    name: 'mean_token_weight',
    world: 'world1',
    extract: (r) => meanOverLanguages(r.scalar.world1.perLanguage),
  },
  {
    name: 'mean_token_weight',
    world: 'world2',
    extract: (r) => meanOverLanguages(r.scalar.world2.perLanguage),
  },
  {
    name: 'token_weight_variance',
    world: 'world1',
    extract: (r) => varianceOverLanguages(r.scalar.world1.perLanguage),
  },
  {
    name: 'token_weight_variance',
    world: 'world2',
    extract: (r) => varianceOverLanguages(r.scalar.world2.perLanguage),
  },
  {
    name: 'distinct_active_tokens',
    world: 'world1',
    extract: (r) => r.scalar.world1.distinctActiveTokens,
  },
  {
    name: 'distinct_active_tokens',
    world: 'world2',
    extract: (r) => r.scalar.world2.distinctActiveTokens,
  },
  { name: 'matching_rate', world: 'world1', extract: (r) => r.scalar.world1.matchingRate },
  { name: 'matching_rate', world: 'world2', extract: (r) => r.scalar.world2.matchingRate },
];

const GRAPH_METRICS: ReadonlyArray<MetricShape> = [
  {
    name: 'largest_cluster_size',
    world: 'world1',
    extract: (r) => r.graph.world1.largestClusterSize,
  },
  {
    name: 'largest_cluster_size',
    world: 'world2',
    extract: (r) => r.graph.world2.largestClusterSize,
  },
  { name: 'cluster_count', world: 'world1', extract: (r) => r.graph.world1.clusterCount },
  { name: 'cluster_count', world: 'world2', extract: (r) => r.graph.world2.clusterCount },
  {
    name: 'interaction_modularity',
    world: 'both',
    extract: (r) => r.graph.interactionGraphModularity,
  },
  { name: 'assimilation_index', world: 'both', extract: (r) => r.graph.assimilationIndex },
  { name: 'segregation_index', world: 'world2', extract: (r) => r.graph.segregationIndex },
];

const ALL_METRICS: ReadonlyArray<MetricShape> = [...SCALAR_METRICS, ...GRAPH_METRICS];

// ─── Forward transform: TickReport[] → metric rows ────────────────────────────

export interface MetricRow {
  runId: string;
  tick: number;
  world: 'world1' | 'world2' | 'both';
  metricName: string;
  metricValue: number;
}

/**
 * Serialize a TickReport[] time series into long-format metric rows for tick_metrics insert.
 * Skips null, NaN, and Infinity values — those produce no row.
 */
export function serializeTickReportsToMetricRows(
  runId: string,
  timeSeries: TickReport[],
): MetricRow[] {
  const rows: MetricRow[] = [];
  for (const report of timeSeries) {
    for (const shape of ALL_METRICS) {
      let value: number | null | undefined;
      try {
        value = shape.extract(report);
      } catch {
        continue;
      }
      if (value === null || value === undefined) continue;
      if (!Number.isFinite(value)) continue; // skip NaN and Infinity
      rows.push({
        runId,
        tick: report.tick,
        world: shape.world,
        metricName: shape.name,
        metricValue: value,
      });
    }
  }
  return rows;
}

// ─── Inverse transform: metric rows → TickReport[] ───────────────────────────

type World = 'world1' | 'world2';

// Mutable versions of the readonly types for construction during materialization.
// These are cast to the readonly TickReport shape at the end.
interface MutablePerWorldScalar {
  successRate: { successful: number; total: number; rate: number };
  successRateByClassPair: Record<string, { successful: number; total: number; rate: number }>;
  distinctActiveTokens: number;
  matchingRate: number;
  perLanguage: Record<string, { meanTokenWeight: number; tokenWeightVariance: number }>;
}

interface MutableTickReport {
  tick: number;
  scalar: {
    tick: number;
    world1: MutablePerWorldScalar;
    world2: MutablePerWorldScalar;
    overall: {
      successRate: { successful: number; total: number; rate: number };
      successRateByClassPair: Record<string, { successful: number; total: number; rate: number }>;
    };
  };
  graph: {
    tick: number;
    world1: { largestClusterSize: number; clusterCount: number };
    world2: { largestClusterSize: number; clusterCount: number };
    interactionGraphModularity: number;
    assimilationIndex: number | null;
    segregationIndex: number;
  };
}

function emptyPerWorldScalar(): MutablePerWorldScalar {
  return {
    successRate: { successful: 0, total: 0, rate: NaN },
    successRateByClassPair: {},
    distinctActiveTokens: 0,
    matchingRate: NaN,
    perLanguage: {},
  };
}

function emptyTickReport(tick: number): MutableTickReport {
  return {
    tick,
    scalar: {
      tick,
      world1: emptyPerWorldScalar(),
      world2: emptyPerWorldScalar(),
      overall: {
        successRate: { successful: 0, total: 0, rate: NaN },
        successRateByClassPair: {},
      },
    },
    graph: {
      tick,
      world1: { largestClusterSize: 0, clusterCount: 0 },
      world2: { largestClusterSize: 0, clusterCount: 0 },
      interactionGraphModularity: 0,
      assimilationIndex: null,
      segregationIndex: 0,
    },
  };
}

/**
 * Materialize long-format metric rows back into TickReport[].
 * Rows must be sorted by (tick ASC, world ASC, metricName ASC) — the order loadTickMetrics returns.
 */
export function materializeTickReports(
  rows: Array<{
    tick: number;
    world: 'world1' | 'world2' | 'both';
    metricName: string;
    metricValue: number;
  }>,
): TickReport[] {
  const byTick = new Map<number, MutableTickReport>();

  for (const row of rows) {
    let report = byTick.get(row.tick);
    if (!report) {
      report = emptyTickReport(row.tick);
      byTick.set(row.tick, report);
    }

    const { world, metricName, metricValue: v } = row;

    // Scalar metrics
    if (metricName === 'success_rate') {
      if (world === 'world1') report.scalar.world1.successRate.rate = v;
      else if (world === 'world2') report.scalar.world2.successRate.rate = v;
      else report.scalar.overall.successRate.rate = v;
    } else if (metricName === 'mean_token_weight') {
      const w = world as World;
      // Store as a synthetic perLanguage entry so meanOverLanguages reconstructs the value
      report.scalar[w].perLanguage['_aggregate'] = {
        meanTokenWeight: v,
        tokenWeightVariance: NaN,
      };
    } else if (metricName === 'token_weight_variance') {
      const w = world as World;
      const pl = report.scalar[w].perLanguage;
      if (pl['_aggregate']) {
        pl['_aggregate'].tokenWeightVariance = v;
      } else {
        pl['_aggregate'] = { meanTokenWeight: NaN, tokenWeightVariance: v };
      }
    } else if (metricName === 'distinct_active_tokens') {
      const w = world as World;
      report.scalar[w].distinctActiveTokens = v;
    } else if (metricName === 'matching_rate') {
      const w = world as World;
      report.scalar[w].matchingRate = v;
    }
    // Graph metrics
    else if (metricName === 'largest_cluster_size') {
      const w = world as World;
      report.graph[w].largestClusterSize = v;
    } else if (metricName === 'cluster_count') {
      const w = world as World;
      report.graph[w].clusterCount = v;
    } else if (metricName === 'interaction_modularity') {
      report.graph.interactionGraphModularity = v;
    } else if (metricName === 'assimilation_index') {
      report.graph.assimilationIndex = v;
    } else if (metricName === 'segregation_index') {
      report.graph.segregationIndex = v;
    }
  }

  // Sort by tick ascending and cast to readonly TickReport
  return Array.from(byTick.values()).sort((a, b) => a.tick - b.tick) as unknown as TickReport[];
}

// ─── Classification label formatter ──────────────────────────────────────────

/**
 * Map classification enum to a human-friendly label with Okabe-Ito color.
 */
export function formatClassificationLabel(
  classification: RunClassification | null,
): { label: string; color: string } {
  switch (classification) {
    case 'assimilated':
      return { label: 'Assimilated', color: '#009E73' };
    case 'segregated':
      return { label: 'Segregated', color: '#D55E00' };
    case 'mixed':
      return { label: 'Mixed', color: '#E69F00' };
    case 'inconclusive':
      return { label: 'Inconclusive', color: '#56B4E9' };
    default:
      return { label: 'Pending', color: '#9ca3af' };
  }
}

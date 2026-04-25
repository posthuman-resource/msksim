// Per-cell aggregation helpers for step 28's parameter sweep.
// Pure functions — no React, no DB, no server-only imports. Safe to import
// from Client Components.

import type { RunSummary } from '@/lib/sim/metrics/types';

/** Arithmetic mean. Returns NaN for empty input. */
export function mean(values: readonly number[]): number {
  if (values.length === 0) return NaN;
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
}

/**
 * Sample standard deviation (divisor n-1).
 * Returns NaN when fewer than 2 values are provided. The sample form matches
 * R's sd() default and is correct for a per-cell replicate sample.
 */
export function stdDev(values: readonly number[]): number {
  if (values.length < 2) return NaN;
  const m = mean(values);
  let sq = 0;
  for (const v of values) {
    const d = v - m;
    sq += d * d;
  }
  return Math.sqrt(sq / (values.length - 1));
}

/**
 * Most-frequent string label, with ties broken by first-occurrence order.
 * Returns null for empty input.
 */
export function dominantLabel(values: readonly string[]): string | null {
  if (values.length === 0) return null;
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best = values[0];
  let bestCount = counts.get(best) ?? 0;
  for (const v of values) {
    const c = counts.get(v) ?? 0;
    if (c > bestCount) {
      best = v;
      bestCount = c;
    }
  }
  return best;
}

/**
 * Walk a dot-separated path into an object. Returns undefined if any segment
 * is missing. Pure read-only utility — does not mutate the input.
 */
export function getByPath(obj: unknown, path: string): unknown {
  if (path === '') return obj;
  const parts = path.split('.');
  let cur: unknown = obj;
  for (const part of parts) {
    if (cur === null || cur === undefined || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

/**
 * Mutating sibling of getByPath. Sets the value at the given dot-path.
 * Intermediate objects must already exist — this helper does not create
 * intermediate keys. Used by sweep-runner to apply parameter overrides
 * onto a structuredClone of the base config.
 */
export function setByPath(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split('.');
  let cur: Record<string, unknown> = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const next = cur[parts[i]];
    if (next === null || next === undefined || typeof next !== 'object') {
      throw new Error(
        `setByPath: intermediate path "${parts.slice(0, i + 1).join('.')}" is not an object`,
      );
    }
    cur = next as Record<string, unknown>;
  }
  cur[parts[parts.length - 1]] = value;
}

export interface CellAggregate {
  /** Arithmetic mean of the metric across replicates. NaN if no replicates. */
  mean: number;
  /** Sample standard deviation of the metric. NaN if n < 2. */
  stdDev: number;
  /** Number of replicates contributing to the aggregate. */
  n: number;
  /** Dominant RunSummary.classification value across replicates. */
  classification: string | null;
}

/**
 * Encoded selector for a scalar value on a RunSummary. We can't use a generic
 * dot-path here because RunSummary's mean/median/max buckets are flat records
 * keyed by names that themselves contain dots (e.g. 'graph.assimilation').
 *
 * Encoding: `<bucket>:<innerKey>` where bucket is 'mean' | 'median' | 'max',
 * or the literal special tokens 'timeToConsensus' / 'classificationOrdinal'.
 */
export type MetricSelector = string;

/**
 * Resolve a MetricSelector against a RunSummary. Returns undefined when the
 * key is absent from the bucket; returns the numeric value otherwise.
 */
export function resolveMetric(summary: RunSummary, selector: MetricSelector): number | undefined {
  if (selector === 'timeToConsensus') {
    return summary.timeToConsensus ?? undefined;
  }
  const colon = selector.indexOf(':');
  if (colon === -1) return undefined;
  const bucket = selector.slice(0, colon);
  const key = selector.slice(colon + 1);
  let record: Readonly<Record<string, number>>;
  if (bucket === 'mean') record = summary.meanMetrics;
  else if (bucket === 'median') record = summary.medianMetrics;
  else if (bucket === 'max') record = summary.maxMetrics;
  else return undefined;
  const value = record[key];
  return typeof value === 'number' ? value : undefined;
}

/**
 * Aggregate a single cell's replicates into mean/stdDev/n/classification.
 * Replicates whose metric value is non-finite (NaN, ±Infinity) are skipped
 * for the numeric stats but still contribute their classification label.
 */
export function aggregateCell(
  replicates: readonly RunSummary[],
  selector: MetricSelector,
): CellAggregate {
  const values: number[] = [];
  const labels: string[] = [];
  for (const r of replicates) {
    const v = resolveMetric(r, selector);
    if (typeof v === 'number' && Number.isFinite(v)) values.push(v);
    labels.push(r.classification);
  }
  return {
    mean: mean(values),
    stdDev: stdDev(values),
    n: values.length,
    classification: dominantLabel(labels),
  };
}

/**
 * Aggregate every cell of a sweep against the given metric.
 * The input map's keys are opaque cell identifiers; the output map preserves them.
 */
export function aggregateSweep(
  cells: ReadonlyMap<string, readonly RunSummary[]>,
  selector: MetricSelector,
): Map<string, CellAggregate> {
  const out = new Map<string, CellAggregate>();
  for (const [key, replicates] of cells) {
    out.set(key, aggregateCell(replicates, selector));
  }
  return out;
}

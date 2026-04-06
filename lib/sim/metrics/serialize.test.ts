import { describe, it, expect } from 'vitest';

import {
  serializeTickReportsToMetricRows,
  materializeTickReports,
  formatClassificationLabel,
} from './serialize';
import type { TickReport } from '@/workers/simulation.worker';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeReport(tick: number, overrides?: Partial<{ assimilation: number | null }>): TickReport {
  const rate = 0.5 + tick * 0.01;
  return {
    tick,
    scalar: {
      tick,
      world1: {
        successRate: { successful: 50, total: 100, rate },
        successRateByClassPair: {} as never,
        distinctActiveTokens: 10 + tick,
        matchingRate: 0.3 + tick * 0.01,
        perLanguage: {
          L1: { meanTokenWeight: 0.6 + tick * 0.01, tokenWeightVariance: 0.1 },
        } as never,
      },
      world2: {
        successRate: { successful: 40, total: 100, rate: rate - 0.1 },
        successRateByClassPair: {} as never,
        distinctActiveTokens: 8 + tick,
        matchingRate: 0.2 + tick * 0.01,
        perLanguage: {
          L2: { meanTokenWeight: 0.5 + tick * 0.01, tokenWeightVariance: 0.2 },
        } as never,
      },
      overall: {
        successRate: { successful: 90, total: 200, rate: rate - 0.05 },
        successRateByClassPair: {} as never,
      },
    },
    graph: {
      tick,
      world1: { largestClusterSize: 5 + tick, clusterCount: 3 },
      world2: { largestClusterSize: 4 + tick, clusterCount: 2 },
      interactionGraphModularity: 0.4 + tick * 0.01,
      assimilationIndex: overrides?.assimilation !== undefined ? overrides.assimilation : 0.7,
      segregationIndex: 0.3 + tick * 0.01,
    },
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('serializeTickReportsToMetricRows + materializeTickReports round-trip', () => {
  it('preserves the time series through serialize → materialize', () => {
    const reports = [makeReport(0), makeReport(1), makeReport(2), makeReport(3), makeReport(4)];
    const rows = serializeTickReportsToMetricRows('test-run-id', reports);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.runId === 'test-run-id')).toBe(true);

    const materialized = materializeTickReports(rows);
    expect(materialized.length).toBe(5);

    for (let i = 0; i < reports.length; i++) {
      const orig = reports[i];
      const mat = materialized[i];
      expect(mat.tick).toBe(orig.tick);

      // Scalar: success rates
      expect(mat.scalar.world1.successRate.rate).toBeCloseTo(orig.scalar.world1.successRate.rate);
      expect(mat.scalar.world2.successRate.rate).toBeCloseTo(orig.scalar.world2.successRate.rate);
      expect(mat.scalar.overall.successRate.rate).toBeCloseTo(orig.scalar.overall.successRate.rate);

      // Scalar: distinct tokens
      expect(mat.scalar.world1.distinctActiveTokens).toBe(orig.scalar.world1.distinctActiveTokens);
      expect(mat.scalar.world2.distinctActiveTokens).toBe(orig.scalar.world2.distinctActiveTokens);

      // Scalar: matching rate
      expect(mat.scalar.world1.matchingRate).toBeCloseTo(orig.scalar.world1.matchingRate);
      expect(mat.scalar.world2.matchingRate).toBeCloseTo(orig.scalar.world2.matchingRate);

      // Graph metrics
      expect(mat.graph.world1.largestClusterSize).toBe(orig.graph.world1.largestClusterSize);
      expect(mat.graph.world2.largestClusterSize).toBe(orig.graph.world2.largestClusterSize);
      expect(mat.graph.world1.clusterCount).toBe(orig.graph.world1.clusterCount);
      expect(mat.graph.world2.clusterCount).toBe(orig.graph.world2.clusterCount);
      expect(mat.graph.interactionGraphModularity).toBeCloseTo(
        orig.graph.interactionGraphModularity,
      );
      expect(mat.graph.assimilationIndex).toBeCloseTo(orig.graph.assimilationIndex!);
      expect(mat.graph.segregationIndex).toBeCloseTo(orig.graph.segregationIndex);
    }
  });
});

describe('serializeTickReportsToMetricRows skips invalid values', () => {
  it('skips null, NaN, and Infinity metric values', () => {
    const reports: TickReport[] = [
      // assimilationIndex = null
      makeReport(0, { assimilation: null }),
      // Normal report for tick 1
      makeReport(1),
    ];

    // Override: force a NaN success rate on tick 0
    (reports[0].scalar.world1.successRate as { rate: number }).rate = NaN;
    // Override: force Infinity matching rate on tick 0
    (reports[0].scalar.world1 as { matchingRate: number }).matchingRate = Infinity;

    const rows = serializeTickReportsToMetricRows('run-id', reports);

    // No rows for NaN success_rate world1 at tick 0
    const nanRows = rows.filter(
      (r) => r.tick === 0 && r.metricName === 'success_rate' && r.world === 'world1',
    );
    expect(nanRows.length).toBe(0);

    // No rows for Infinity matching_rate world1 at tick 0
    const infRows = rows.filter(
      (r) => r.tick === 0 && r.metricName === 'matching_rate' && r.world === 'world1',
    );
    expect(infRows.length).toBe(0);

    // No rows for null assimilation_index at tick 0
    const nullRows = rows.filter(
      (r) => r.tick === 0 && r.metricName === 'assimilation_index',
    );
    expect(nullRows.length).toBe(0);

    // Other metrics at tick 0 are still present
    const tick0Rows = rows.filter((r) => r.tick === 0);
    expect(tick0Rows.length).toBeGreaterThan(0);

    // Tick 1 has all metrics including assimilation_index
    const tick1Assimilation = rows.filter(
      (r) => r.tick === 1 && r.metricName === 'assimilation_index',
    );
    expect(tick1Assimilation.length).toBe(1);
  });
});

describe('formatClassificationLabel', () => {
  it('returns the expected label and color for every enum value', () => {
    expect(formatClassificationLabel('assimilated')).toEqual({
      label: 'Assimilated',
      color: '#009E73',
    });
    expect(formatClassificationLabel('segregated')).toEqual({
      label: 'Segregated',
      color: '#D55E00',
    });
    expect(formatClassificationLabel('mixed')).toEqual({
      label: 'Mixed',
      color: '#E69F00',
    });
    expect(formatClassificationLabel('inconclusive')).toEqual({
      label: 'Inconclusive',
      color: '#56B4E9',
    });
    expect(formatClassificationLabel(null)).toEqual({
      label: 'Pending',
      color: '#9ca3af',
    });
  });
});

describe('serializeTickReportsToMetricRows produces unique keys', () => {
  it('no duplicate (tick, world, metricName) keys exist', () => {
    const reports = [makeReport(0), makeReport(1), makeReport(2)];
    const rows = serializeTickReportsToMetricRows('run-id', reports);

    const keys = new Set<string>();
    for (const r of rows) {
      keys.add(`${r.tick}-${r.world}-${r.metricName}`);
    }
    expect(keys.size).toBe(rows.length);
  });
});

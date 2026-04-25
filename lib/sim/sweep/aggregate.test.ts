import { describe, it, expect } from 'vitest';

import {
  mean,
  stdDev,
  dominantLabel,
  getByPath,
  setByPath,
  aggregateCell,
  aggregateSweep,
  resolveMetric,
  type CellAggregate,
} from './aggregate';
import type { RunSummary } from '@/lib/sim/metrics/types';

function mockSummary(
  meanAssimilation: number,
  classification: RunSummary['classification'],
): RunSummary {
  return {
    meanMetrics: { 'graph.assimilation': meanAssimilation },
    medianMetrics: { 'graph.assimilation': meanAssimilation },
    maxMetrics: { 'graph.assimilation': meanAssimilation },
    convergenceStatus: 'unresolved',
    timeToConsensus: null,
    classification,
  };
}

describe('mean', () => {
  it('returns NaN for empty input', () => {
    expect(Number.isNaN(mean([]))).toBe(true);
  });
  it('returns the value for a singleton', () => {
    expect(mean([42])).toBe(42);
  });
  it('returns the arithmetic mean for [1..5]', () => {
    expect(mean([1, 2, 3, 4, 5])).toBe(3);
  });
  it('handles floats accurately', () => {
    expect(mean([0.1, 0.2, 0.3])).toBeCloseTo(0.2, 10);
  });
});

describe('stdDev', () => {
  it('returns NaN for empty input', () => {
    expect(Number.isNaN(stdDev([]))).toBe(true);
  });
  it('returns NaN for n < 2', () => {
    expect(Number.isNaN(stdDev([42]))).toBe(true);
  });
  it('returns 0 for constant values', () => {
    expect(stdDev([5, 5, 5])).toBe(0);
  });
  it('returns sqrt(2.5) for [1..5]', () => {
    expect(stdDev([1, 2, 3, 4, 5])).toBeCloseTo(Math.sqrt(2.5), 10);
  });
});

describe('dominantLabel', () => {
  it('returns null for empty input', () => {
    expect(dominantLabel([])).toBeNull();
  });
  it('returns the only value for a singleton', () => {
    expect(dominantLabel(['x'])).toBe('x');
  });
  it('returns the strict majority winner', () => {
    expect(dominantLabel(['a', 'b', 'a', 'c', 'a'])).toBe('a');
  });
  it('breaks ties by first occurrence', () => {
    expect(dominantLabel(['a', 'b', 'a', 'b'])).toBe('a');
    expect(dominantLabel(['b', 'a', 'b', 'a'])).toBe('b');
  });
});

describe('getByPath', () => {
  it('returns the object itself for empty path', () => {
    const obj = { a: 1 };
    expect(getByPath(obj, '')).toBe(obj);
  });
  it('reads top-level keys', () => {
    expect(getByPath({ a: 1 }, 'a')).toBe(1);
  });
  it('reads nested keys two levels deep', () => {
    expect(getByPath({ a: { b: 42 } }, 'a.b')).toBe(42);
  });
  it('reads nested keys three levels deep', () => {
    expect(getByPath({ a: { b: { c: 'x' } } }, 'a.b.c')).toBe('x');
  });
  it('returns undefined for missing keys', () => {
    expect(getByPath({ a: { b: 42 } }, 'a.c')).toBeUndefined();
    expect(getByPath({ a: { b: 42 } }, 'x.y')).toBeUndefined();
  });
});

describe('setByPath', () => {
  it('sets a top-level key', () => {
    const obj: Record<string, unknown> = { a: 1 };
    setByPath(obj, 'a', 2);
    expect(obj.a).toBe(2);
  });
  it('sets a nested key', () => {
    const obj = { a: { b: 1 } };
    setByPath(obj as unknown as Record<string, unknown>, 'a.b', 99);
    expect(obj.a.b).toBe(99);
  });
  it('throws if the intermediate path is not an object', () => {
    expect(() => setByPath({ a: 1 } as unknown as Record<string, unknown>, 'a.b', 2)).toThrow();
  });
});

describe('resolveMetric', () => {
  it('reads the mean bucket via the mean: prefix', () => {
    expect(resolveMetric(mockSummary(0.42, 'mixed'), 'mean:graph.assimilation')).toBe(0.42);
  });
  it('reads timeToConsensus by literal key', () => {
    const s: RunSummary = { ...mockSummary(0.1, 'mixed'), timeToConsensus: 17 };
    expect(resolveMetric(s, 'timeToConsensus')).toBe(17);
  });
  it('returns undefined for an unknown bucket', () => {
    expect(resolveMetric(mockSummary(0.1, 'mixed'), 'foo:bar')).toBeUndefined();
  });
  it('returns undefined for a missing key in a known bucket', () => {
    expect(resolveMetric(mockSummary(0.1, 'mixed'), 'mean:nonexistent')).toBeUndefined();
  });
});

describe('aggregateCell', () => {
  it('aggregates the mean, stdDev, n, and dominant classification', () => {
    const replicates: RunSummary[] = [
      mockSummary(0.2, 'segregated'),
      mockSummary(0.4, 'mixed'),
      mockSummary(0.6, 'segregated'),
    ];
    const result = aggregateCell(replicates, 'mean:graph.assimilation');
    expect(result.mean).toBeCloseTo(0.4, 10);
    expect(result.stdDev).toBeCloseTo(0.2, 10);
    expect(result.n).toBe(3);
    expect(result.classification).toBe('segregated');
  });
  it('skips non-finite metric values for numeric stats', () => {
    const replicates: RunSummary[] = [
      mockSummary(NaN, 'inconclusive'),
      mockSummary(0.5, 'mixed'),
      mockSummary(0.7, 'mixed'),
    ];
    const result = aggregateCell(replicates, 'mean:graph.assimilation');
    expect(result.n).toBe(2);
    expect(result.mean).toBeCloseTo(0.6, 10);
    expect(result.classification).toBe('mixed');
  });
  it('returns NaN mean and null classification for empty replicates', () => {
    const result = aggregateCell([], 'mean:graph.assimilation');
    expect(Number.isNaN(result.mean)).toBe(true);
    expect(result.n).toBe(0);
    expect(result.classification).toBeNull();
  });
});

describe('aggregateSweep', () => {
  it('aggregates every cell into a parallel map', () => {
    const cells = new Map<string, RunSummary[]>([
      ['cell-a', [mockSummary(0.1, 'mixed'), mockSummary(0.3, 'mixed')]],
      ['cell-b', [mockSummary(0.7, 'assimilated'), mockSummary(0.9, 'assimilated')]],
    ]);
    const out: Map<string, CellAggregate> = aggregateSweep(cells, 'mean:graph.assimilation');
    expect(out.size).toBe(2);
    expect(out.get('cell-a')?.mean).toBeCloseTo(0.2, 10);
    expect(out.get('cell-b')?.mean).toBeCloseTo(0.8, 10);
    expect(out.get('cell-b')?.classification).toBe('assimilated');
  });
});

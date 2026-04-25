// Vitest suite for lib/sim/metrics/summary.ts
// Default node environment (no DOM). All tests are pure, deterministic, no I/O.
// Per CLAUDE.md "Testing conventions" (step 00) — colocated, no async, no Math.random.

import { describe, it, expect } from 'vitest';
import { computeRunSummary, computeTimeToConsensus, classifyRun } from './summary';
import { ExperimentConfig } from '@/lib/schema/experiment';
import type { ScalarMetricsSnapshot, GraphMetricsSnapshot } from './types';
import type { Language } from '@/lib/schema/primitives';

// ─── Fixture helpers ──────────────────────────────────────────────────────────

/**
 * Build a minimal ScalarMetricsSnapshot with controlled field values.
 * All fields not explicitly supplied default to neutral values (0 or 1)
 * that do not trigger divergence detection or distort aggregate metrics.
 */
function makeScalarSnapshot(opts: {
  nw?: number;
  nw2?: number;
  successRate?: number;
  matchingRate?: number;
  meanTokenWeight?: number;
  tokenWeightVariance?: number;
}): ScalarMetricsSnapshot {
  const {
    nw = 1,
    nw2 = 1,
    successRate = 1.0,
    matchingRate = 1.0,
    meanTokenWeight = 1.0,
    tokenWeightVariance = 0,
  } = opts;

  const perLanguage = {
    L1: { meanTokenWeight, tokenWeightVariance },
  } as Record<Language, { readonly meanTokenWeight: number; readonly tokenWeightVariance: number }>;

  const makeRate = (rate: number) => ({
    successful: 0,
    total: 0,
    rate,
  });

  // SuccessRateByClassPair is not exercised by summary metrics; use empty cast.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const emptyByClass = {} as any;

  const makeWorld = (nwVal: number): ScalarMetricsSnapshot['world1'] => ({
    successRate: makeRate(successRate),
    successRateByClassPair: emptyByClass,
    distinctActiveTokens: nwVal,
    matchingRate,
    spatialHomophily: NaN,
    perLanguage,
  });

  return {
    tick: null,
    world1: makeWorld(nw),
    world2: makeWorld(nw2),
    overall: {
      successRate: makeRate(successRate),
      successRateByClassPair: emptyByClass,
    },
  };
}

/** Build a minimal GraphMetricsSnapshot with controlled assimilation/segregation values. */
function makeGraphSnapshot(opts: {
  tick?: number;
  assimilationIndex?: number | null;
  segregationIndex?: number;
}): GraphMetricsSnapshot {
  const { tick = 1, assimilationIndex = null, segregationIndex = 0 } = opts;
  return {
    tick,
    world1: { largestClusterSize: 0, clusterCount: 0 },
    world2: { largestClusterSize: 0, clusterCount: 0 },
    interactionGraphModularity: 0,
    assimilationIndex,
    segregationIndex,
  };
}

/** Default thresholds matching the spec §7.3 values (α=0.7, β=0.3, γ=0.3, δ=0.7). */
const defaultThresholds = {
  assimilationHigh: 0.7,
  segregationLow: 0.3,
  assimilationLow: 0.3,
  segregationHigh: 0.7,
};

/** Parse an ExperimentConfig using schema defaults. */
const defaultConfig = ExperimentConfig.parse({});

// ─── Test 1: mean/median/max on constant series ───────────────────────────────

describe('computeRunSummary — mean/median/max on constant series', () => {
  it('constant successRate = 0.75 over 200 ticks returns 0.75 for all three aggregates', () => {
    const scalar = Array.from({ length: 200 }, () => makeScalarSnapshot({ successRate: 0.75 }));
    const result = computeRunSummary(scalar, [], defaultConfig);
    expect(result.meanMetrics['world1.successRate']).toBeCloseTo(0.75, 10);
    expect(result.medianMetrics['world1.successRate']).toBeCloseTo(0.75, 10);
    expect(result.maxMetrics['world1.successRate']).toBeCloseTo(0.75, 10);
  });
});

// ─── Test 2: known 5-element series ──────────────────────────────────────────

describe('computeRunSummary — known 5-element series', () => {
  it('successRate [0.1, 0.2, 0.3, 0.4, 0.5] → mean=0.3, median=0.3, max=0.5', () => {
    const rates = [0.1, 0.2, 0.3, 0.4, 0.5];
    const scalar = rates.map((r) => makeScalarSnapshot({ successRate: r }));
    const result = computeRunSummary(scalar, [], defaultConfig);
    expect(result.meanMetrics['world1.successRate']).toBeCloseTo(0.3, 10);
    expect(result.medianMetrics['world1.successRate']).toBeCloseTo(0.3, 10);
    expect(result.maxMetrics['world1.successRate']).toBeCloseTo(0.5, 10);
  });
});

// ─── Test 3: time-to-consensus detection ─────────────────────────────────────

describe('computeTimeToConsensus — stabilization at tick 50', () => {
  it('Nw=4 for ticks 0..49 then Nw=1 for ticks 50..199, window=100 → timeToConsensus=50', () => {
    // 200-element series: first 50 are 4, next 150 are 1.
    const nwSeries = [
      ...Array.from({ length: 50 }, () => 4),
      ...Array.from({ length: 150 }, () => 1),
    ];
    expect(computeTimeToConsensus(nwSeries, 100)).toBe(50);
  });

  it('end-to-end via computeRunSummary', () => {
    const scalar = [
      ...Array.from({ length: 50 }, () => makeScalarSnapshot({ nw: 4, nw2: 4 })),
      ...Array.from({ length: 150 }, () => makeScalarSnapshot({ nw: 1, nw2: 1 })),
    ];
    const config = ExperimentConfig.parse({ convergence: { consensusWindowTicks: 100 } });
    const result = computeRunSummary(scalar, [], config);
    expect(result.timeToConsensus).toBe(50);
  });
});

// ─── Test 4: time-to-consensus null when Nw oscillates ───────────────────────

describe('computeTimeToConsensus — null when Nw never stabilizes', () => {
  it('oscillating Nw [4,3,2,1,2,3,4,...] over 200 ticks → null', () => {
    // Repeating cycle of [4,3,2,1] for 200 ticks — never stays at the final value
    const pattern = [4, 3, 2, 1];
    const nwSeries = Array.from({ length: 200 }, (_, i) => pattern[i % pattern.length]);
    // The asymptote is the last element; last index 199, pattern[199 % 4] = pattern[3] = 1
    // But the series oscillates so it never has 100 consecutive 1s.
    const result = computeTimeToConsensus(nwSeries, 100);
    expect(result).toBeNull();
  });

  it('end-to-end: oscillating Nw → timeToConsensus null', () => {
    const pattern = [4, 3, 2, 1];
    const scalar = Array.from({ length: 200 }, (_, i) =>
      makeScalarSnapshot({ nw: pattern[i % pattern.length], nw2: pattern[i % pattern.length] }),
    );
    const result = computeRunSummary(scalar, [], defaultConfig);
    expect(result.timeToConsensus).toBeNull();
  });
});

// ─── Test 5: convergence status — Nw=1 throughout → 'converged' ──────────────

describe("convergence status — constant Nw=1 → 'converged'", () => {
  it('all ticks have Nw=1, window=100 → timeToConsensus=0, convergenceStatus=converged', () => {
    const scalar = Array.from({ length: 200 }, () => makeScalarSnapshot({ nw: 1, nw2: 1 }));
    const config = ExperimentConfig.parse({ convergence: { consensusWindowTicks: 100 } });
    const result = computeRunSummary(scalar, [], config);
    expect(result.timeToConsensus).toBe(0);
    expect(result.convergenceStatus).toBe('converged');
  });
});

// ─── Test 6: convergence status — Nw=3 throughout → 'metastable' ─────────────

describe("convergence status — constant Nw=3 → 'metastable'", () => {
  it('all ticks have Nw=3, window=100 → timeToConsensus=0, convergenceStatus=metastable', () => {
    const scalar = Array.from({ length: 200 }, () => makeScalarSnapshot({ nw: 3, nw2: 3 }));
    const config = ExperimentConfig.parse({ convergence: { consensusWindowTicks: 100 } });
    const result = computeRunSummary(scalar, [], config);
    expect(result.timeToConsensus).toBe(0);
    expect(result.convergenceStatus).toBe('metastable');
  });
});

// ─── Test 7: NaN skip in mean/median/max ─────────────────────────────────────

describe('mean/median/max — NaN skip policy', () => {
  it('matchingRate [0.8, NaN, 0.6, NaN, 0.4] → mean=0.6, median=0.6, max=0.8', () => {
    const rates = [0.8, NaN, 0.6, NaN, 0.4];
    const scalar = rates.map((r) => makeScalarSnapshot({ matchingRate: r }));
    const result = computeRunSummary(scalar, [], defaultConfig);
    expect(result.meanMetrics['world1.matchingRate']).toBeCloseTo(0.6, 10);
    expect(result.medianMetrics['world1.matchingRate']).toBeCloseTo(0.6, 10);
    expect(result.maxMetrics['world1.matchingRate']).toBeCloseTo(0.8, 10);
  });

  it('all-NaN series → aggregated field is NaN (does not throw)', () => {
    const scalar = [NaN, NaN, NaN].map((r) => makeScalarSnapshot({ matchingRate: r }));
    const result = computeRunSummary(scalar, [], defaultConfig);
    expect(Number.isNaN(result.meanMetrics['world1.matchingRate'])).toBe(true);
    expect(Number.isNaN(result.medianMetrics['world1.matchingRate'])).toBe(true);
    expect(Number.isNaN(result.maxMetrics['world1.matchingRate'])).toBe(true);
  });
});

// ─── Test 8: classification — assimilated ────────────────────────────────────

describe("classifyRun — 'assimilated'", () => {
  it('finalAssimilation=0.9, finalSegregation=0.1 → assimilated', () => {
    expect(classifyRun(0.9, 0.1, defaultThresholds)).toBe('assimilated');
  });

  it('end-to-end via computeRunSummary', () => {
    const scalar = Array.from({ length: 10 }, () => makeScalarSnapshot({}));
    const graphs = [
      ...Array.from({ length: 9 }, (_, i) => makeGraphSnapshot({ tick: i })),
      makeGraphSnapshot({ tick: 9, assimilationIndex: 0.9, segregationIndex: 0.1 }),
    ];
    const result = computeRunSummary(scalar, graphs, defaultConfig);
    expect(result.classification).toBe('assimilated');
  });
});

// ─── Test 9: classification — segregated ─────────────────────────────────────

describe("classifyRun — 'segregated'", () => {
  it('finalAssimilation=0.15, finalSegregation=0.85 → segregated', () => {
    expect(classifyRun(0.15, 0.85, defaultThresholds)).toBe('segregated');
  });

  it('end-to-end via computeRunSummary', () => {
    const scalar = Array.from({ length: 10 }, () => makeScalarSnapshot({}));
    const graphs = [
      makeGraphSnapshot({ tick: 9, assimilationIndex: 0.15, segregationIndex: 0.85 }),
    ];
    const result = computeRunSummary(scalar, graphs, defaultConfig);
    expect(result.classification).toBe('segregated');
  });
});

// ─── Test 10: classification — mixed ─────────────────────────────────────────

describe("classifyRun — 'mixed' (middling values)", () => {
  it('finalAssimilation=0.5, finalSegregation=0.5 → mixed', () => {
    expect(classifyRun(0.5, 0.5, defaultThresholds)).toBe('mixed');
  });

  it('end-to-end via computeRunSummary', () => {
    const scalar = Array.from({ length: 10 }, () => makeScalarSnapshot({}));
    const graphs = [makeGraphSnapshot({ tick: 9, assimilationIndex: 0.5, segregationIndex: 0.5 })];
    const result = computeRunSummary(scalar, graphs, defaultConfig);
    expect(result.classification).toBe('mixed');
  });
});

// ─── Test 11: classification — inconclusive ───────────────────────────────────

describe("classifyRun — 'inconclusive' when assimilation is null/NaN", () => {
  it('NaN assimilation → inconclusive', () => {
    expect(classifyRun(NaN, 0.5, defaultThresholds)).toBe('inconclusive');
  });

  it('NaN segregation → inconclusive', () => {
    expect(classifyRun(0.5, NaN, defaultThresholds)).toBe('inconclusive');
  });

  it('end-to-end: null assimilationIndex in last graph snapshot → inconclusive', () => {
    const scalar = Array.from({ length: 10 }, () => makeScalarSnapshot({}));
    // assimilationIndex is null (no qualifying interactions this tick)
    const graphs = [makeGraphSnapshot({ tick: 9, assimilationIndex: null, segregationIndex: 0.2 })];
    const result = computeRunSummary(scalar, graphs, defaultConfig);
    expect(result.classification).toBe('inconclusive');
  });

  it('empty graphTimeSeries → inconclusive', () => {
    const scalar = Array.from({ length: 10 }, () => makeScalarSnapshot({}));
    const result = computeRunSummary(scalar, [], defaultConfig);
    expect(result.classification).toBe('inconclusive');
  });
});

// ─── Test 12: divergence detection ───────────────────────────────────────────

describe("divergence detection — 'diverged' convergence status", () => {
  it('Infinity meanTokenWeight in any tick → convergenceStatus=diverged', () => {
    const scalar = [
      makeScalarSnapshot({ meanTokenWeight: 1.0 }),
      makeScalarSnapshot({ meanTokenWeight: Infinity }),
      makeScalarSnapshot({ meanTokenWeight: 1.0 }),
    ];
    const result = computeRunSummary(scalar, [], defaultConfig);
    expect(result.convergenceStatus).toBe('diverged');
  });

  it('weight exceeding 1e15 → convergenceStatus=diverged', () => {
    const scalar = [makeScalarSnapshot({ meanTokenWeight: 1e16 })];
    const result = computeRunSummary(scalar, [], defaultConfig);
    expect(result.convergenceStatus).toBe('diverged');
  });

  it('diverged is reported even when Nw would imply converged (diverged checked first)', () => {
    // All Nw=1 (looks converged) but a weight blew up → must return 'diverged'
    const scalar = Array.from({ length: 200 }, (_, i) =>
      makeScalarSnapshot({ nw: 1, nw2: 1, meanTokenWeight: i === 50 ? Infinity : 1.0 }),
    );
    const config = ExperimentConfig.parse({ convergence: { consensusWindowTicks: 100 } });
    const result = computeRunSummary(scalar, [], config);
    expect(result.convergenceStatus).toBe('diverged');
  });
});

// ─── Test 13: truncated run → 'unresolved' ───────────────────────────────────

describe("truncated run shorter than consensus window → 'unresolved'", () => {
  it('50 ticks with consensusWindowTicks=100 → timeToConsensus=null, unresolved', () => {
    const scalar = Array.from({ length: 50 }, () => makeScalarSnapshot({ nw: 1, nw2: 1 }));
    const config = ExperimentConfig.parse({ convergence: { consensusWindowTicks: 100 } });
    const result = computeRunSummary(scalar, [], config);
    expect(result.timeToConsensus).toBeNull();
    expect(result.convergenceStatus).toBe('unresolved');
  });
});

// ─── Test 14: JSON round-trip ─────────────────────────────────────────────────

describe('RunSummary is JSON-serializable (structuredClone-safe contract)', () => {
  it('JSON.stringify → JSON.parse preserves all fields with their values', () => {
    const scalar = [
      ...Array.from({ length: 50 }, () => makeScalarSnapshot({ nw: 4, nw2: 4, successRate: 0.8 })),
      ...Array.from({ length: 150 }, () => makeScalarSnapshot({ nw: 1, nw2: 1, successRate: 0.9 })),
    ];
    const graphs = [
      makeGraphSnapshot({ tick: 199, assimilationIndex: 0.9, segregationIndex: 0.1 }),
    ];
    const config = ExperimentConfig.parse({ convergence: { consensusWindowTicks: 100 } });
    const original = computeRunSummary(scalar, graphs, config);

    const roundTripped = JSON.parse(JSON.stringify(original)) as typeof original;

    expect(roundTripped.convergenceStatus).toBe(original.convergenceStatus);
    expect(roundTripped.timeToConsensus).toBe(original.timeToConsensus);
    expect(roundTripped.classification).toBe(original.classification);
    // Numeric fields survive JSON round-trip (no undefined, no NaN in this case)
    expect(roundTripped.meanMetrics['world1.successRate']).toBeCloseTo(
      original.meanMetrics['world1.successRate'],
      10,
    );
    expect(roundTripped.maxMetrics['world1.successRate']).toBeCloseTo(
      original.maxMetrics['world1.successRate'],
      10,
    );
  });

  it('null timeToConsensus survives JSON round-trip (null not dropped like undefined)', () => {
    const scalar = Array.from({ length: 50 }, () => makeScalarSnapshot({}));
    const config = ExperimentConfig.parse({ convergence: { consensusWindowTicks: 100 } });
    const result = computeRunSummary(scalar, [], config);
    const roundTripped = JSON.parse(JSON.stringify(result));
    // null is preserved (undefined would be dropped by JSON.stringify)
    expect('timeToConsensus' in roundTripped).toBe(true);
    expect(roundTripped.timeToConsensus).toBeNull();
  });
});

// ─── Test 15: ExperimentConfig.parse({}) schema integration ──────────────────

describe('ExperimentConfig.parse({}) integration — schema defaults resolve', () => {
  it('using schema defaults: classification is one of the four valid strings', () => {
    const config = ExperimentConfig.parse({});
    // Minimal series — classification will be 'inconclusive' (no graph data),
    // but the key assertion is that computeRunSummary does not throw and
    // returns a valid RunClassification.
    const result = computeRunSummary([], [], config);
    expect(['assimilated', 'segregated', 'mixed', 'inconclusive']).toContain(result.classification);
  });

  it('using schema defaults: empty series returns expected edge-case shape', () => {
    const config = ExperimentConfig.parse({});
    const result = computeRunSummary([], [], config);
    expect(result.meanMetrics).toEqual({});
    expect(result.medianMetrics).toEqual({});
    expect(result.maxMetrics).toEqual({});
    expect(result.timeToConsensus).toBeNull();
    expect(result.convergenceStatus).toBe('unresolved');
    expect(result.classification).toBe('inconclusive');
  });

  it('schema default thresholds accept assimilation=0.9/segregation=0.1 → assimilated', () => {
    const config = ExperimentConfig.parse({});
    // Verify threshold field names match what summary.ts reads
    expect(config.classificationThresholds.assimilationHigh).toBe(0.7);
    expect(config.classificationThresholds.segregationLow).toBe(0.3);
    expect(config.convergence.consensusWindowTicks).toBe(100);
    // End-to-end with schema defaults
    const scalar = Array.from({ length: 200 }, () => makeScalarSnapshot({ nw: 1, nw2: 1 }));
    const graphs = [
      makeGraphSnapshot({ tick: 199, assimilationIndex: 0.9, segregationIndex: 0.1 }),
    ];
    const result = computeRunSummary(scalar, graphs, config);
    expect(result.classification).toBe('assimilated');
    expect(result.convergenceStatus).toBe('converged');
  });
});

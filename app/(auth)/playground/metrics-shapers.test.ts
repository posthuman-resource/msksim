// Unit test for the spatial-homophily shaper (step 35).
// NaN values from non-spatial topologies must become null so Recharts renders gaps.

import { describe, it, expect } from 'vitest';
import type { TickReport } from './metrics-history';
import { spatialHomophilyShaper } from './metrics-shapers';

const makeReport = (tick: number, w1: number, w2: number): TickReport =>
  ({
    tick,
    scalar: {
      world1: { spatialHomophily: w1 },
      world2: { spatialHomophily: w2 },
    },
    graph: {} as never,
  }) as unknown as TickReport;

describe('spatialHomophilyShaper', () => {
  it('substitutes null for NaN values', () => {
    expect(spatialHomophilyShaper(makeReport(7, Number.NaN, 0.42))).toEqual({
      tick: 7,
      world1: null,
      world2: 0.42,
    });
    expect(spatialHomophilyShaper(makeReport(8, 0.31, Number.NaN))).toEqual({
      tick: 8,
      world1: 0.31,
      world2: null,
    });
  });

  it('passes finite values through unchanged', () => {
    expect(spatialHomophilyShaper(makeReport(99, 0.55, 0.61))).toEqual({
      tick: 99,
      world1: 0.55,
      world2: 0.61,
    });
  });

  it('handles both-NaN tick (e.g. well-mixed both worlds)', () => {
    expect(spatialHomophilyShaper(makeReport(0, Number.NaN, Number.NaN))).toEqual({
      tick: 0,
      world1: null,
      world2: null,
    });
  });
});

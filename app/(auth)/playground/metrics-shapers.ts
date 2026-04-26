// Pure shaper helpers used by metrics-dashboard.tsx.
// Kept in a non-'use client' module so they are importable from Vitest tests
// without dragging in Recharts or React.

import type { TickReport } from './metrics-history';

// NaN values from non-spatial topologies become null so Recharts renders
// chart gaps via connectNulls={false} rather than mapping NaN to a bogus 0.
export function spatialHomophilyShaper(r: TickReport): {
  tick: number;
  world1: number | null;
  world2: number | null;
} {
  return {
    tick: r.tick,
    world1: Number.isNaN(r.scalar.world1.spatialHomophily)
      ? null
      : r.scalar.world1.spatialHomophily,
    world2: Number.isNaN(r.scalar.world2.spatialHomophily)
      ? null
      : r.scalar.world2.spatialHomophily,
  };
}

// Topology-agnostic engine invariant: nothing under lib/sim/ other than
// lib/sim/topology/factory.ts may branch on topology.kind. The factory
// converts a TopologyConfig into a Topology once; engine code downstream
// (steps 13, 14, 16) must treat any Topology as interchangeable. Violating
// this breaks F4's "same config runs in all three topologies without code
// changes" acceptance criterion.

import type { RNG } from './rng';

export type TopologyKind = 'lattice' | 'well-mixed' | 'network';

export interface Topology {
  /** Discriminator: "lattice" | "well-mixed" | "network" */
  readonly kind: TopologyKind;

  /** Total number of agent positions in this topology. */
  readonly size: number;

  /**
   * Returns the positions structurally reachable from `position`.
   * Returns Iterable<number> so well-mixed can use a lazy generator
   * while lattice can return a plain array.
   * The rng argument is accepted for API symmetry; not all implementations use it.
   */
  neighbors(position: number, rng: RNG): Iterable<number>;

  /**
   * Uniformly pick one neighbor of `position`.
   * Returns null if the position has no neighbors (isolated node,
   * 1×1 lattice, size-1 well-mixed population, etc.).
   */
  pickNeighbor(position: number, rng: RNG): number | null;

  /**
   * Optional: emit every undirected edge as [source, target] pairs
   * with source < target. Used by step-16 graph-metrics code.
   */
  adjacency?(): Iterable<[number, number]>;

  /**
   * Optional spatial capability. Implementations that have a metric notion of
   * position (e.g. lattice) populate this; well-mixed and network leave it
   * undefined. Step 34's movement code gates on `spatial !== undefined` rather
   * than branching on `kind`, preserving the topology-agnostic-engine invariant.
   */
  readonly spatial?: SpatialOps;
}

/**
 * Per-topology spatial operations used by step 34's linguistic migration.
 *
 *   - distance:      Manhattan/lattice distance between two cells.
 *   - stepToward:    one in-bounds neighbor of `from` that decreases distance to
 *                    `target`; null if no improving move exists.
 *   - stepAwayFrom:  one in-bounds neighbor of `from` that increases distance to
 *                    `target`; null when every in-bounds neighbor is closer to
 *                    or equidistant to `target` (e.g. corner cells).
 *
 * All three are pure and consume no RNG. Tiebreaking is deterministic and
 * documented per implementation; movement.ts depends on this for bit-identical
 * behavior across runs.
 */
export interface SpatialOps {
  distance(a: number, b: number): number;
  stepToward(from: number, target: number): number | null;
  stepAwayFrom(from: number, target: number): number | null;
}

// Topology-agnostic engine invariant: nothing under lib/sim/ other than
// lib/sim/topology/factory.ts may branch on topology.kind. The factory
// converts a TopologyConfig into a Topology once; engine code downstream
// (steps 13, 14, 16) must treat any Topology as interchangeable. Violating
// this breaks F4's "same config runs in all three topologies without code
// changes" acceptance criterion.

import type { RNG } from "./rng";

export type TopologyKind = "lattice" | "well-mixed" | "network";

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
}

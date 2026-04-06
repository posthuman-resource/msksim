import type { RNG } from '../rng';
import type { Topology, TopologyKind } from '../topology';

/**
 * Well-mixed (mean-field) topology: every agent can interact with every
 * other agent. This is the control condition against which the lattice
 * coarsening claim is measured (docs/spec.md §2).
 *
 * neighbors() is a lazy generator to avoid O(N²) memory: for N = 10⁴
 * agents, a precomputed adjacency list would be ~10⁸ integers per world.
 *
 * pickNeighbor() is O(1): draws a uniform random integer and re-rolls
 * if it hits the querying agent's own position. Expected rolls ≈ 1 + 1/(N-1).
 */
export class WellMixedTopology implements Topology {
  readonly kind: TopologyKind = 'well-mixed';
  readonly size: number;

  constructor(size: number) {
    if (size === 0) {
      throw new RangeError('WellMixedTopology: size must be > 0');
    }
    this.size = size;
  }

  *neighbors(position: number, _rng: RNG): Iterable<number> {
    for (let i = 0; i < this.size; i++) {
      if (i !== position) yield i;
    }
  }

  pickNeighbor(position: number, rng: RNG): number | null {
    if (this.size < 2) return null;
    let candidate: number;
    do {
      candidate = rng.nextInt(0, this.size - 1);
    } while (candidate === position);
    return candidate;
  }

  *adjacency(): Iterable<[number, number]> {
    for (let i = 0; i < this.size; i++) {
      for (let j = i + 1; j < this.size; j++) {
        yield [i, j];
      }
    }
  }
}

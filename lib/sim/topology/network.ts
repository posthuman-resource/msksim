// Small-world and scale-free graph generators are deferred to v2.
// Step 16 will add graphology-communities-louvain on top of this graphology dep.
// This v1 stub works end-to-end on a manually supplied adjacency map via the
// static fromAdjacencyMap() factory, which is all that steps 11–18 require.

import Graph from "graphology";
import type { RNG } from "../rng";
import type { Topology, TopologyKind } from "../topology";

/**
 * Network topology backed by a graphology Graph.
 *
 * Positions are integer indices that are stringified as graphology node keys.
 * The static factory fromAdjacencyMap() is the primary fixture builder for
 * unit tests and step-11 bootstrap tests.
 */
export class NetworkTopology implements Topology {
  readonly kind: TopologyKind = "network";
  readonly size: number;

  private readonly graph: Graph;

  constructor(graph: Graph) {
    this.graph = graph;
    this.size = graph.order;
  }

  neighbors(position: number, _rng: RNG): number[] {
    return this.graph.neighbors(position.toString()).map(Number);
  }

  pickNeighbor(position: number, rng: RNG): number | null {
    const ns = this.neighbors(position, rng);
    if (ns.length === 0) return null;
    return rng.pick(ns);
  }

  *adjacency(): Iterable<[number, number]> {
    for (const { source, target } of this.graph.edgeEntries()) {
      const s = Number(source);
      const t = Number(target);
      yield s < t ? [s, t] : [t, s];
    }
  }

  /**
   * Build a NetworkTopology from an adjacency map.
   * Each key is a node; its value lists adjacent node ids.
   * Duplicate edges and self-loops are silently skipped.
   */
  static fromAdjacencyMap(adj: Map<number, number[]>): NetworkTopology {
    const graph = new Graph({ type: "undirected", multi: false });

    for (const node of adj.keys()) {
      graph.addNode(node.toString());
    }

    for (const [node, neighbors] of adj) {
      for (const neighbor of neighbors) {
        const s = node.toString();
        const t = neighbor.toString();
        if (s !== t && !graph.hasEdge(s, t)) {
          graph.addEdge(s, t);
        }
      }
    }

    return new NetworkTopology(graph);
  }
}

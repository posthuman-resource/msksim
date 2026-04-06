// Graph-derived per-tick observables for the Naming Game simulation.
// Per docs/spec.md §7.1: largest-cluster size, cluster count, interaction-graph
// modularity, assimilation index, and segregation index.
//
// TOPOLOGY-AGNOSTIC INVARIANT (F4): none of the functions in this module branch
// on the topology type (lattice vs well-mixed vs network). Metrics are computed
// from agent inventories and the cumulative interaction graph only, making them
// directly comparable across all three topology modes.
//
// PURE-FUNCTION CONTRACT: all exports are pure given their inputs. The caller
// (step-20 worker) owns the cumulative interactionGraph across ticks; step 16
// provides helpers to build and update it but does not retain state.
//
// No `import 'server-only'` — this module loads in the step-20 Web Worker
// (client context) and is re-used by step 21/23 client components. See CLAUDE.md.

import { UndirectedGraph } from 'graphology';
import louvain from 'graphology-communities-louvain';
import Graph from 'graphology';
import type { AgentState, AgentId } from '../types';
import type { Language, Referent, TokenLexeme } from '@/lib/schema/primitives';
import type { World } from '../world';
import type { InteractionEvent } from '../engine';
import type { RNG } from '../rng';
import type { GraphMetricsSnapshot } from './types';

// ─── topWeightedTokenByReferent ───────────────────────────────────────────────

/**
 * Derive each agent's top-weighted token per referent from its full inventory.
 *
 * Aggregates across all languages the agent knows: for each referent, the single
 * highest-weighted (language, lexeme) pair wins, regardless of language. This is
 * consistent with docs/spec.md §7.1's "edges where two agents share a top-weighted
 * token" (singular) — treating per-referent-per-language as separate would make
 * every bilingual pair trivially connected through their shared L1 tops.
 *
 * Tie-breaking: when two tokens share the maximum weight, the lexicographically
 * smaller lexeme string wins (ascending). This makes the result deterministic
 * without an RNG, which is required for reproducible token-agreement graphs.
 *
 * Re-exported so step 21's lattice renderer (F7 "dominant token" projection) can
 * reuse the same computation without a separate implementation.
 */
export function topWeightedTokenByReferent(agent: AgentState): Map<Referent, TokenLexeme> {
  // Track (bestWeight, bestLexeme) per referent across all languages.
  const best = new Map<Referent, { weight: number; lexeme: TokenLexeme }>();

  for (const [, referentMap] of agent.inventory) {
    for (const [referent, tokenMap] of referentMap) {
      for (const [lexeme, weight] of tokenMap) {
        const current = best.get(referent);
        if (
          current === undefined ||
          weight > current.weight ||
          (weight === current.weight && lexeme < current.lexeme)
        ) {
          best.set(referent, { weight, lexeme: lexeme as TokenLexeme });
        }
      }
    }
  }

  const result = new Map<Referent, TokenLexeme>();
  for (const [referent, { lexeme }] of best) {
    result.set(referent, lexeme);
  }
  return result;
}

// ─── Token agreement graph ────────────────────────────────────────────────────

/**
 * Build the per-tick token agreement graph for one world.
 * Nodes = agents; an undirected edge exists between agents a and b iff there is
 * at least one referent r where topWeightedTokenByReferent(a).get(r) ===
 * topWeightedTokenByReferent(b).get(r).
 *
 * Rebuilt from scratch every tick (O(N²) pairwise scan) — acceptable for
 * N ≤ 500. See docs/plan/16-graph-metrics.md §4 path-not-taken #9 for the
 * incremental-maintenance design that can be adopted in v2 if needed.
 *
 * Exported for step 23 diagnostic tooling and unit-test isolation.
 */
export function buildTokenAgreementGraph(world: World): UndirectedGraph {
  const graph = new UndirectedGraph();
  const agents = world.agents;

  // Precompute top tokens for all agents to avoid O(N²) redundant work.
  const topTokens = agents.map((agent) => ({
    id: agent.id,
    tops: topWeightedTokenByReferent(agent),
  }));

  // Add all agents as nodes.
  for (const { id } of topTokens) {
    graph.addNode(id);
  }

  // O(N²/2) pair scan: add edge if any referent top-token matches.
  for (let i = 0; i < topTokens.length; i++) {
    for (let j = i + 1; j < topTokens.length; j++) {
      const a = topTokens[i];
      const b = topTokens[j];
      let agrees = false;
      for (const [referent, lexeme] of a.tops) {
        if (b.tops.get(referent) === lexeme) {
          agrees = true;
          break;
        }
      }
      if (agrees) {
        graph.addEdge(a.id, b.id);
      }
    }
  }

  return graph;
}

// ─── Connected-component helpers ─────────────────────────────────────────────

/**
 * Internal: find all connected-component sizes in an undirected graph.
 * Returns an array of sizes (one entry per component), unsorted.
 * Uses BFS over graphology's forEachNeighbor iterator.
 */
function findComponentSizes(graph: UndirectedGraph): number[] {
  const visited = new Set<string>();
  const sizes: number[] = [];

  for (const node of graph.nodes()) {
    if (visited.has(node)) continue;

    // BFS from this unvisited node.
    const queue: string[] = [node];
    visited.add(node);
    let size = 0;

    while (queue.length > 0) {
      const current = queue.shift()!;
      size++;
      graph.forEachNeighbor(current, (neighbor) => {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          queue.push(neighbor);
        }
      });
    }

    sizes.push(size);
  }

  return sizes;
}

/**
 * Size of the largest connected component in the token agreement graph.
 * Returns 0 if the graph has no nodes.
 * Directly answers the "coarsening" signature from docs/spec.md §2 (RQ2).
 */
export function largestClusterSize(agreementGraph: UndirectedGraph): number {
  const sizes = findComponentSizes(agreementGraph);
  return sizes.length === 0 ? 0 : Math.max(...sizes);
}

/**
 * Number of connected components with size ≥ 2 in the token agreement graph.
 * Singletons are excluded: an agent whose top tokens match no one else is not
 * a "cluster" in the sociolinguistic sense (docs/spec.md §7.1, cluster count row).
 */
export function clusterCount(agreementGraph: UndirectedGraph): number {
  return findComponentSizes(agreementGraph).filter((s) => s >= 2).length;
}

// ─── Assimilation index ───────────────────────────────────────────────────────

/**
 * Per-tick assimilation index: among successful interactions between
 * W2-Immigrants and W2-Natives this tick, the fraction that occurred in L2.
 *
 * - Rises toward 1.0 under assimilation (immigrants adopt L2).
 * - Falls toward 0.0 under segregation (immigrants persist in L1).
 * - Returns null when there are no qualifying interactions this tick (0/0).
 *
 * Role-symmetric: Immigrant→Native and Native→Immigrant are both counted.
 * Failed interactions are excluded from both numerator and denominator.
 *
 * Primary observable for docs/spec.md RQ1 and RQ5.
 */
export function computeAssimilationIndex(
  tickInteractions: InteractionEvent[],
  l2Label: Language,
): number | null {
  const qualifying = tickInteractions.filter((e) => {
    if (!e.success) return false;
    const { speakerClass, hearerClass } = e;
    return (
      (speakerClass === 'W2-Immigrant' && hearerClass === 'W2-Native') ||
      (speakerClass === 'W2-Native' && hearerClass === 'W2-Immigrant')
    );
  });

  if (qualifying.length === 0) return null;

  const l2Count = qualifying.filter((e) => e.language === l2Label).length;
  return l2Count / qualifying.length;
}

// ─── Segregation index ────────────────────────────────────────────────────────

/**
 * Louvain modularity of the subgraph of the cumulative interaction graph
 * induced by W2-Immigrant nodes only.
 *
 * High values: immigrants interact mostly among themselves (distinct community).
 * Low/zero values: immigrants are well-integrated with natives.
 *
 * Returns 0 when:
 *   - The immigrant subgraph has fewer than 2 nodes, OR
 *   - The immigrant subgraph has no edges (immigrants have never interacted).
 * These degenerate cases are semantically "no segregation detected."
 *
 * Louvain is seeded via rng.nextFloat for reproducibility across test runs.
 * Complement to assimilationIndex; together they operationalise RQ1/RQ5.
 */
export function computeSegregationIndex(interactionGraph: Graph, world2: World, rng: RNG): number {
  // Collect W2-Immigrant IDs.
  const immigrantIds = new Set<string>();
  for (const agent of world2.agents) {
    if (agent.class === 'W2-Immigrant') {
      immigrantIds.add(agent.id as string);
    }
  }

  // Build the induced subgraph.
  const subgraph = new UndirectedGraph();
  for (const id of immigrantIds) {
    if (interactionGraph.hasNode(id)) {
      subgraph.mergeNode(id);
    }
  }
  interactionGraph.forEachEdge(
    (_edge: string, attrs: Record<string, unknown>, source: string, target: string) => {
      if (immigrantIds.has(source) && immigrantIds.has(target)) {
        subgraph.addEdge(source, target, attrs);
      }
    },
  );

  if (subgraph.order < 2 || subgraph.size < 1) return 0;

  const result = louvain.detailed(subgraph, {
    getEdgeWeight: 'weight',
    rng: () => rng.nextFloat(),
  });
  return result.modularity;
}

// ─── On-demand community details (for step 23 network view) ──────────────────

/**
 * Full Louvain community assignment for the cumulative interaction graph.
 * Called on-demand by step 23's network view (not per-tick — see §4 path #10).
 *
 * Returns:
 *   assignments — Map<AgentId, communityId> (integer community labels).
 *   count       — number of distinct communities found.
 *   modularity  — Q score for the full graph.
 */
export function computeInteractionGraphCommunities(
  interactionGraph: Graph,
  rng: RNG,
): { assignments: Map<AgentId, number>; count: number; modularity: number } {
  if (interactionGraph.order < 2 || interactionGraph.size < 1) {
    return { assignments: new Map(), count: 0, modularity: 0 };
  }

  const result = louvain.detailed(interactionGraph, {
    getEdgeWeight: 'weight',
    rng: () => rng.nextFloat(),
  });

  const assignments = new Map<AgentId, number>();
  for (const [nodeKey, communityId] of Object.entries(result.communities)) {
    assignments.set(nodeKey as AgentId, communityId);
  }

  return { assignments, count: result.count, modularity: result.modularity };
}

// ─── Main entry point ─────────────────────────────────────────────────────────

/**
 * Compute all five graph-derived observables for one tick.
 *
 * Called by the step-20 worker once per tick, after:
 *   1. computeScalarMetrics (step 15)
 *   2. updateInteractionGraph (interaction-graph.ts helper) — the caller must
 *      merge this tick's events BEFORE calling this function so that the
 *      interaction graph reflects the current tick.
 *
 * ctx.l2Label should come from the experiment config (world.languages[1] or
 * equivalent). ctx.rng is the simulation's seeded RNG; it is consumed by the
 * two Louvain calls and must not be used for other purposes between calls to
 * keep the RNG stream deterministic.
 */
export function computeGraphMetrics(
  world1: World,
  world2: World,
  interactionGraph: Graph,
  tickInteractions: InteractionEvent[],
  ctx: { tick: number; l2Label: Language; rng: RNG },
): GraphMetricsSnapshot {
  // Build token-agreement graphs (per world, O(N²) each).
  const ag1 = buildTokenAgreementGraph(world1);
  const ag2 = buildTokenAgreementGraph(world2);

  // Derive both cluster metrics from a single component pass per world.
  const sizes1 = findComponentSizes(ag1);
  const sizes2 = findComponentSizes(ag2);

  const w1LargestCluster = sizes1.length === 0 ? 0 : Math.max(...sizes1);
  const w1ClusterCount = sizes1.filter((s) => s >= 2).length;
  const w2LargestCluster = sizes2.length === 0 ? 0 : Math.max(...sizes2);
  const w2ClusterCount = sizes2.filter((s) => s >= 2).length;

  // Interaction-graph modularity (full graph).
  let interactionGraphModularity = 0;
  if (interactionGraph.order >= 2 && interactionGraph.size >= 1) {
    const result = louvain.detailed(interactionGraph, {
      getEdgeWeight: 'weight',
      rng: () => ctx.rng.nextFloat(),
    });
    interactionGraphModularity = result.modularity;
  }

  // Assimilation index (null when no qualifying interactions).
  const assimilationIndex = computeAssimilationIndex(tickInteractions, ctx.l2Label);

  // Segregation index (0 when immigrant subgraph is trivial).
  const segregationIndex = computeSegregationIndex(interactionGraph, world2, ctx.rng);

  return {
    tick: ctx.tick,
    world1: { largestClusterSize: w1LargestCluster, clusterCount: w1ClusterCount },
    world2: { largestClusterSize: w2LargestCluster, clusterCount: w2ClusterCount },
    interactionGraphModularity,
    assimilationIndex,
    segregationIndex,
  };
}

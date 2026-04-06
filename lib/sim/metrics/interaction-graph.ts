// Incremental cumulative interaction-graph helper.
// Maintains a graphology UndirectedGraph of successful interactions across ticks.
// The worker (step 20) creates one graph at simulation start and passes it into
// updateInteractionGraph each tick; this module never owns the graph's lifetime.
//
// No `import 'server-only'` — this module loads in the step-20 Web Worker
// (client context). See CLAUDE.md "Next.js 16 deltas".

import { UndirectedGraph } from 'graphology';
import type { InteractionEvent } from '../engine';

// Re-export the type so callers do not need to import graphology directly.
export type { UndirectedGraph };

/**
 * Create a fresh empty undirected graph for accumulating successful interactions.
 * Call once at simulation start; pass the returned graph to updateInteractionGraph
 * every tick.
 */
export function createInteractionGraph(): UndirectedGraph {
  return new UndirectedGraph();
}

/**
 * Merge this tick's successful interactions into the cumulative graph.
 *
 * For each event where success === true:
 *   - Adds speakerId and hearerId as nodes if not already present (idempotent).
 *   - Increments the edge weight between them by 1 (creates the edge on first call).
 *
 * Failed interactions (success === false) are ignored — the cumulative graph
 * represents successful social bonds only, per docs/spec.md §7.1 modularity row
 * and F8's network-view definition.
 *
 * Self-interactions (speakerId === hearerId) are silently skipped; UndirectedGraph
 * disallows self-loops by default, and the engine's selectPartner already filters
 * them out.
 */
export function updateInteractionGraph(
  graph: UndirectedGraph,
  tickInteractions: InteractionEvent[],
): void {
  for (const event of tickInteractions) {
    if (!event.success) continue;
    const { speakerId, hearerId } = event;
    if (speakerId === hearerId) continue;

    graph.mergeNode(speakerId);
    graph.mergeNode(hearerId);
    graph.updateEdge(speakerId, hearerId, (attrs) => ({
      weight: ((attrs as { weight?: number }).weight ?? 0) + 1,
    }));
  }
}

/**
 * Number of nodes (agents) that have appeared in at least one successful
 * interaction. Thin wrapper over graph.order.
 */
export function interactionGraphNodeCount(graph: UndirectedGraph): number {
  return graph.order;
}

/**
 * Number of distinct (speaker, hearer) pairs that have had at least one
 * successful interaction. Thin wrapper over graph.size.
 */
export function interactionGraphEdgeCount(graph: UndirectedGraph): number {
  return graph.size;
}

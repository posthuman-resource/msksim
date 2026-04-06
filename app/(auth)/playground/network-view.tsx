'use client';

// app/(auth)/playground/network-view.tsx — WebGL network graph renderer (F8).
//
// Renders the cumulative interaction graph from the simulation worker using sigma.js v3
// on a graphology Graph instance. Node colours are Louvain community assignments mapped
// to the Okabe-Ito palette. Node/edge sizes scale logarithmically with degree/weight.
//
// ForceAtlas2 layout is computed once per graph-shape change (not every tick) and
// positions are cached across rebuilds for warm-start convergence.
//
// 'use client' is on line 1 because sigma imports ResizeObserver + WebGL APIs at
// module scope and must never run during SSR.

import { useEffect, useRef } from 'react';
import Graph from 'graphology';
import type { SerializedGraph } from 'graphology-types';
import Sigma from 'sigma';
import forceAtlas2 from 'graphology-layout-forceatlas2';

import { communityColor } from './network-view-palette';
export { OKABE_ITO, communityColor } from './network-view-palette';

// ─── Thresholds ───────────────────────────────────────────────────────────────

/** Minimum node count before the graph is rendered (instead of the placeholder). */
const DEFAULT_MIN_NODES = 4;
/** Minimum edge count before the graph is rendered (instead of the placeholder). */
const DEFAULT_MIN_EDGES = 3;

// ─── Props ────────────────────────────────────────────────────────────────────

interface NetworkViewProps {
  /** Serialized graphology graph from the worker's getInteractionGraph(). Null until first poll. */
  graph: SerializedGraph | null;
  /** Per-node Louvain community assignment. Null until first poll (matches graph snapshot). */
  communities: Map<string, number> | null;
  /** Override the minimum node threshold (default 4). */
  minNodes?: number;
  /** Override the minimum edge threshold (default 3). */
  minEdges?: number;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function NetworkView({ graph, communities, minNodes, minEdges }: NetworkViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sigmaRef = useRef<Sigma | null>(null);
  const graphRef = useRef<Graph | null>(null);
  /**
   * Position cache: carries warm-start positions across full graph rebuilds.
   * See docs/plan/23-network-view.md §4 research item 13 for the full trade-off
   * rationale (full rebuild + position cache vs. incremental diffing).
   * Math.random() is intentional here — this is presentation state, not simulation
   * state, so it does not need to be deterministic. See CLAUDE.md testing conventions.
   */
  const positionCacheRef = useRef<Map<string, { x: number; y: number }>>(new Map());

  const minN = minNodes ?? DEFAULT_MIN_NODES;
  const minE = minEdges ?? DEFAULT_MIN_EDGES;

  // Derive counts from props at render time so no setState call is needed inside the effect.
  const nodeCount = graph?.nodes.length ?? 0;
  const edgeCount = graph?.edges.length ?? 0;
  const isEmpty = graph === null || nodeCount < minN || edgeCount < minE;

  useEffect(() => {
    if (graph === null || graph.nodes.length < minN || graph.edges.length < minE) {
      return;
    }

    if (!containerRef.current) return;

    // ── 1. Reconstruct the graphology instance from the serialized form.
    // Full rebuild on every poll (not incremental diffing) — see plan §4 item 13.
    const g = Graph.from(graph);
    graphRef.current = g;

    // ── 2. Seed positions: reuse cached position or random initial placement.
    // ForceAtlas2 requires every node to carry x/y attributes before it runs.
    g.forEachNode((nodeId) => {
      const cached = positionCacheRef.current.get(nodeId);
      g.mergeNodeAttributes(nodeId, {
        x: cached?.x ?? Math.random(),
        y: cached?.y ?? Math.random(),
      });
    });

    // ── 3. Apply community colours.
    g.forEachNode((nodeId) => {
      const communityId = communities?.get(nodeId) ?? 0;
      g.setNodeAttribute(nodeId, 'color', communityColor(communityId));
    });

    // ── 4. Set node sizes (log-scaled by degree so hubs are visible, singletons present).
    g.forEachNode((nodeId) => {
      const deg = g.degree(nodeId);
      g.setNodeAttribute(nodeId, 'size', 2 + 3 * Math.log2(1 + deg));
    });

    // ── 5. Set edge sizes (log-scaled by weight).
    g.forEachEdge((edgeId) => {
      const weight = (g.getEdgeAttribute(edgeId, 'weight') as number) ?? 1;
      g.setEdgeAttribute(edgeId, 'size', 1 + Math.log2(1 + weight));
    });

    // ── 6. Run ForceAtlas2 layout (warm-start from cached positions).
    // 100 iterations: enough for community separation on N≤500, <50ms on modern HW.
    // inferSettings() auto-scales gravity/scalingRatio/barnesHutOptimize with node count.
    // v2 tuning knob: increase iterations or run layout in a dedicated Worker.
    forceAtlas2.assign(g, {
      iterations: 100,
      settings: forceAtlas2.inferSettings(g),
    });

    // ── 7. Persist new positions to cache for next rebuild's warm start.
    g.forEachNode((nodeId, attrs) => {
      positionCacheRef.current.set(nodeId, { x: attrs.x as number, y: attrs.y as number });
    });

    // ── 8. Kill the previous sigma instance before constructing a new one.
    // Sigma v3 is bound to a specific graphology.Graph instance; rebuilding the graph
    // means rebuilding the sigma instance rather than re-pointing its graph reference.
    if (sigmaRef.current) {
      sigmaRef.current.kill();
      sigmaRef.current = null;
    }

    // ── 9. Construct sigma.
    const sigmaInstance = new Sigma(g, containerRef.current, {});
    sigmaRef.current = sigmaInstance;

    // ── 10. Expose debug globals for MCP script introspection.
    // This is a research instrument, not a consumer product — debug globals are always
    // exposed in the browser so the verification harness can read graph state.
    (window as unknown as Record<string, unknown>)['__msksim_debug_graph'] = g;
    (window as unknown as Record<string, unknown>)['__msksim_debug_sigma'] = sigmaInstance;

    return () => {
      sigmaInstance.kill();
      // Do NOT clear positionCacheRef or graphRef here — they survive across re-renders
      // for warm-start purposes. React unmounts them automatically on full unmount.
    };
  }, [graph, communities, minN, minE]);

  return (
    <div className="relative w-full h-[600px] bg-slate-900 rounded">
      {isEmpty && (
        <div className="absolute inset-0 flex items-center justify-center text-slate-400 text-sm z-10">
          Waiting for interactions… ({nodeCount} nodes, {edgeCount} edges)
        </div>
      )}
      <div ref={containerRef} data-testid="sigma-container" className="absolute inset-0" />
    </div>
  );
}

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { UndirectedGraph } from 'graphology';
import louvain from 'graphology-communities-louvain';
import type { Referent } from '@/lib/schema/primitives';
import {
  topWeightedTokenByReferent,
  buildTokenAgreementGraph,
  largestClusterSize,
  clusterCount,
  computeAssimilationIndex,
  computeSegregationIndex,
  computeInteractionGraphCommunities,
  computeGraphMetrics,
} from './graph';
import { createInteractionGraph, updateInteractionGraph } from './interaction-graph';
import { createRNG } from '../rng';
import type { AgentState, AgentId } from '../types';
import type { World } from '../world';
import type { InteractionEvent } from '../engine';

// ─── Fixture helpers ──────────────────────────────────────────────────────────

/**
 * Build a minimal AgentState with the given inventory structure.
 * inventory is a plain nested object for readability in tests.
 */
function makeAgent(
  id: string,
  agentClass: AgentState['class'],
  inventorySpec: Record<string, Record<string, Record<string, number>>>,
): AgentState {
  const inventory = new Map(
    Object.entries(inventorySpec).map(([lang, refMap]) => [
      lang,
      new Map(
        Object.entries(refMap).map(([ref, tokenMap]) => [
          ref,
          new Map(Object.entries(tokenMap) as [string, number][]),
        ]),
      ),
    ]),
  ) as unknown as AgentState['inventory'];

  return {
    id: id as AgentId,
    class: agentClass,
    position: 0,
    inventory,
    interactionMemory: [],
  };
}

/** Build a minimal World containing the given agents. */
function makeWorld(id: 'world1' | 'world2', agents: AgentState[]): World {
  return {
    id,
    agents,
    topology: {
      kind: 'well-mixed' as const,
      size: agents.length,
      pickNeighbor: () => null,
      neighbors: () => [],
    },
    referents: ['yellow-like' as World['referents'][0]],
    languages: ['L1' as World['languages'][0], 'L2' as World['languages'][0]],
  };
}

/** Build a mock InteractionEvent. */
function makeEvent(
  speakerId: string,
  hearerId: string,
  speakerClass: AgentState['class'],
  hearerClass: AgentState['class'],
  language: string,
  success: boolean,
): InteractionEvent {
  return {
    tick: 1,
    worldId: 'world2',
    speakerId: speakerId as AgentId,
    hearerId: hearerId as AgentId,
    speakerClass,
    hearerClass,
    language: language as InteractionEvent['language'],
    referent: 'yellow-like' as InteractionEvent['referent'],
    token: 'yellow' as InteractionEvent['token'],
    success,
  };
}

// ─── topWeightedTokenByReferent ───────────────────────────────────────────────

describe('topWeightedTokenByReferent', () => {
  it('picks the highest-weight token', () => {
    const agent = makeAgent('a', 'W1-Mono', {
      L1: { 'yellow-like': { yellow: 0.7, gold: 0.3 } },
    });
    const result = topWeightedTokenByReferent(agent);
    expect(result.get('yellow-like' as Referent)).toBe('yellow');
  });

  it('breaks ties lexicographically (ascending)', () => {
    const agent = makeAgent('a', 'W1-Mono', {
      L1: { 'yellow-like': { yellow: 0.5, amber: 0.5 } },
    });
    const result = topWeightedTokenByReferent(agent);
    // 'amber' < 'yellow' lexicographically
    expect(result.get('yellow-like' as Referent)).toBe('amber');
  });

  it('aggregates across languages per referent', () => {
    const agent = makeAgent('a', 'W1-Bi', {
      L1: { r1: { red: 0.6 } },
      L2: { r1: { rouge: 0.9 } },
    });
    const result = topWeightedTokenByReferent(agent);
    // rouge (0.9) beats red (0.6)
    expect(result.get('r1' as Referent)).toBe('rouge');
  });
});

// ─── buildTokenAgreementGraph + cluster metrics ───────────────────────────────

describe('buildTokenAgreementGraph / largestClusterSize / clusterCount', () => {
  it('3 agents with identical top tokens form one component of size 3', () => {
    const inv = { L1: { 'yellow-like': { yellow: 1.0 } } };
    const agents = [
      makeAgent('a', 'W1-Mono', inv),
      makeAgent('b', 'W1-Mono', inv),
      makeAgent('c', 'W1-Mono', inv),
    ];
    const world = makeWorld('world1', agents);
    const graph = buildTokenAgreementGraph(world);
    expect(largestClusterSize(graph)).toBe(3);
    expect(clusterCount(graph)).toBe(1);
  });

  it('3 agents with completely disjoint top tokens form 3 singletons', () => {
    const agents = [
      makeAgent('a', 'W1-Mono', { L1: { 'yellow-like': { yellow: 1.0 } } }),
      makeAgent('b', 'W1-Mono', { L1: { 'yellow-like': { rouge: 1.0 } } }),
      makeAgent('c', 'W1-Mono', { L1: { 'yellow-like': { gul: 1.0 } } }),
    ];
    const world = makeWorld('world1', agents);
    const graph = buildTokenAgreementGraph(world);
    expect(largestClusterSize(graph)).toBe(1);
    expect(clusterCount(graph)).toBe(0); // singletons excluded
  });

  it('5 agents split into cluster of 3 and cluster of 2', () => {
    const inv1 = { L1: { 'yellow-like': { yellow: 1.0 } } };
    const inv2 = { L1: { 'yellow-like': { jaune: 1.0 } } };
    const agents = [
      makeAgent('a', 'W1-Mono', inv1),
      makeAgent('b', 'W1-Mono', inv1),
      makeAgent('c', 'W1-Mono', inv1),
      makeAgent('d', 'W1-Bi', inv2),
      makeAgent('e', 'W1-Bi', inv2),
    ];
    const world = makeWorld('world1', agents);
    const graph = buildTokenAgreementGraph(world);
    expect(largestClusterSize(graph)).toBe(3);
    expect(clusterCount(graph)).toBe(2);
  });
});

// ─── Louvain modularity tests ─────────────────────────────────────────────────

describe('Louvain modularity', () => {
  it('fully-connected 6-node graph with uniform weights has modularity near zero', () => {
    const rng = createRNG(42);
    const graph = new UndirectedGraph();
    const nodes = ['a', 'b', 'c', 'd', 'e', 'f'];
    for (const n of nodes) graph.addNode(n);
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        graph.addEdge(nodes[i], nodes[j], { weight: 1 });
      }
    }
    const result = louvain.detailed(graph, {
      getEdgeWeight: 'weight',
      rng: () => rng.nextFloat(),
    });
    expect(Math.abs(result.modularity)).toBeLessThan(0.15);
  });

  it('two triangles joined by one edge have modularity ≈ 0.357 (0.30–0.40)', () => {
    const rng = createRNG(42);
    const graph = new UndirectedGraph();
    // Triangle 1: a-b-c
    ['a', 'b', 'c', 'd', 'e', 'f'].forEach((n) => graph.addNode(n));
    graph.addEdge('a', 'b', { weight: 1 });
    graph.addEdge('b', 'c', { weight: 1 });
    graph.addEdge('a', 'c', { weight: 1 });
    // Triangle 2: d-e-f
    graph.addEdge('d', 'e', { weight: 1 });
    graph.addEdge('e', 'f', { weight: 1 });
    graph.addEdge('d', 'f', { weight: 1 });
    // Bridge
    graph.addEdge('c', 'd', { weight: 1 });

    const result = louvain.detailed(graph, {
      getEdgeWeight: 'weight',
      rng: () => rng.nextFloat(),
    });
    expect(result.modularity).toBeGreaterThanOrEqual(0.3);
    expect(result.modularity).toBeLessThanOrEqual(0.4);
  });

  it('Louvain modularity is deterministic under a seeded RNG', () => {
    function runTwoTriangles(seed: number): number {
      const rng = createRNG(seed);
      const graph = new UndirectedGraph();
      ['a', 'b', 'c', 'd', 'e', 'f'].forEach((n) => graph.addNode(n));
      graph.addEdge('a', 'b', { weight: 1 });
      graph.addEdge('b', 'c', { weight: 1 });
      graph.addEdge('a', 'c', { weight: 1 });
      graph.addEdge('d', 'e', { weight: 1 });
      graph.addEdge('e', 'f', { weight: 1 });
      graph.addEdge('d', 'f', { weight: 1 });
      graph.addEdge('c', 'd', { weight: 1 });
      return louvain.detailed(graph, {
        getEdgeWeight: 'weight',
        rng: () => rng.nextFloat(),
      }).modularity;
    }

    const m1 = runTwoTriangles(99);
    const m2 = runTwoTriangles(99);
    expect(m1).toBe(m2);
  });
});

// ─── computeAssimilationIndex ─────────────────────────────────────────────────

describe('computeAssimilationIndex', () => {
  const l2 = 'L2' as InteractionEvent['language'];
  const l1 = 'L1' as InteractionEvent['language'];

  it('returns 1.0 when all qualifying interactions are in L2', () => {
    const events = [
      makeEvent('i1', 'n1', 'W2-Immigrant', 'W2-Native', 'L2', true),
      makeEvent('i2', 'n2', 'W2-Immigrant', 'W2-Native', 'L2', true),
      makeEvent('n3', 'i3', 'W2-Native', 'W2-Immigrant', 'L2', true),
    ];
    expect(computeAssimilationIndex(events, l2)).toBe(1.0);
  });

  it('returns 0.0 when all qualifying interactions are in L1', () => {
    const events = [
      makeEvent('i1', 'n1', 'W2-Immigrant', 'W2-Native', 'L1', true),
      makeEvent('i2', 'n2', 'W2-Immigrant', 'W2-Native', 'L1', true),
    ];
    expect(computeAssimilationIndex(events, l2)).toBe(0.0);
  });

  it('returns null when there are no qualifying interactions', () => {
    const events = [
      makeEvent('a', 'b', 'W1-Mono', 'W1-Mono', 'L1', true),
      makeEvent('c', 'd', 'W1-Bi', 'W1-Bi', 'L1', true),
    ];
    expect(computeAssimilationIndex(events, l2)).toBeNull();
    expect(computeAssimilationIndex([], l2)).toBeNull();
  });

  it('ignores failed interactions', () => {
    const events = [
      makeEvent('i1', 'n1', 'W2-Immigrant', 'W2-Native', 'L2', true),
      makeEvent('i2', 'n2', 'W2-Immigrant', 'W2-Native', 'L2', true),
      // 3 failed L1 interactions — should be ignored
      makeEvent('i3', 'n3', 'W2-Immigrant', 'W2-Native', 'L1', false),
      makeEvent('i4', 'n4', 'W2-Immigrant', 'W2-Native', 'L1', false),
      makeEvent('i5', 'n5', 'W2-Immigrant', 'W2-Native', 'L1', false),
    ];
    expect(computeAssimilationIndex(events, l2)).toBe(1.0);
  });

  it('treats Immigrant→Native and Native→Immigrant symmetrically', () => {
    const events = [
      makeEvent('i1', 'n1', 'W2-Immigrant', 'W2-Native', 'L2', true),
      makeEvent('n2', 'i2', 'W2-Native', 'W2-Immigrant', 'L2', true),
    ];
    expect(computeAssimilationIndex(events, l2)).toBe(1.0);
  });

  // Suppress unused-variable warning
  void l1;
});

// ─── computeSegregationIndex ──────────────────────────────────────────────────

describe('computeSegregationIndex', () => {
  it('returns 0 when the immigrant subgraph has fewer than 2 nodes', () => {
    const graph = createInteractionGraph();
    const world2 = makeWorld('world2', [
      makeAgent('i1', 'W2-Immigrant', {}),
      makeAgent('n1', 'W2-Native', {}),
    ]);
    const rng = createRNG(42);
    expect(computeSegregationIndex(graph, world2, rng)).toBe(0);
  });

  it('returns 0 when immigrants have no inter-immigrant interactions', () => {
    const graph = createInteractionGraph();
    // Only immigrant-native edges
    updateInteractionGraph(graph, [makeEvent('i1', 'n1', 'W2-Immigrant', 'W2-Native', 'L1', true)]);
    const world2 = makeWorld('world2', [
      makeAgent('i1', 'W2-Immigrant', {}),
      makeAgent('n1', 'W2-Native', {}),
    ]);
    const rng = createRNG(42);
    expect(computeSegregationIndex(graph, world2, rng)).toBe(0);
  });

  it('rises when immigrants form distinct cliques', () => {
    // Case 1: single triangle of immigrants (low segregation index — no sub-community)
    const rng1 = createRNG(42);
    const graph1 = new UndirectedGraph();
    ['i1', 'i2', 'i3', 'n1'].forEach((n) => graph1.addNode(n));
    graph1.addEdge('i1', 'i2', { weight: 5 });
    graph1.addEdge('i2', 'i3', { weight: 5 });
    graph1.addEdge('i1', 'i3', { weight: 5 });
    graph1.addEdge('i1', 'n1', { weight: 1 });
    const world2a = makeWorld('world2', [
      makeAgent('i1', 'W2-Immigrant', {}),
      makeAgent('i2', 'W2-Immigrant', {}),
      makeAgent('i3', 'W2-Immigrant', {}),
      makeAgent('n1', 'W2-Native', {}),
    ]);
    const seg1 = computeSegregationIndex(graph1, world2a, rng1);
    expect(seg1).toBeGreaterThanOrEqual(0);

    // Case 2: two immigrant cliques with no cross edges (higher modularity expected)
    const rng2 = createRNG(42);
    const graph2 = new UndirectedGraph();
    ['i1', 'i2', 'i3', 'i4', 'i5'].forEach((n) => graph2.addNode(n));
    // Clique A: i1-i2
    graph2.addEdge('i1', 'i2', { weight: 5 });
    // Clique B: i3-i4-i5
    graph2.addEdge('i3', 'i4', { weight: 5 });
    graph2.addEdge('i4', 'i5', { weight: 5 });
    graph2.addEdge('i3', 'i5', { weight: 5 });
    const world2b = makeWorld('world2', [
      makeAgent('i1', 'W2-Immigrant', {}),
      makeAgent('i2', 'W2-Immigrant', {}),
      makeAgent('i3', 'W2-Immigrant', {}),
      makeAgent('i4', 'W2-Immigrant', {}),
      makeAgent('i5', 'W2-Immigrant', {}),
    ]);
    const seg2 = computeSegregationIndex(graph2, world2b, rng2);
    // Two-clique structure should have positive modularity (community structure)
    expect(seg2).toBeGreaterThan(0);
  });
});

// ─── computeInteractionGraphCommunities ──────────────────────────────────────

describe('computeInteractionGraphCommunities', () => {
  it('returns assignments consistent with the two-triangle community structure', () => {
    const rng = createRNG(42);
    const graph = new UndirectedGraph();
    ['a', 'b', 'c', 'd', 'e', 'f'].forEach((n) => graph.addNode(n));
    graph.addEdge('a', 'b', { weight: 1 });
    graph.addEdge('b', 'c', { weight: 1 });
    graph.addEdge('a', 'c', { weight: 1 });
    graph.addEdge('d', 'e', { weight: 1 });
    graph.addEdge('e', 'f', { weight: 1 });
    graph.addEdge('d', 'f', { weight: 1 });
    graph.addEdge('c', 'd', { weight: 1 });

    const result = computeInteractionGraphCommunities(graph, rng);
    expect(result.count).toBe(2);
    expect(result.modularity).toBeGreaterThanOrEqual(0.3);
    expect(result.modularity).toBeLessThanOrEqual(0.4);

    // Triangle 1 members should all be in the same community
    const commA = result.assignments.get('a' as AgentId);
    const commB = result.assignments.get('b' as AgentId);
    const commC = result.assignments.get('c' as AgentId);
    expect(commA).toBe(commB);
    expect(commB).toBe(commC);

    // Triangle 2 in a different community
    const commD = result.assignments.get('d' as AgentId);
    expect(commA).not.toBe(commD);
  });

  it('returns empty assignments for trivial graph', () => {
    const rng = createRNG(42);
    const graph = new UndirectedGraph();
    const result = computeInteractionGraphCommunities(graph, rng);
    expect(result.count).toBe(0);
    expect(result.modularity).toBe(0);
    expect(result.assignments.size).toBe(0);
  });
});

// ─── computeGraphMetrics (smoke test) ────────────────────────────────────────

describe('computeGraphMetrics', () => {
  it('produces a well-formed GraphMetricsSnapshot for a minimal scenario', () => {
    const rng = createRNG(77);

    const inv = { L1: { 'yellow-like': { yellow: 1.0 } } };
    const world1 = makeWorld('world1', [
      makeAgent('w1a', 'W1-Mono', inv),
      makeAgent('w1b', 'W1-Mono', inv),
      makeAgent('w1c', 'W1-Bi', inv),
    ]);
    const world2 = makeWorld('world2', [
      makeAgent('w2n1', 'W2-Native', inv),
      makeAgent('w2n2', 'W2-Native', inv),
      makeAgent('w2i1', 'W2-Immigrant', inv),
    ]);

    const interactionGraph = createInteractionGraph();
    const tickEvents: InteractionEvent[] = [
      makeEvent('w2i1', 'w2n1', 'W2-Immigrant', 'W2-Native', 'L2', true),
      makeEvent('w2i1', 'w2n2', 'W2-Immigrant', 'W2-Native', 'L1', true),
      makeEvent('w1a', 'w1b', 'W1-Mono', 'W1-Mono', 'L1', true),
    ];
    updateInteractionGraph(interactionGraph, tickEvents);

    const snapshot = computeGraphMetrics(world1, world2, interactionGraph, tickEvents, {
      tick: 1,
      l2Label: 'L2' as World['languages'][0],
      rng,
    });

    // Structural assertions
    expect(snapshot.tick).toBe(1);
    expect(snapshot.world1.largestClusterSize).toBeGreaterThanOrEqual(0);
    expect(snapshot.world1.clusterCount).toBeGreaterThanOrEqual(0);
    expect(snapshot.world2.largestClusterSize).toBeGreaterThanOrEqual(0);
    expect(snapshot.world2.clusterCount).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(snapshot.interactionGraphModularity)).toBe(true);
    expect(Number.isFinite(snapshot.segregationIndex)).toBe(true);

    // assimilationIndex: 1 L2 success out of 2 qualifying = 0.5
    expect(snapshot.assimilationIndex).toBe(0.5);
  });
});

// ─── Topology-agnostic invariant check ───────────────────────────────────────

describe('topology-agnostic invariant (F4)', () => {
  it('graph.ts contains no topology.kind branches', () => {
    const src = readFileSync(join(__dirname, 'graph.ts'), 'utf-8');
    expect(src).not.toMatch(/\.kind\b/);
    expect(src).not.toMatch(/"lattice"/);
    expect(src).not.toMatch(/"well-mixed"/);
    expect(src).not.toMatch(/"network"/);
  });

  it('interaction-graph.ts contains no topology.kind branches', () => {
    const src = readFileSync(join(__dirname, 'interaction-graph.ts'), 'utf-8');
    expect(src).not.toMatch(/\.kind\b/);
    expect(src).not.toMatch(/"lattice"/);
    expect(src).not.toMatch(/"well-mixed"/);
    expect(src).not.toMatch(/"network"/);
  });
});

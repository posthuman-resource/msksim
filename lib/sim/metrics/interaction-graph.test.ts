import { describe, it, expect } from 'vitest';
import {
  createInteractionGraph,
  updateInteractionGraph,
  interactionGraphNodeCount,
  interactionGraphEdgeCount,
} from './interaction-graph';
import type { InteractionEvent } from '../engine';

// ─── Fixtures ────────────────────────────────────────────────────────────────

function makeEvent(speakerId: string, hearerId: string, success: boolean): InteractionEvent {
  return {
    tick: 0,
    worldId: 'world2',
    speakerId: speakerId as InteractionEvent['speakerId'],
    hearerId: hearerId as InteractionEvent['hearerId'],
    speakerClass: 'W2-Immigrant',
    hearerClass: 'W2-Native',
    language: 'L1' as InteractionEvent['language'],
    referent: 'yellow-like' as InteractionEvent['referent'],
    token: 'yellow' as InteractionEvent['token'],
    success,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('createInteractionGraph', () => {
  it('returns an empty undirected graph', () => {
    const graph = createInteractionGraph();
    expect(graph.order).toBe(0);
    expect(graph.size).toBe(0);
    expect(graph.type).toBe('undirected');
  });
});

describe('updateInteractionGraph', () => {
  it('single successful interaction creates two nodes and one edge with weight 1', () => {
    const graph = createInteractionGraph();
    updateInteractionGraph(graph, [makeEvent('a', 'b', true)]);
    expect(graph.order).toBe(2);
    expect(graph.size).toBe(1);
    expect(graph.getEdgeAttribute('a', 'b', 'weight')).toBe(1);
  });

  it('repeated same-pair interactions accumulate weight', () => {
    const graph = createInteractionGraph();
    updateInteractionGraph(graph, [
      makeEvent('a', 'b', true),
      makeEvent('a', 'b', true),
      makeEvent('a', 'b', true),
    ]);
    expect(graph.size).toBe(1);
    expect(graph.getEdgeAttribute('a', 'b', 'weight')).toBe(3);
  });

  it('failed interactions are ignored', () => {
    const graph = createInteractionGraph();
    updateInteractionGraph(graph, [makeEvent('a', 'b', false)]);
    expect(graph.order).toBe(0);
    expect(graph.size).toBe(0);
  });

  it('mixed batch: only successful interactions land in the graph', () => {
    const graph = createInteractionGraph();
    updateInteractionGraph(graph, [makeEvent('a', 'b', true), makeEvent('c', 'd', false)]);
    expect(graph.order).toBe(2);
    expect(graph.size).toBe(1);
    expect(graph.hasNode('a')).toBe(true);
    expect(graph.hasNode('b')).toBe(true);
    expect(graph.hasNode('c')).toBe(false);
    expect(graph.hasNode('d')).toBe(false);
  });

  it('multi-pair interactions produce correct node and edge counts', () => {
    const graph = createInteractionGraph();
    updateInteractionGraph(graph, [
      makeEvent('a', 'b', true),
      makeEvent('b', 'c', true),
      makeEvent('a', 'c', true),
    ]);
    expect(graph.order).toBe(3);
    expect(graph.size).toBe(3);
    expect(graph.getEdgeAttribute('a', 'b', 'weight')).toBe(1);
    expect(graph.getEdgeAttribute('b', 'c', 'weight')).toBe(1);
    expect(graph.getEdgeAttribute('a', 'c', 'weight')).toBe(1);
  });
});

describe('interactionGraphNodeCount / interactionGraphEdgeCount', () => {
  it('returns correct counts', () => {
    const graph = createInteractionGraph();
    updateInteractionGraph(graph, [makeEvent('x', 'y', true), makeEvent('y', 'z', true)]);
    expect(interactionGraphNodeCount(graph)).toBe(3);
    expect(interactionGraphEdgeCount(graph)).toBe(2);
  });
});

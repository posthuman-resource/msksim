import { describe, it, expect } from 'vitest';
import { NetworkTopology } from './network';
import { createRNG } from '../rng';

function triangle(): NetworkTopology {
  const adj = new Map<number, number[]>([
    [0, [1, 2]],
    [1, [0, 2]],
    [2, [0, 1]],
  ]);
  return NetworkTopology.fromAdjacencyMap(adj);
}

function fakeRng() {
  return createRNG(42);
}

describe('NetworkTopology', () => {
  it('fromAdjacencyMap on triangle: neighbors(0) === [1, 2]', () => {
    const t = triangle();
    const ns = [...t.neighbors(0, fakeRng())].sort((a, b) => a - b);
    expect(ns).toEqual([1, 2]);
  });

  it('fromAdjacencyMap on triangle: neighbors(1) === [0, 2]', () => {
    const t = triangle();
    const ns = [...t.neighbors(1, fakeRng())].sort((a, b) => a - b);
    expect(ns).toEqual([0, 2]);
  });

  it('fromAdjacencyMap on triangle: neighbors(2) === [0, 1]', () => {
    const t = triangle();
    const ns = [...t.neighbors(2, fakeRng())].sort((a, b) => a - b);
    expect(ns).toEqual([0, 1]);
  });

  it('pickNeighbor returns a valid neighbor', () => {
    const t = triangle();
    const rng = createRNG(100);
    const result = t.pickNeighbor(0, rng);
    expect([1, 2]).toContain(result);
  });

  it('pickNeighbor is deterministic with same seed', () => {
    const tA = triangle();
    const tB = triangle();
    const rngA = createRNG(200);
    const rngB = createRNG(200);
    expect(tA.pickNeighbor(0, rngA)).toEqual(tB.pickNeighbor(0, rngB));
  });

  it('isolated node returns null from pickNeighbor', () => {
    const adj = new Map<number, number[]>([
      [0, [1]],
      [1, [0]],
      [2, []], // isolated
    ]);
    const t = NetworkTopology.fromAdjacencyMap(adj);
    expect(t.pickNeighbor(2, fakeRng())).toBeNull();
  });

  it('adjacency() yields every undirected edge exactly once', () => {
    const t = triangle();
    const edges = [...t.adjacency()];
    expect(edges).toHaveLength(3);
    const edgeSet = new Set(edges.map(([a, b]) => [Math.min(a, b), Math.max(a, b)].join(',')));
    expect(edgeSet.has('0,1')).toBe(true);
    expect(edgeSet.has('0,2')).toBe(true);
    expect(edgeSet.has('1,2')).toBe(true);
  });

  it("kind === 'network' and size matches graphology order", () => {
    const t = triangle();
    expect(t.kind).toBe('network');
    expect(t.size).toBe(3);
  });
});

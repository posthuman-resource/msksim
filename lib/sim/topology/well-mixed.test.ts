import { describe, it, expect } from 'vitest';
import { WellMixedTopology } from './well-mixed';
import { createRNG } from '../rng';

function fakeRng() {
  return createRNG(42);
}

describe('WellMixedTopology', () => {
  it('neighbors(3) yields exactly 9 positions, none being 3', () => {
    const t = new WellMixedTopology(10);
    const ns = [...t.neighbors(3, fakeRng())];
    expect(ns).toHaveLength(9);
    expect(ns.includes(3)).toBe(false);
  });

  it('pickNeighbor(3, rng) never returns 3 over 1000 calls', () => {
    const t = new WellMixedTopology(10);
    const rng = createRNG(99);
    for (let i = 0; i < 1000; i++) {
      expect(t.pickNeighbor(3, rng)).not.toBe(3);
    }
  });

  it('pickNeighbor covers every other position given 1000 trials', () => {
    const t = new WellMixedTopology(10);
    const rng = createRNG(77);
    const seen = new Set<number>();
    for (let i = 0; i < 1000; i++) {
      const r = t.pickNeighbor(3, rng);
      if (r !== null) seen.add(r);
    }
    expect(seen).toEqual(new Set([0, 1, 2, 4, 5, 6, 7, 8, 9]));
  });

  it('pickNeighbor is deterministic with same seed', () => {
    const t = new WellMixedTopology(10);
    const rngA = createRNG(555);
    const rngB = createRNG(555);
    for (let i = 0; i < 20; i++) {
      expect(t.pickNeighbor(0, rngA)).toEqual(t.pickNeighbor(0, rngB));
    }
  });

  it('WellMixedTopology(1).pickNeighbor returns null', () => {
    const t = new WellMixedTopology(1);
    expect(t.pickNeighbor(0, fakeRng())).toBeNull();
  });

  it('WellMixedTopology(0) throws on construction', () => {
    expect(() => new WellMixedTopology(0)).toThrow();
  });

  it("kind === 'well-mixed' and size matches constructor argument", () => {
    const t = new WellMixedTopology(50);
    expect(t.kind).toBe('well-mixed');
    expect(t.size).toBe(50);
  });
});

import { describe, it, expect } from 'vitest';
import { LatticeTopology } from './lattice';
import { createRNG } from '../rng';

function fakeRng() {
  return createRNG(42);
}

describe('LatticeTopology', () => {
  // Helper: convert sorted number array to set of (x,y) strings using a given lattice
  function toCoords(lattice: LatticeTopology, indices: number[]): Set<string> {
    return new Set(indices.map((i) => lattice.indexToXY(i).join(',')));
  }

  it('3×3 Moore interior cell has 8 neighbors', () => {
    const t = new LatticeTopology(3, 3, 'moore');
    const pos = t.xyToIndex(1, 1);
    const ns = [...t.neighbors(pos, fakeRng())];
    expect(ns).toHaveLength(8);
    const expected = new Set(['0,0', '1,0', '2,0', '0,1', '2,1', '0,2', '1,2', '2,2']);
    expect(toCoords(t, ns)).toEqual(expected);
  });

  it('3×3 Moore corner cell has 3 neighbors', () => {
    const t = new LatticeTopology(3, 3, 'moore');
    const pos = t.xyToIndex(0, 0);
    const ns = [...t.neighbors(pos, fakeRng())];
    expect(ns).toHaveLength(3);
    const expected = new Set(['1,0', '0,1', '1,1']);
    expect(toCoords(t, ns)).toEqual(expected);
  });

  it('3×3 Moore edge cell has 5 neighbors', () => {
    const t = new LatticeTopology(3, 3, 'moore');
    const pos = t.xyToIndex(0, 1); // left-middle
    const ns = [...t.neighbors(pos, fakeRng())];
    expect(ns).toHaveLength(5);
    const expected = new Set(['0,0', '1,0', '1,1', '0,2', '1,2']);
    expect(toCoords(t, ns)).toEqual(expected);
  });

  it('3×3 Von Neumann interior cell has 4 neighbors', () => {
    const t = new LatticeTopology(3, 3, 'von-neumann');
    const pos = t.xyToIndex(1, 1);
    const ns = [...t.neighbors(pos, fakeRng())];
    expect(ns).toHaveLength(4);
    const expected = new Set(['1,0', '0,1', '2,1', '1,2']);
    expect(toCoords(t, ns)).toEqual(expected);
  });

  it('3×3 Von Neumann corner cell has 2 neighbors', () => {
    const t = new LatticeTopology(3, 3, 'von-neumann');
    const pos = t.xyToIndex(0, 0);
    const ns = [...t.neighbors(pos, fakeRng())];
    expect(ns).toHaveLength(2);
    const expected = new Set(['1,0', '0,1']);
    expect(toCoords(t, ns)).toEqual(expected);
  });

  it('3×3 Von Neumann edge cell has 3 neighbors', () => {
    const t = new LatticeTopology(3, 3, 'von-neumann');
    const pos = t.xyToIndex(0, 1); // left-middle
    const ns = [...t.neighbors(pos, fakeRng())];
    expect(ns).toHaveLength(3);
    const expected = new Set(['0,0', '1,1', '0,2']);
    expect(toCoords(t, ns)).toEqual(expected);
  });

  it('toroidal Moore lattice wraps: (0,0) has 8 neighbors including (2,2)', () => {
    const t = new LatticeTopology(3, 3, 'moore', true);
    const pos = t.xyToIndex(0, 0);
    const ns = [...t.neighbors(pos, fakeRng())];
    expect(ns).toHaveLength(8);
    const coords = toCoords(t, ns);
    expect(coords.has('2,2')).toBe(true);
  });

  it('toroidal Von Neumann lattice wraps: (0,0) has 4 neighbors including (2,0)', () => {
    const t = new LatticeTopology(3, 3, 'von-neumann', true);
    const pos = t.xyToIndex(0, 0);
    const ns = [...t.neighbors(pos, fakeRng())];
    expect(ns).toHaveLength(4);
    const coords = toCoords(t, ns);
    expect(coords.has('2,0')).toBe(true);
  });

  it('pickNeighbor is deterministic given the same RNG seed', () => {
    const tA = new LatticeTopology(5, 5, 'moore');
    const tB = new LatticeTopology(5, 5, 'moore');
    const rngA = createRNG(1234);
    const rngB = createRNG(1234);
    const pos = tA.xyToIndex(2, 2);
    expect(tA.pickNeighbor(pos, rngA)).toEqual(tB.pickNeighbor(pos, rngB));
  });

  it('pickNeighbor returns null for a 1×1 lattice', () => {
    const t = new LatticeTopology(1, 1, 'moore');
    expect(t.pickNeighbor(0, fakeRng())).toBeNull();
  });

  it('indexToXY and xyToIndex roundtrip on a 3×4 lattice', () => {
    const t = new LatticeTopology(3, 4, 'moore');
    for (let i = 0; i < 12; i++) {
      expect(t.xyToIndex(...t.indexToXY(i))).toBe(i);
    }
  });

  it("kind === 'lattice' and size === width * height", () => {
    const t = new LatticeTopology(4, 5, 'moore');
    expect(t.kind).toBe('lattice');
    expect(t.size).toBe(20);
  });
});

describe('LatticeTopology spatial (step 34)', () => {
  // Test 10: distance is Manhattan over open boundaries.
  it('distance returns Manhattan distance', () => {
    const t = new LatticeTopology(5, 5, 'moore');
    expect(t.spatial.distance(0, 24)).toBe(8); // (0,0) → (4,4)
    expect(t.spatial.distance(0, 4)).toBe(4); // (0,0) → (4,0)
    expect(t.spatial.distance(12, 12)).toBe(0); // (2,2) → (2,2)
  });

  // Test 11: stepToward traces lex-greedy path; reaches target in 8 steps.
  it('stepToward picks east first from (0,0) toward (4,4) and reaches target in 8 steps', () => {
    const t = new LatticeTopology(5, 5, 'moore');
    const start = t.xyToIndex(0, 0);
    const target = t.xyToIndex(4, 4);

    expect(t.spatial.stepToward(start, target)).toBe(t.xyToIndex(1, 0));

    let cur = start;
    for (let i = 0; i < 8; i++) {
      const next = t.spatial.stepToward(cur, target);
      expect(next).not.toBeNull();
      cur = next!;
    }
    expect(cur).toBe(target);
    // At target → no further improving move.
    expect(t.spatial.stepToward(cur, target)).toBeNull();
  });

  // Test 12: stepAwayFrom returns null at corner-with-no-farther-neighbor; returns
  // axial-opposite for non-corner cases.
  it('stepAwayFrom returns null at corner with no farther neighbor; otherwise axial-opposite', () => {
    const t = new LatticeTopology(5, 5, 'moore');
    // From (0,0) toward (4,4): every in-bounds neighbor is closer to (4,4).
    expect(t.spatial.stepAwayFrom(t.xyToIndex(0, 0), t.xyToIndex(4, 4))).toBeNull();

    // From (2,2) toward (3,3): axial-opposite is west (1,2)=11.
    expect(t.spatial.stepAwayFrom(t.xyToIndex(2, 2), t.xyToIndex(3, 3))).toBe(t.xyToIndex(1, 2));

    // From (2,2) toward (3,2): axial-opposite west (1,2)=11.
    expect(t.spatial.stepAwayFrom(t.xyToIndex(2, 2), t.xyToIndex(3, 2))).toBe(t.xyToIndex(1, 2));
  });
});

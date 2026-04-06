import { describe, it, expect } from 'vitest';
import { createTopology } from './factory';
import { LatticeTopology } from './lattice';
import { WellMixedTopology } from './well-mixed';
import { createRNG } from '../rng';

function rng() {
  return createRNG(0);
}

describe('createTopology', () => {
  it('lattice 5×5 Moore returns LatticeTopology with size 25', () => {
    const t = createTopology(
      { type: 'lattice', width: 5, height: 5, neighborhood: 'moore' },
      rng(),
    );
    expect(t).toBeInstanceOf(LatticeTopology);
    expect(t.kind).toBe('lattice');
    expect(t.size).toBe(25);
  });

  it('lattice 4×3 Von Neumann returns LatticeTopology with size 12', () => {
    const t = createTopology(
      { type: 'lattice', width: 4, height: 3, neighborhood: 'von-neumann' },
      rng(),
    );
    expect(t).toBeInstanceOf(LatticeTopology);
    expect(t.size).toBe(12);
  });

  it('well-mixed with size 50 returns WellMixedTopology', () => {
    const t = createTopology({ type: 'well-mixed' }, rng(), 50);
    expect(t).toBeInstanceOf(WellMixedTopology);
    expect(t.kind).toBe('well-mixed');
    expect(t.size).toBe(50);
  });

  it('well-mixed without size throws', () => {
    expect(() => createTopology({ type: 'well-mixed' }, rng())).toThrow();
  });

  it('network throws with descriptive error (v1 stub boundary)', () => {
    expect(() =>
      createTopology({ type: 'network', kind: 'small-world', parameters: {} }, rng()),
    ).toThrow(/network topology v1/);
  });

  // Type-level exhaustiveness check: the factory uses `const _exhaustive: never = config`
  // at the end of its switch statement. If a new variant is added to TopologyConfig
  // without a corresponding case in createTopology(), TypeScript will emit a compile
  // error ("Type 'X' is not assignable to type 'never'") before any test runs.
  // This invariant is enforced by the compiler, not at runtime.
});

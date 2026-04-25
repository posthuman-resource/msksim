import { describe, it, expect } from 'vitest';

import { cartesianProduct } from './cartesian-product';

describe('cartesianProduct', () => {
  it('returns [[]] for empty axes (empty-product convention)', () => {
    expect(cartesianProduct([])).toEqual([[]]);
  });

  it('returns 1-tuples for a single axis', () => {
    expect(cartesianProduct([[1, 2, 3]])).toEqual([[1], [2], [3]]);
  });

  it('produces the 2x2 grid used by the MCP example sweep', () => {
    expect(
      cartesianProduct<number | boolean>([
        [0.3, 0.6],
        [true, false],
      ]),
    ).toEqual([
      [0.3, true],
      [0.3, false],
      [0.6, true],
      [0.6, false],
    ]);
  });

  it('produces the 2x3 grid in the documented order', () => {
    expect(
      cartesianProduct<number | string>([
        [1, 2],
        ['a', 'b', 'c'],
      ]),
    ).toEqual([
      [1, 'a'],
      [1, 'b'],
      [1, 'c'],
      [2, 'a'],
      [2, 'b'],
      [2, 'c'],
    ]);
  });

  it('produces the 2x2x2 grid in the documented order', () => {
    const out = cartesianProduct([
      [1, 2],
      [3, 4],
      [5, 6],
    ]);
    expect(out).toHaveLength(8);
    expect(out).toEqual([
      [1, 3, 5],
      [1, 3, 6],
      [1, 4, 5],
      [1, 4, 6],
      [2, 3, 5],
      [2, 3, 6],
      [2, 4, 5],
      [2, 4, 6],
    ]);
  });

  it('returns [] when any axis is empty', () => {
    expect(cartesianProduct([[1, 2], []])).toEqual([]);
  });

  it('handles 100-cell products quickly', () => {
    const range10 = Array.from({ length: 10 }, (_, i) => i);
    const start = performance.now();
    const out = cartesianProduct([range10, range10]);
    const elapsed = performance.now() - start;
    expect(out).toHaveLength(100);
    expect(elapsed).toBeLessThan(50);
  });

  it('handles mixed-type axes through the generic signature', () => {
    const out = cartesianProduct<number | boolean | string>([[1, 2], [true], ['a']]);
    expect(out).toEqual([
      [1, true, 'a'],
      [2, true, 'a'],
    ]);
  });
});

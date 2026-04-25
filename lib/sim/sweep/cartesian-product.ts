// Pure cartesian-product helper. Used by step 28's parameter sweep to expand
// a list of N axes (each an array of values) into a flat list of N-tuples.
//
// Pure function — no I/O, no React, no server-only imports. Safe to import
// from Client Components and from the worker context alike.

/**
 * Compute the cartesian product of N axes.
 *
 * Returns the empty product `[[]]` (a single empty tuple) when `axes` is empty,
 * matching the mathematical convention that the product of zero sets is the
 * one-element set containing the empty tuple. Returns `[]` when any axis is
 * empty (any empty factor collapses the whole product).
 *
 * Time and space complexity are both O(∏|axes|).
 */
export function cartesianProduct<T>(axes: readonly (readonly T[])[]): T[][] {
  if (axes.length === 0) return [[]];
  return axes.reduce<T[][]>(
    (acc, currentAxis) => acc.flatMap((prefix) => currentAxis.map((value) => [...prefix, value])),
    [[]],
  );
}

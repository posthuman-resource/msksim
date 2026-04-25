import type { RNG } from '../rng';
import type { SpatialOps, Topology, TopologyKind } from '../topology';
import type { NeighborhoodType } from '@/lib/schema/topology';

// Moore neighborhood: 8-cell (3×3 minus center)
const MOORE_OFFSETS: ReadonlyArray<readonly [number, number]> = [
  [-1, -1],
  [0, -1],
  [1, -1],
  [-1, 0],
  [1, 0],
  [-1, 1],
  [0, 1],
  [1, 1],
];

// Von Neumann neighborhood: 4-cell (orthogonal only)
const VON_NEUMANN_OFFSETS: ReadonlyArray<readonly [number, number]> = [
  [0, -1],
  [-1, 0],
  [1, 0],
  [0, 1],
];

/**
 * 2D rectangular lattice topology.
 *
 * Positions are row-major integer indices in [0, width * height).
 *   index = y * width + x
 *
 * Default boundaries are open (non-toroidal): cells on corners and edges
 * have fewer neighbors than interior cells. Pass toroidal=true for
 * periodic (wrapping) boundaries.
 *
 * See docs/plan/10-topology-implementations.md §4 for the design rationale
 * behind choosing open boundaries as the default.
 */
export class LatticeTopology implements Topology {
  readonly kind: TopologyKind = 'lattice';
  readonly size: number;

  private readonly _width: number;
  private readonly _height: number;
  private readonly _neighborhood: NeighborhoodType;
  private readonly _toroidal: boolean;
  private readonly _offsets: ReadonlyArray<readonly [number, number]>;

  constructor(width: number, height: number, neighborhood: NeighborhoodType, toroidal = false) {
    this._width = width;
    this._height = height;
    this._neighborhood = neighborhood;
    this._toroidal = toroidal;
    this.size = width * height;
    this._offsets = neighborhood === 'moore' ? MOORE_OFFSETS : VON_NEUMANN_OFFSETS;
  }

  get width(): number {
    return this._width;
  }
  get height(): number {
    return this._height;
  }
  get neighborhood(): NeighborhoodType {
    return this._neighborhood;
  }
  get toroidal(): boolean {
    return this._toroidal;
  }

  indexToXY(index: number): [number, number] {
    return [index % this._width, Math.floor(index / this._width)];
  }

  xyToIndex(x: number, y: number): number {
    return y * this._width + x;
  }

  neighbors(position: number, _rng: RNG): number[] {
    const [x, y] = this.indexToXY(position);
    const result: number[] = [];

    for (const [dx, dy] of this._offsets) {
      let nx = x + dx;
      let ny = y + dy;

      if (this._toroidal) {
        nx = ((nx % this._width) + this._width) % this._width;
        ny = ((ny % this._height) + this._height) % this._height;
      } else {
        if (nx < 0 || nx >= this._width || ny < 0 || ny >= this._height) {
          continue;
        }
      }

      result.push(this.xyToIndex(nx, ny));
    }

    return result;
  }

  pickNeighbor(position: number, rng: RNG): number | null {
    const ns = this.neighbors(position, rng);
    if (ns.length === 0) return null;
    return rng.pick(ns);
  }

  *adjacency(): Iterable<[number, number]> {
    // Dummy RNG — neighbors() ignores rng for the lattice, but the interface requires it
    const dummyRng = {
      nextInt: () => 0,
      nextFloat: () => 0,
      pick: <T>(a: T[]) => a[0],
      pickWeighted: <T>(a: T[]) => a[0],
      shuffle: <T>(a: readonly T[]) => [...a],
    } as RNG;
    for (let i = 0; i < this.size; i++) {
      for (const j of this.neighbors(i, dummyRng)) {
        if (j > i) yield [i, j];
      }
    }
  }

  // ─── Spatial capability (step 34) ──────────────────────────────────────────
  // Manhattan distance and Von-Neumann (axis-aligned) single-cell moves.
  // Open boundaries: corner/edge cells have fewer in-bounds neighbors. With
  // toroidal=true the modular arithmetic in neighbors() wraps positions, but
  // distance/stepToward/stepAwayFrom intentionally use the open-boundary
  // metric so that "step toward a partner across the wrap" never traverses
  // a boundary the renderer doesn't draw. Documented in CLAUDE.md gotchas.
  //
  // Direction lex order: N (y-1), E (x+1), S (y+1), W (x-1).
  // stepToward picks the lex-first neighbor that strictly decreases distance.
  // stepAwayFrom prefers the cell directly opposite the target's displacement
  // (PDF page 4: "two steps backward or farther away from each other"), then
  // falls back to lex order over neighbors that strictly increase distance.

  readonly spatial: SpatialOps = {
    distance: (a, b) => {
      const [ax, ay] = this.indexToXY(a);
      const [bx, by] = this.indexToXY(b);
      return Math.abs(ax - bx) + Math.abs(ay - by);
    },
    stepToward: (from, target) => this.stepInDirection(from, target, +1),
    stepAwayFrom: (from, target) => this.stepInDirection(from, target, -1),
  };

  /**
   * Shared core for stepToward / stepAwayFrom.
   *   sign === +1 => move toward target (decrease distance).
   *   sign === -1 => move away from target (increase distance).
   *
   * Builds candidates in priority order:
   *   1. The axial cell in the direction sign·sign(target-from) for x.
   *   2. The axial cell in the direction sign·sign(target-from) for y.
   *   3. Lex N, E, S, W as fallback.
   * Returns the first in-bounds candidate that satisfies the desired
   * distance change; deduplicates so each cell is checked at most once.
   */
  private stepInDirection(from: number, target: number, sign: 1 | -1): number | null {
    const [fx, fy] = this.indexToXY(from);
    const [tx, ty] = this.indexToXY(target);
    const fromDist = Math.abs(fx - tx) + Math.abs(fy - ty);

    const dirX = sign * Math.sign(tx - fx);
    const dirY = sign * Math.sign(ty - fy);

    const ordered: Array<readonly [number, number]> = [];
    if (dirX !== 0) ordered.push([fx + dirX, fy]);
    if (dirY !== 0) ordered.push([fx, fy + dirY]);
    // Lex fallback N, E, S, W.
    ordered.push([fx, fy - 1]);
    ordered.push([fx + 1, fy]);
    ordered.push([fx, fy + 1]);
    ordered.push([fx - 1, fy]);

    const seen = new Set<number>();
    for (const [nx, ny] of ordered) {
      if (nx < 0 || nx >= this._width || ny < 0 || ny >= this._height) continue;
      const idx = this.xyToIndex(nx, ny);
      if (seen.has(idx)) continue;
      seen.add(idx);
      const newDist = Math.abs(nx - tx) + Math.abs(ny - ty);
      if (sign === 1 ? newDist < fromDist : newDist > fromDist) {
        return idx;
      }
    }
    return null;
  }
}

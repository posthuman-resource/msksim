import type { RNG } from "../rng";
import type { Topology, TopologyKind } from "../topology";
import type { NeighborhoodType } from "@/lib/schema/topology";

// Moore neighborhood: 8-cell (3×3 minus center)
const MOORE_OFFSETS: ReadonlyArray<readonly [number, number]> = [
  [-1, -1], [0, -1], [1, -1],
  [-1,  0],          [1,  0],
  [-1,  1], [0,  1], [1,  1],
];

// Von Neumann neighborhood: 4-cell (orthogonal only)
const VON_NEUMANN_OFFSETS: ReadonlyArray<readonly [number, number]> = [
             [0, -1],
  [-1,  0],          [1,  0],
             [0,  1],
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
  readonly kind: TopologyKind = "lattice";
  readonly size: number;

  private readonly _width: number;
  private readonly _height: number;
  private readonly _neighborhood: NeighborhoodType;
  private readonly _toroidal: boolean;
  private readonly _offsets: ReadonlyArray<readonly [number, number]>;

  constructor(
    width: number,
    height: number,
    neighborhood: NeighborhoodType,
    toroidal = false,
  ) {
    this._width = width;
    this._height = height;
    this._neighborhood = neighborhood;
    this._toroidal = toroidal;
    this.size = width * height;
    this._offsets =
      neighborhood === "moore" ? MOORE_OFFSETS : VON_NEUMANN_OFFSETS;
  }

  get width(): number { return this._width; }
  get height(): number { return this._height; }
  get neighborhood(): NeighborhoodType { return this._neighborhood; }
  get toroidal(): boolean { return this._toroidal; }

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
}

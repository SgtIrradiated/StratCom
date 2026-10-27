/**
 * Uniform grid hash over entity positions, rebuilt each tick with a counting sort. Entities
 * within a bucket are stored in ascending slot order, so neighbour iteration is
 * deterministic.
 */
export class SpatialGrid {
  readonly cols: number;
  readonly rows: number;
  /** `start[b] … start[b + 1]` index into `items` for bucket `b`. */
  private readonly start: Int32Array;
  private items = new Int32Array(0);

  constructor(
    width: number,
    depth: number,
    readonly cellSize: number,
  ) {
    this.cols = Math.max(1, Math.ceil(width / cellSize));
    this.rows = Math.max(1, Math.ceil(depth / cellSize));
    this.start = new Int32Array(this.cols * this.rows + 1);
  }

  private bucket(x: number, z: number): number {
    const c = Math.min(Math.max(Math.floor(x / this.cellSize), 0), this.cols - 1);
    const r = Math.min(Math.max(Math.floor(z / this.cellSize), 0), this.rows - 1);
    return r * this.cols + c;
  }

  /** Rebuilds the grid from the live slots `0 … highWater` where `alive[i] === 1`. */
  rebuild(
    highWater: number,
    alive: Uint8Array,
    x: Float64Array,
    z: Float64Array,
    scratch: Int32Array,
  ): void {
    this.start.fill(0);
    let live = 0;
    for (let i = 0; i < highWater; i++) {
      if (alive[i] === 0) continue;
      const b = this.bucket(x[i] ?? 0, z[i] ?? 0);
      scratch[i] = b;
      this.start[b + 1] = (this.start[b + 1] ?? 0) + 1;
      live++;
    }
    for (let b = 0; b < this.cols * this.rows; b++) {
      this.start[b + 1] = (this.start[b + 1] ?? 0) + (this.start[b] ?? 0);
    }
    if (this.items.length < live) this.items = new Int32Array(live + 1024);
    const fill = this.start.slice(0, this.cols * this.rows);
    for (let i = 0; i < highWater; i++) {
      if (alive[i] === 0) continue;
      const b = scratch[i] ?? 0;
      const at = fill[b] ?? 0;
      this.items[at] = i;
      fill[b] = at + 1;
    }
  }

  /**
   * Calls `visit(slot)` for every entity in the 3×3 buckets around (`x`, `z`), in a fixed
   * order. Pass a query radius no larger than `cellSize`.
   */
  forNeighbours(x: number, z: number, visit: (slot: number) => void): void {
    const c0 = Math.min(Math.max(Math.floor(x / this.cellSize), 0), this.cols - 1);
    const r0 = Math.min(Math.max(Math.floor(z / this.cellSize), 0), this.rows - 1);
    for (let r = Math.max(r0 - 1, 0); r <= Math.min(r0 + 1, this.rows - 1); r++) {
      for (let c = Math.max(c0 - 1, 0); c <= Math.min(c0 + 1, this.cols - 1); c++) {
        const b = r * this.cols + c;
        for (let k = this.start[b] ?? 0; k < (this.start[b + 1] ?? 0); k++) {
          visit(this.items[k] ?? 0);
        }
      }
    }
  }

  /**
   * Calls `visit(slot)` once for every entity in the buckets that overlap the square around
   * (`x`, `z`) with half-size `radius`, row by row, then in ascending slot order within a
   * bucket. Any radius works. The visited set is a superset of the entities within `radius`:
   * callers test the exact distance.
   */
  forEachNear(x: number, z: number, radius: number, visit: (slot: number) => void): void {
    const cs = this.cellSize;
    const c0 = Math.max(Math.floor((x - radius) / cs), 0);
    const c1 = Math.min(Math.floor((x + radius) / cs), this.cols - 1);
    const r0 = Math.max(Math.floor((z - radius) / cs), 0);
    const r1 = Math.min(Math.floor((z + radius) / cs), this.rows - 1);
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const b = r * this.cols + c;
        for (let k = this.start[b] ?? 0; k < (this.start[b + 1] ?? 0); k++) {
          visit(this.items[k] ?? 0);
        }
      }
    }
  }
}

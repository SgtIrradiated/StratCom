import type { SimContext } from "../context";
import { EntityKind } from "../ecs/world";
import { SpatialGrid } from "../spatialGrid";

/** Spatial-hash bucket size; must be at least the largest pair radius sum. */
const SEPARATION_CELL = 16;
/** Fraction of an overlap resolved per tick. */
const SEPARATION_STIFFNESS = 0.5;

/**
 * Pushes overlapping units apart using the spatial hash (docs/PLAN.md §4.4 step 4). Two
 * mobile units each take half of the overlap; a mobile unit against a structure takes all of
 * it, and structures never move. Features take no part.
 */
export class SeparationSystem {
  private readonly spatial: SpatialGrid;
  private readonly bucketScratch: Int32Array;
  private readonly sepX: Float64Array;
  private readonly sepZ: Float64Array;

  constructor(private readonly ctx: SimContext) {
    this.spatial = new SpatialGrid(ctx.width, ctx.depth, SEPARATION_CELL);
    this.bucketScratch = new Int32Array(ctx.capacity);
    this.sepX = new Float64Array(ctx.capacity);
    this.sepZ = new Float64Array(ctx.capacity);
  }

  /** Computes every push from the same positions, then applies them. */
  run(): void {
    const ctx = this.ctx;
    const w = ctx.world;
    const types = ctx.rules.units;
    this.spatial.rebuild(w.highWater, w.alive, w.x, w.z, this.bucketScratch);
    for (let i = 0; i < w.highWater; i++) {
      this.sepX[i] = 0;
      this.sepZ[i] = 0;
      if (w.alive[i] === 0 || w.kind[i] === EntityKind.feature) continue;
      const ti = types[w.type[i] ?? 0];
      if (ti?.mobile === false) continue;
      const ri = ti?.radius ?? 1;
      const xi = w.x[i] ?? 0;
      const zi = w.z[i] ?? 0;
      let px = 0;
      let pz = 0;
      this.spatial.forNeighbours(xi, zi, (j) => {
        if (j === i || w.kind[j] === EntityKind.feature) return;
        const tj = types[w.type[j] ?? 0];
        const reach = ri + (tj?.radius ?? 1);
        const dx = xi - (w.x[j] ?? 0);
        const dz = zi - (w.z[j] ?? 0);
        const d2 = dx * dx + dz * dz;
        if (d2 >= reach * reach) return;
        const share = tj?.mobile === false ? 1 : 0.5;
        if (d2 === 0) {
          // Exactly stacked: split along x, with opposite signs for the pair.
          px += (i < j ? 1 : -1) * reach * share;
          return;
        }
        const d = Math.sqrt(d2);
        const push = ((reach - d) * share) / d;
        px += dx * push;
        pz += dz * push;
      });
      this.sepX[i] = px * SEPARATION_STIFFNESS;
      this.sepZ[i] = pz * SEPARATION_STIFFNESS;
    }
    for (let i = 0; i < w.highWater; i++) {
      if (w.alive[i] === 0) continue;
      const sx = this.sepX[i] ?? 0;
      const sz = this.sepZ[i] ?? 0;
      if (sx !== 0 || sz !== 0) ctx.tryMove(i, (w.x[i] ?? 0) + sx, (w.z[i] ?? 0) + sz);
    }
  }
}

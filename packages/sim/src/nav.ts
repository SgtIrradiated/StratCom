import {
  buildNavGrid,
  cellAt,
  computeFlowCosts,
  nearestPassable,
  type FlowField,
  type NavGrid,
} from "./navigation";
import type { Footprint } from "./placement";
import type { MovementClassDef } from "./rules";
import type { Terrain } from "./terrain";

/** Most work-order flow fields kept for reuse. */
const FIELD_CACHE_LIMIT = 32;

/**
 * Navigation state shared by every system: one passability grid per movement class, the
 * structure occupancy grid, and flow fields. Structures change the grids through
 * {@link markFootprint}; that bumps {@link version}, and fields computed against an older
 * version are recomputed lazily by {@link refreshField}.
 *
 * Nothing here is hashed: it is all derived from the world (structure positions) and from
 * the orders that hold the fields.
 */
export class NavState {
  readonly grids: readonly NavGrid[];
  /** Terrain-only passability per movement class, to restore cells structures free up. */
  private readonly baseNav: readonly Uint8Array[];
  /** Bumped whenever a structure changes the grids; stale flow fields are recomputed. */
  private version = 0;
  /** Structure slot + 1 per terrain cell, 0 where free. Indexed like the nav grids. */
  readonly occupied: Int32Array;
  private readonly fieldCache = new Map<number, FlowField>();
  private readonly gridCols: number;
  private readonly gridRows: number;

  constructor(terrain: Terrain, movementClasses: readonly MovementClassDef[]) {
    this.grids = movementClasses.map((m) => buildNavGrid(terrain, m.maxSlope));
    this.baseNav = this.grids.map((g) => g.passable.slice());
    this.gridCols = terrain.cols - 1;
    this.gridRows = terrain.rows - 1;
    this.occupied = new Int32Array(this.gridCols * this.gridRows);
  }

  /** A flow field toward (`x`, `z`), or the centre of the nearest open cell if it is blocked. */
  makeField(movementClass: number, x: number, z: number): FlowField | undefined {
    const grid = this.grids[movementClass];
    if (!grid) return undefined;
    const goalCell = nearestPassable(grid, cellAt(grid, x, z));
    if (goalCell < 0) return undefined;
    // If the requested point was blocked, aim at the centre of the nearest open cell.
    const open = goalCell === cellAt(grid, x, z);
    const gx = open ? x : ((goalCell % grid.cols) + 0.5) * grid.cellSize;
    const gz = open ? z : (Math.floor(goalCell / grid.cols) + 0.5) * grid.cellSize;
    return {
      movementClass,
      goalCell,
      goalX: gx,
      goalZ: gz,
      cost: computeFlowCosts(grid, goalCell),
      version: this.version,
    };
  }

  /** A shared field toward the open cell nearest `cell`, for work orders. */
  workField(movementClass: number, cell: number): FlowField | undefined {
    const grid = this.grids[movementClass];
    if (!grid) return undefined;
    const key = movementClass * grid.cols * grid.rows + cell;
    const cached = this.fieldCache.get(key);
    if (cached) return cached;
    const goalCell = nearestPassable(grid, cell);
    if (goalCell < 0) return undefined;
    const field: FlowField = {
      movementClass,
      goalCell,
      goalX: ((goalCell % grid.cols) + 0.5) * grid.cellSize,
      goalZ: (Math.floor(goalCell / grid.cols) + 0.5) * grid.cellSize,
      cost: computeFlowCosts(grid, goalCell),
      version: this.version,
    };
    // Map iteration follows insertion order, so eviction is deterministic (and the cache
    // only saves work: a cached field equals a freshly computed one).
    if (this.fieldCache.size >= FIELD_CACHE_LIMIT) {
      const oldest = this.fieldCache.keys().next();
      if (oldest.done !== true) this.fieldCache.delete(oldest.value);
    }
    this.fieldCache.set(key, field);
    return field;
  }

  /** Recomputes a field after structures changed its grid. */
  refreshField(field: FlowField): void {
    if (field.version === this.version) return;
    const grid = this.grids[field.movementClass];
    if (!grid) return;
    const goal = nearestPassable(grid, field.goalCell);
    if (goal >= 0 && goal !== field.goalCell) {
      field.goalCell = goal;
      field.goalX = ((goal % grid.cols) + 0.5) * grid.cellSize;
      field.goalZ = (Math.floor(goal / grid.cols) + 0.5) * grid.cellSize;
    }
    field.cost = computeFlowCosts(grid, field.goalCell);
    field.version = this.version;
  }

  /** Marks (or frees) structure slot `i`'s cells in the occupancy and navigation grids. */
  markFootprint(fp: Footprint, i: number, occupy: boolean): void {
    const { gridCols, gridRows } = this;
    for (let r = Math.max(fp.row, 0); r < Math.min(fp.row + fp.rows, gridRows); r++) {
      for (let c = Math.max(fp.col, 0); c < Math.min(fp.col + fp.cols, gridCols); c++) {
        const cell = r * gridCols + c;
        this.occupied[cell] = occupy ? i + 1 : 0;
        this.grids.forEach((g, k) => {
          g.passable[cell] = occupy ? 0 : (this.baseNav[k]?.[cell] ?? 0);
        });
      }
    }
    this.version++;
    this.fieldCache.clear();
  }

  /** The structure slot covering terrain cell (`col`, `row`), or -1. */
  structureAt(col: number, row: number): number {
    return (this.occupied[row * this.gridCols + col] ?? 0) - 1;
  }

  /**
   * A unit caught inside a structure's footprint (it was placed on top of it) heads for the
   * nearest open cell. Undefined anywhere else.
   */
  escapeDirection(grid: NavGrid, x: number, z: number): { dx: number; dz: number } | undefined {
    const cell = cellAt(grid, x, z);
    if (this.occupied[cell] === 0) return undefined;
    const open = nearestPassable(grid, cell);
    if (open < 0) return undefined;
    return {
      dx: ((open % grid.cols) + 0.5) * grid.cellSize - x,
      dz: (Math.floor(open / grid.cols) + 0.5) * grid.cellSize - z,
    };
  }
}

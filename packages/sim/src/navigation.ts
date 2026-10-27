import { assert } from "@stratcom/shared";
import type { Terrain } from "./terrain";

/** A passability grid for one movement class. One entry per terrain cell. */
export interface NavGrid {
  cols: number;
  rows: number;
  cellSize: number;
  /** 1 where the cell can be entered, 0 where it is blocked. */
  passable: Uint8Array;
}

/** Cost value for cells the goal cannot be reached from. */
export const UNREACHABLE = 0x7fffffff;

const ORTHOGONAL_COST = 10;
const DIAGONAL_COST = 14;

/** Neighbour offsets in a fixed order; ties in path choice always resolve in this order. */
export const NEIGHBOURS: readonly (readonly [number, number, number])[] = [
  [0, -1, ORTHOGONAL_COST],
  [1, 0, ORTHOGONAL_COST],
  [0, 1, ORTHOGONAL_COST],
  [-1, 0, ORTHOGONAL_COST],
  [1, -1, DIAGONAL_COST],
  [1, 1, DIAGONAL_COST],
  [-1, 1, DIAGONAL_COST],
  [-1, -1, DIAGONAL_COST],
];

const DC = Int8Array.from(NEIGHBOURS, (n) => n[0]);
const DR = Int8Array.from(NEIGHBOURS, (n) => n[1]);
const STEP = Int8Array.from(NEIGHBOURS, (n) => n[2]);

/**
 * Builds the passability grid for a movement class. A cell is blocked when the height range
 * across its four corners exceeds `maxSlope` (rise over run).
 */
export function buildNavGrid(t: Terrain, maxSlope: number): NavGrid {
  const cols = t.cols - 1;
  const rows = t.rows - 1;
  const passable = new Uint8Array(cols * rows);
  const limit = maxSlope * t.cellSize;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * t.cols + c;
      const a = t.heights[i] ?? 0;
      const b = t.heights[i + 1] ?? 0;
      const d = t.heights[i + t.cols] ?? 0;
      const e = t.heights[i + t.cols + 1] ?? 0;
      const range = Math.max(a, b, d, e) - Math.min(a, b, d, e);
      passable[r * cols + c] = range <= limit ? 1 : 0;
    }
  }
  return { cols, rows, cellSize: t.cellSize, passable };
}

/** Cell index containing (`x`, `z`), clamped to the grid. */
export function cellAt(g: NavGrid, x: number, z: number): number {
  const c = Math.min(Math.max(Math.floor(x / g.cellSize), 0), g.cols - 1);
  const r = Math.min(Math.max(Math.floor(z / g.cellSize), 0), g.rows - 1);
  return r * g.cols + c;
}

/**
 * The passable cell closest to `cell`, searching outward in square rings. Returns -1 if the
 * whole grid is blocked. Ties resolve in row-major order.
 */
export function nearestPassable(g: NavGrid, cell: number): number {
  if (g.passable[cell] === 1) return cell;
  const c0 = cell % g.cols;
  const r0 = Math.floor(cell / g.cols);
  const maxRing = Math.max(g.cols, g.rows);
  for (let ring = 1; ring < maxRing; ring++) {
    let best = -1;
    let bestD = Infinity;
    for (let r = r0 - ring; r <= r0 + ring; r++) {
      if (r < 0 || r >= g.rows) continue;
      for (let c = c0 - ring; c <= c0 + ring; c++) {
        if (c < 0 || c >= g.cols) continue;
        if (Math.max(Math.abs(r - r0), Math.abs(c - c0)) !== ring) continue;
        if (g.passable[r * g.cols + c] !== 1) continue;
        const d = (r - r0) * (r - r0) + (c - c0) * (c - c0);
        if (d < bestD) {
          bestD = d;
          best = r * g.cols + c;
        }
      }
    }
    if (best >= 0) return best;
  }
  return -1;
}

/**
 * A distance field toward one goal, shared by every unit that received the same move
 * command. Units descend the field. It is a pure function of `(grid, goalCell)`, so only
 * the goal needs hashing. When structures change the grid, the simulation recomputes the
 * costs (and moves the goal off a cell that became blocked).
 */
export interface FlowField {
  movementClass: number;
  goalCell: number;
  /** Exact requested target in metres (inside or near the goal cell). */
  goalX: number;
  goalZ: number;
  /** Path cost to the goal per cell, or {@link UNREACHABLE}. */
  cost: Int32Array;
  /** Version of the navigation grid the costs were computed for. */
  version: number;
}

/**
 * Shortest-path costs from the goal over the 8-connected grid with integer costs (10 / 14,
 * no corner cutting), computed with a bucket queue.
 */
export function computeFlowCosts(g: NavGrid, goalCell: number): Int32Array {
  const n = g.cols * g.rows;
  assert(n < 1 << 20, "navigation grid too large");
  const cost = new Int32Array(n).fill(UNREACHABLE);
  if (g.passable[goalCell] !== 1) return cost;

  // Dial's algorithm: edge costs are 10 or 14, so only 15 distinct distances are pending at
  // once and a circular array of buckets replaces the heap. Cells within a bucket are
  // processed in insertion order, which is itself deterministic.
  const BUCKETS = DIAGONAL_COST + 1;
  const buckets: number[][] = Array.from({ length: BUCKETS }, () => []);
  cost[goalCell] = 0;
  buckets[0]?.push(goalCell);
  let pending = 1;
  for (let d = 0; pending > 0; d++) {
    const bucket = buckets[d % BUCKETS];
    if (!bucket) break;
    for (let n = 0; n < bucket.length; n++) {
      const cell = bucket[n] ?? 0;
      pending--;
      if (cost[cell] !== d) continue; // stale: a cheaper route was found later
      const c = cell % g.cols;
      const r = (cell - c) / g.cols;
      for (let k = 0; k < 8; k++) {
        const dc = DC[k] ?? 0;
        const dr = DR[k] ?? 0;
        const nc = c + dc;
        const nr = r + dr;
        if (nc < 0 || nr < 0 || nc >= g.cols || nr >= g.rows) continue;
        const ni = nr * g.cols + nc;
        if (g.passable[ni] !== 1) continue;
        if (dc !== 0 && dr !== 0) {
          // No cutting corners: both orthogonal neighbours must be open.
          if (g.passable[r * g.cols + nc] !== 1 || g.passable[nr * g.cols + c] !== 1) continue;
        }
        const nd = d + (STEP[k] ?? 0);
        if (nd < (cost[ni] ?? UNREACHABLE)) {
          cost[ni] = nd;
          buckets[nd % BUCKETS]?.push(ni);
          pending++;
        }
      }
    }
    bucket.length = 0;
  }
  return cost;
}

/**
 * Direction (unnormalised, in metres) a unit at (`x`, `z`) should head to follow `field`.
 * Returns undefined if the unit stands on an unreachable cell.
 */
export function flowDirection(
  g: NavGrid,
  field: FlowField,
  x: number,
  z: number,
): { dx: number; dz: number } | undefined {
  const cell = cellAt(g, x, z);
  const here = field.cost[cell] ?? UNREACHABLE;
  if (here === UNREACHABLE) return undefined;
  const c = cell % g.cols;
  const r = (cell - c) / g.cols;
  let best = here;
  let bestC = c;
  let bestR = r;
  for (const [dc, dr] of NEIGHBOURS) {
    const nc = c + dc;
    const nr = r + dr;
    if (nc < 0 || nr < 0 || nc >= g.cols || nr >= g.rows) continue;
    const v = field.cost[nr * g.cols + nc] ?? UNREACHABLE;
    if (v >= best) continue;
    if (dc !== 0 && dr !== 0) {
      if (g.passable[r * g.cols + nc] !== 1 || g.passable[nr * g.cols + c] !== 1) continue;
    }
    best = v;
    bestC = nc;
    bestR = nr;
  }
  if (bestC === c && bestR === r) return { dx: field.goalX - x, dz: field.goalZ - z };
  return {
    dx: (bestC + 0.5) * g.cellSize - x,
    dz: (bestR + 0.5) * g.cellSize - z,
  };
}

/**
 * True if the straight segment from (`x0`, `z0`) to (`x1`, `z1`) crosses only passable
 * cells. Samples at half-cell spacing.
 */
export function hasLineOfSight(
  g: NavGrid,
  x0: number,
  z0: number,
  x1: number,
  z1: number,
): boolean {
  const dx = x1 - x0;
  const dz = z1 - z0;
  const dist = Math.sqrt(dx * dx + dz * dz);
  const steps = Math.ceil(dist / (g.cellSize * 0.5));
  for (let s = 1; s <= steps; s++) {
    const f = s / steps;
    if (g.passable[cellAt(g, x0 + dx * f, z0 + dz * f)] !== 1) return false;
  }
  return true;
}

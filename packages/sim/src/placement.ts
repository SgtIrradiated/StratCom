import type { Facing, Vec2 } from "./commands";
import { HALF_PI, TWO_PI } from "./math/trig";
import type { Terrain } from "./terrain";

/**
 * Structure placement rules, shared by the simulation (which decides) and the client's
 * placement ghost (which only previews). Pure functions of terrain, deposits and occupancy.
 */

/** Steepest ground, as rise over run across a cell, that a structure may stand on. */
export const BUILD_MAX_SLOPE = 0.35;

/** An extractor ordered within this many metres of a deposit snaps onto it. */
export const DEPOSIT_SNAP_RADIUS = 24;

/** What placement needs to know about a structure type. */
export interface PlacementStats {
  /** Footprint in cells at facing 0. */
  footprint: { readonly x: number; readonly z: number };
  placement: "ground" | "deposit";
}

/** A structure's site: its centre in metres and the block of terrain cells it covers. */
export interface Footprint {
  x: number;
  z: number;
  col: number;
  row: number;
  cols: number;
  rows: number;
}

/** Why a site is not buildable. */
export type PlacementProblem = "off-map" | "slope" | "occupied" | "needs-deposit" | "on-deposit";

/** Heading in radians for a facing. Heading 0 faces +z. */
export function facingHeading(facing: Facing): number {
  return facing * HALF_PI;
}

/** The facing closest to `heading`. */
export function headingFacing(heading: number): Facing {
  const turns = Math.round((((heading % TWO_PI) + TWO_PI) % TWO_PI) / HALF_PI) % 4;
  return turns as Facing;
}

/** Coerces untrusted input (a command field) to a valid facing; anything else is 0. */
export function toFacing(value: unknown): Facing {
  return value === 1 || value === 2 || value === 3 ? value : 0;
}

/** The footprint centred as close as the cell grid allows to (`x`, `z`). */
export function footprintAt(
  terrain: Terrain,
  stats: PlacementStats,
  facing: Facing,
  x: number,
  z: number,
): Footprint {
  const cs = terrain.cellSize;
  const turned = facing % 2 === 1;
  const cols = Math.max(turned ? stats.footprint.z : stats.footprint.x, 1);
  const rows = Math.max(turned ? stats.footprint.x : stats.footprint.z, 1);
  const col = Math.round(x / cs - cols / 2);
  const row = Math.round(z / cs - rows / 2);
  return { x: (col + cols / 2) * cs, z: (row + rows / 2) * cs, col, row, cols, rows };
}

/**
 * Where a structure ordered at (`x`, `z`) would go. Ground structures snap to the cell grid.
 * Deposit structures snap onto the nearest deposit within {@link DEPOSIT_SNAP_RADIUS}, or
 * return undefined if there is none.
 */
export function snapSite(
  terrain: Terrain,
  stats: PlacementStats,
  facing: Facing,
  x: number,
  z: number,
  deposits: readonly Vec2[],
): Footprint | undefined {
  if (stats.placement === "ground") return footprintAt(terrain, stats, facing, x, z);
  let best = -1;
  let bestD = DEPOSIT_SNAP_RADIUS * DEPOSIT_SNAP_RADIUS;
  deposits.forEach((d, i) => {
    const dd = (d.x - x) * (d.x - x) + (d.z - z) * (d.z - z);
    if (dd <= bestD) {
      if (dd === bestD && best >= 0) return;
      bestD = dd;
      best = i;
    }
  });
  const d = deposits[best];
  return d ? footprintAt(terrain, stats, facing, d.x, d.z) : undefined;
}

/**
 * Why `fp` is not a valid site for a structure with these stats, or undefined if it is.
 * `occupied(cell)` reports cells already taken by structures; cells are indexed like the
 * navigation grid (`row * (terrain.cols - 1) + col`).
 */
export function placementProblem(
  terrain: Terrain,
  stats: PlacementStats,
  fp: Footprint,
  deposits: readonly Vec2[],
  occupied: (cell: number) => boolean,
): PlacementProblem | undefined {
  const gridCols = terrain.cols - 1;
  const gridRows = terrain.rows - 1;
  if (fp.col < 0 || fp.row < 0 || fp.col + fp.cols > gridCols || fp.row + fp.rows > gridRows) {
    return "off-map";
  }
  const limit = BUILD_MAX_SLOPE * terrain.cellSize;
  const h = terrain.heights;
  for (let r = fp.row; r < fp.row + fp.rows; r++) {
    for (let c = fp.col; c < fp.col + fp.cols; c++) {
      const i = r * terrain.cols + c;
      const a = h[i] ?? 0;
      const b = h[i + 1] ?? 0;
      const d = h[i + terrain.cols] ?? 0;
      const e = h[i + terrain.cols + 1] ?? 0;
      if (Math.max(a, b, d, e) - Math.min(a, b, d, e) > limit) return "slope";
    }
  }
  for (let r = fp.row; r < fp.row + fp.rows; r++) {
    for (let c = fp.col; c < fp.col + fp.cols; c++) {
      if (occupied(r * gridCols + c)) return "occupied";
    }
  }
  if (stats.placement === "deposit") {
    const onDeposit = deposits.some((d) => d.x === fp.x && d.z === fp.z);
    return onDeposit ? undefined : "needs-deposit";
  }
  // Ground structures may not cover a deposit, or it could never be extracted.
  const cs = terrain.cellSize;
  const x0 = fp.col * cs;
  const z0 = fp.row * cs;
  const x1 = x0 + fp.cols * cs;
  const z1 = z0 + fp.rows * cs;
  const covers = deposits.some((d) => d.x >= x0 && d.x <= x1 && d.z >= z0 && d.z <= z1);
  return covers ? "on-deposit" : undefined;
}

/**
 * Distance in metres from (`x`, `z`) to the nearest point of `fp`'s rectangle; 0 inside it.
 */
export function distanceToFootprint(terrain: Terrain, fp: Footprint, x: number, z: number): number {
  const cs = terrain.cellSize;
  const x0 = fp.col * cs;
  const z0 = fp.row * cs;
  const dx = Math.max(x0 - x, 0, x - (x0 + fp.cols * cs));
  const dz = Math.max(z0 - z, 0, z - (z0 + fp.rows * cs));
  return Math.sqrt(dx * dx + dz * dz);
}

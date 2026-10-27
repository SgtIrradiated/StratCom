import type { SimContext, SlotState } from "../context";
import { EntityKind } from "../ecs/world";
import type { StateHasher } from "../math/hash";
import { NO_TEAM } from "../teams";
import { terrainDepth, terrainWidth, type Terrain } from "../terrain";

/** Side of a vision cell in metres. */
export const VISION_CELL = 32;
/** Vision is recomputed every this many ticks (5 Hz). */
export const VISION_TICKS = 4;

/** Vision grid size for a map. */
export function visionGrid(terrain: Terrain): { cols: number; rows: number } {
  return {
    cols: Math.max(1, Math.ceil(terrainWidth(terrain) / VISION_CELL)),
    rows: Math.max(1, Math.ceil(terrainDepth(terrain) / VISION_CELL)),
  };
}

/** Cell states in {@link VisibilitySystem.writeGrid}. */
export const Fog = { unexplored: 0, explored: 1, visible: 2 } as const;

/**
 * Fog of war (docs/PLAN.md §4.4 step 10): a coarse grid per team. A cell is visible while a
 * unit of the team has it inside its vision radius, and explored once it ever was. Allies
 * share vision because vision is kept per team.
 *
 * Vision is gameplay state, not just presentation: weapons only fire at what their team can
 * see, so long-ranged weapons need spotters. It is recomputed every {@link VISION_TICKS}
 * ticks by stamping a precomputed disc per unit: the cells whose centres lie within its
 * vision radius of its own cell's centre. Units of one team in the same cell stamp only
 * their largest disc.
 */
export class VisibilitySystem implements SlotState {
  readonly cols: number;
  readonly rows: number;
  readonly cells: number;
  readonly teams: number;
  /** 1 where the team sees now, `teams × cells`. */
  private readonly visible: Uint8Array;
  /** 1 where the team has ever seen. */
  private readonly explored: Uint8Array;
  /** Largest vision radius (metres) stamped per team and cell in the current pass. */
  private readonly stamped: Float64Array;
  /** Cell offsets (column, row pairs) inside a disc, by vision radius in metres. */
  private readonly discs = new Map<number, Int32Array>();

  constructor(private readonly ctx: SimContext) {
    const grid = visionGrid(ctx.terrain);
    this.cols = grid.cols;
    this.rows = grid.rows;
    this.cells = grid.cols * grid.rows;
    this.teams = ctx.teamCount;
    this.visible = new Uint8Array(this.teams * this.cells);
    this.explored = new Uint8Array(this.teams * this.cells);
    this.stamped = new Float64Array(this.teams * this.cells);
    ctx.register(this);
  }

  // SlotState: vision is per team, not per entity slot.
  reset(): void {
    // Nothing per entity slot.
  }

  hashSlot(): void {
    // Nothing per entity slot.
  }

  hashGlobal(h: StateHasher): void {
    for (const grid of [this.visible, this.explored]) {
      // Four cells per word.
      for (let k = 0; k < grid.length; k += 4) {
        h.u32(
          (grid[k] ?? 0) |
            ((grid[k + 1] ?? 0) << 8) |
            ((grid[k + 2] ?? 0) << 16) |
            ((grid[k + 3] ?? 0) << 24),
        );
      }
    }
  }

  /** The vision cell containing (`x`, `z`). */
  cellAt(x: number, z: number): number {
    const c = Math.min(Math.max(Math.floor(x / VISION_CELL), 0), this.cols - 1);
    const r = Math.min(Math.max(Math.floor(z / VISION_CELL), 0), this.rows - 1);
    return r * this.cols + c;
  }

  /** True if dense team `team` currently sees the point (`x`, `z`). */
  sees(team: number, x: number, z: number): boolean {
    if (team === NO_TEAM || team >= this.teams) return false;
    return this.visible[team * this.cells + this.cellAt(x, z)] === 1;
  }

  /** Bitmask of the dense teams that currently see the point (`x`, `z`). */
  seenBy(x: number, z: number): number {
    const cell = this.cellAt(x, z);
    let mask = 0;
    for (let t = 0; t < this.teams; t++) {
      if (this.visible[t * this.cells + cell] === 1) mask |= 1 << t;
    }
    return mask;
  }

  /** Writes every team's grid into `out` (`teams × cells`) as {@link Fog} states. */
  writeGrid(out: Uint8Array): void {
    const n = Math.min(out.length, this.visible.length);
    for (let k = 0; k < n; k++) {
      out[k] =
        this.visible[k] === 1
          ? Fog.visible
          : this.explored[k] === 1
            ? Fog.explored
            : Fog.unexplored;
    }
  }

  /** Recomputes vision on every {@link VISION_TICKS}th tick. */
  run(): void {
    if (this.ctx.tick % VISION_TICKS === 0) this.recompute();
  }

  /** Recomputes every team's vision from the units' current positions. */
  recompute(): void {
    const ctx = this.ctx;
    const w = ctx.world;
    const units = ctx.rules.units;
    this.visible.fill(0);
    this.stamped.fill(0);
    for (let i = 0; i < w.highWater; i++) {
      if (w.alive[i] === 0 || w.kind[i] !== EntityKind.unit) continue;
      const team = ctx.teamOf[w.owner[i] ?? 0] ?? NO_TEAM;
      if (team === NO_TEAM || team >= this.teams) continue;
      const vision = units[w.type[i] ?? 0]?.vision ?? 0;
      const cell = this.cellAt(w.x[i] ?? 0, w.z[i] ?? 0);
      const key = team * this.cells + cell;
      // Every unit sees at least its own cell, so 0 means "nothing stamped yet".
      if ((this.stamped[key] ?? 0) >= vision + 1) continue;
      this.stamped[key] = vision + 1;
      this.stamp(team, cell % this.cols, Math.floor(cell / this.cols), vision);
    }
  }

  private stamp(team: number, col: number, row: number, vision: number): void {
    const disc = this.disc(vision);
    const base = team * this.cells;
    for (let k = 0; k < disc.length; k += 2) {
      const c = col + (disc[k] ?? 0);
      const r = row + (disc[k + 1] ?? 0);
      if (c < 0 || r < 0 || c >= this.cols || r >= this.rows) continue;
      const i = base + r * this.cols + c;
      this.visible[i] = 1;
      this.explored[i] = 1;
    }
  }

  /** Offsets of the cells whose centres lie within `vision` metres of a cell's centre. */
  private disc(vision: number): Int32Array {
    const cached = this.discs.get(vision);
    if (cached) return cached;
    const radius = vision / VISION_CELL;
    const span = Math.floor(radius);
    const offsets: number[] = [];
    for (let dr = -span; dr <= span; dr++) {
      for (let dc = -span; dc <= span; dc++) {
        if (dc * dc + dr * dr <= radius * radius) offsets.push(dc, dr);
      }
    }
    const disc = Int32Array.from(offsets);
    this.discs.set(vision, disc);
    return disc;
  }
}

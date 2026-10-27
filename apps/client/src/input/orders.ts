import {
  EntityKind,
  footprintAt,
  headingFacing,
  placementProblem,
  snapSite,
  type Facing,
  type Footprint,
  type PlacementProblem,
  type PlayerCommand,
  type SimRuleset,
  type SnapshotBuffers,
  type Terrain,
  type Vec2,
} from "@stratcom/sim";

/** What order logic needs to know about the local player's view of the match. */
export interface OrderContext {
  ruleset: SimRuleset;
  localSlot: number;
  snapshot: SnapshotBuffers;
  selected: ReadonlySet<number>;
}

/** The selected, finished units of the local player, by what they can do. Entity ids. */
export interface SelectionRoles {
  /** Mobile units that can build, reclaim and assist. */
  builders: number[];
  /** Mobile units that cannot build. */
  movers: number[];
  /** Structures that produce units. */
  factories: number[];
}

/** Splits the selection into builders, other mobile units and factories. */
export function selectionRoles(ctx: OrderContext): SelectionRoles {
  const s = ctx.snapshot;
  const roles: SelectionRoles = { builders: [], movers: [], factories: [] };
  for (let i = 0; i < s.count; i++) {
    const id = s.ids[i] ?? 0;
    if (!ctx.selected.has(id) || s.owners[i] !== ctx.localSlot) continue;
    if (s.kinds[i] !== EntityKind.unit || (s.progress[i] ?? 0) < 1) continue;
    const st = ctx.ruleset.units[s.types[i] ?? 0];
    if (!st) continue;
    if (st.mobile) (st.buildRate > 0 ? roles.builders : roles.movers).push(id);
    else if (st.buildRate > 0) roles.factories.push(id);
  }
  return roles;
}

/**
 * The orders for a right click. `hovered` is the snapshot index under the
 * cursor, or -1; `ground` is the ground point under it.
 *
 * - On debris, builders reclaim it.
 * - On one of your own unfinished units, factories or builders, builders assist it.
 * - Everything else that can move goes to `ground`; factories set their rally point there.
 */
export function contextCommands(
  ctx: OrderContext,
  hovered: number,
  ground: Vec2 | undefined,
  queue: boolean,
): PlayerCommand[] {
  const s = ctx.snapshot;
  const slot = ctx.localSlot;
  const { builders, movers, factories } = selectionRoles(ctx);
  const commands: PlayerCommand[] = [];
  let walkers = [...movers, ...builders];

  if (hovered >= 0 && hovered < s.count && builders.length > 0) {
    const target = s.ids[hovered] ?? 0;
    const others = builders.filter((id) => id !== target);
    if (s.kinds[hovered] === EntityKind.feature) {
      commands.push({ t: "reclaim", slot, units: builders, target, queue });
      walkers = movers;
    } else if (s.owners[hovered] === slot && others.length > 0) {
      const st = ctx.ruleset.units[s.types[hovered] ?? 0];
      if ((s.progress[hovered] ?? 0) < 1 || (st?.buildRate ?? 0) > 0) {
        commands.push({ t: "assist", slot, units: others, target, queue });
        walkers = movers.filter((id) => id !== target);
      }
    }
  }
  if (ground && walkers.length > 0) {
    commands.push({ t: "move", slot, units: walkers, to: { x: ground.x, z: ground.z }, queue });
  }
  if (ground && factories.length > 0) {
    commands.push({ t: "rally", slot, units: factories, to: { x: ground.x, z: ground.z } });
  }
  return commands;
}

/** Terrain cells covered by structures in the snapshot (the client's view of occupancy). */
export function occupiedCells(
  ruleset: SimRuleset,
  terrain: Terrain,
  snapshot: SnapshotBuffers,
): Set<number> {
  const cells = new Set<number>();
  const gridCols = terrain.cols - 1;
  for (let i = 0; i < snapshot.count; i++) {
    if (snapshot.kinds[i] !== EntityKind.unit) continue;
    const st = ruleset.units[snapshot.types[i] ?? 0];
    if (!st || st.mobile) continue;
    const fp = footprintAt(
      terrain,
      st,
      headingFacing(snapshot.heading[i] ?? 0),
      snapshot.x[i] ?? 0,
      snapshot.z[i] ?? 0,
    );
    for (let r = fp.row; r < fp.row + fp.rows; r++) {
      for (let c = fp.col; c < fp.col + fp.cols; c++) cells.add(r * gridCols + c);
    }
  }
  return cells;
}

/** Where a structure would go under the cursor and whether the site looks buildable. */
export interface PlacementPreview {
  site: Footprint;
  /** Undefined when the site looks buildable. The simulation has the final say. */
  problem: PlacementProblem | undefined;
}

/**
 * Previews placing `type` at (`x`, `z`): snaps like the simulation does and checks the site
 * against terrain, deposits and the structures in `snapshot`.
 */
export function previewPlacement(
  ruleset: SimRuleset,
  terrain: Terrain,
  deposits: readonly Vec2[],
  snapshot: SnapshotBuffers,
  type: number,
  facing: Facing,
  x: number,
  z: number,
): PlacementPreview | undefined {
  const st = ruleset.units[type];
  if (!st || st.mobile) return undefined;
  const snapped = snapSite(terrain, st, facing, x, z, deposits);
  if (!snapped) return { site: footprintAt(terrain, st, facing, x, z), problem: "needs-deposit" };
  const occupied = occupiedCells(ruleset, terrain, snapshot);
  const problem = placementProblem(terrain, st, snapped, deposits, (c) => occupied.has(c));
  return { site: snapped, problem };
}

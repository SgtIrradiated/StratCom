import type { CompiledRuleset, MapDef } from "@stratcom/data";
import { assert } from "@stratcom/shared";
import { atan2, cos, sin } from "./math/trig";
import { buildNavGrid, cellAt, nearestPassable, type NavGrid } from "./navigation";
import type { InitialUnit, MatchSetup, PlayerSetup } from "./simulation";
import { generateTerrain, terrainWidth, type Terrain } from "./terrain";

/** Inputs for {@link createSkirmishSetup}. */
export interface SkirmishOptions {
  /** Match seed: drives every random decision in the match, not the map. */
  seed: number;
  map: MapDef;
  ruleset: CompiledRuleset;
  /** Active slots only. Slot `n` starts at `map.startPositions[n]`. */
  players: readonly PlayerSetup[];
}

/** Metres between the commander and the first row of starting units. */
const FORMATION_OFFSET = 22;
/** Metres between rows and between units in a row. */
const FORMATION_SPACING = 11;
/** Units per formation row. */
const FORMATION_ROW = 5;

/** Builds the heightmap for a map, with its start positions flattened into base sites. */
export function generateMapTerrain(map: MapDef): Terrain {
  const size = map.cells * map.cellSize;
  return generateTerrain({
    seed: map.terrain.seed,
    cells: map.cells,
    cellSize: map.cellSize,
    amplitude: map.terrain.amplitude,
    wavelength: map.terrain.wavelength,
    plateaus: map.startPositions.map((p) => ({
      x: p.x * size,
      z: p.z * size,
      radius: map.plateauRadius,
    })),
  });
}

/**
 * Turns a skirmish configuration into a {@link MatchSetup}: generates the map, then spawns
 * each player's commander on its start position facing the map centre, with the faction's
 * starting units in rows in front of it. Pure and deterministic, so every peer of an online
 * match (M8) derives the same setup from the same lobby settings.
 */
export function createSkirmishSetup(o: SkirmishOptions): MatchSetup {
  const { map, ruleset } = o;
  const terrain = generateMapTerrain(map);
  const size = terrainWidth(terrain);
  const grids = ruleset.movementClasses.map((m) => buildNavGrid(terrain, m.maxSlope));
  const initialUnits: InitialUnit[] = [];

  const players = [...o.players].sort((a, b) => a.slot - b.slot);
  for (const p of players) {
    const start = map.startPositions[p.slot];
    assert(start, `map "${map.id}" has no start position for slot ${p.slot}`);
    const faction = ruleset.factions.find((f) => f.id === p.factionId);
    assert(faction, `unknown faction "${p.factionId}" in slot ${p.slot}`);

    const cx = start.x * size;
    const cz = start.z * size;
    const heading = atan2(size / 2 - cx, size / 2 - cz);
    // Forward (heading 0 faces +z) and right-hand vectors.
    const fx = sin(heading);
    const fz = cos(heading);
    const place = (type: number, x: number, z: number): void => {
      const grid = grids[ruleset.units[type]?.movementClass ?? -1];
      const at = grid ? snapToPassable(grid, x, z) : { x, z };
      initialUnits.push({ slot: p.slot, type, x: at.x, z: at.z, heading });
    };

    place(faction.commanderUnit, cx, cz);
    const escorts = faction.startingUnits.flatMap((s) =>
      Array.from({ length: s.count }, () => s.unit),
    );
    escorts.forEach((type, i) => {
      const row = Math.floor(i / FORMATION_ROW);
      const inRow = Math.min(escorts.length - row * FORMATION_ROW, FORMATION_ROW);
      const lateral = (i - row * FORMATION_ROW - (inRow - 1) / 2) * FORMATION_SPACING;
      const ahead = FORMATION_OFFSET + row * FORMATION_SPACING;
      place(type, cx + fx * ahead + fz * lateral, cz + fz * ahead - fx * lateral);
    });
  }

  return { seed: o.seed, terrain, players, ruleset, initialUnits };
}

/** (`x`, `z`) if passable, else the centre of the nearest passable cell. */
function snapToPassable(grid: NavGrid, x: number, z: number): { x: number; z: number } {
  const cell = cellAt(grid, x, z);
  const open = nearestPassable(grid, cell);
  if (open === cell || open < 0) return { x, z };
  return {
    x: ((open % grid.cols) + 0.5) * grid.cellSize,
    z: (Math.floor(open / grid.cols) + 0.5) * grid.cellSize,
  };
}

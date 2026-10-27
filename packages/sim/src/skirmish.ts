import type { CompiledRuleset, MapDef } from "@stratcom/data";
import { assert } from "@stratcom/shared";
import type { Vec2 } from "./commands";
import { Prng } from "./math/prng";
import { PI, TWO_PI, atan2, cos, sin } from "./math/trig";
import { buildNavGrid, cellAt, nearestPassable, type NavGrid } from "./navigation";
import type { InitialFeature, InitialUnit, MatchSetup, PlayerSetup } from "./simulation";
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
/** Start deposits sit on a ring of this fraction of the plateau radius (at least 30 m). */
const DEPOSIT_RING = 0.62;
/** Angle in radians between neighbouring start deposits. */
const DEPOSIT_SPREAD = 0.75;
/** Radius in metres of the flat pad under each field deposit. */
const DEPOSIT_PAD = 14;
/** Debris keeps this far from deposits, in metres. */
const DEBRIS_DEPOSIT_CLEARANCE = 14;

/**
 * Salvage deposits for a map, in metres, on terrain-cell corners so a 2 × 2 extractor
 * centres exactly on one. Each start position gets `map.startDeposits` deposits in an arc
 * behind the commander (away from the map centre), then the authored field deposits follow.
 * Deposits too close to an earlier one to fit an extractor are dropped.
 */
export function mapDeposits(map: MapDef): Vec2[] {
  return depositList(map).map((d) => d.at);
}

/** {@link mapDeposits}, with each deposit marked as a field deposit or a start deposit. */
function depositList(map: MapDef): { at: Vec2; field: boolean }[] {
  const size = map.cells * map.cellSize;
  const cs = map.cellSize;
  const corner = (v: number): number =>
    Math.min(Math.max(Math.round(v / cs), 2), map.cells - 2) * cs;
  const out: { at: Vec2; field: boolean }[] = [];
  const add = (x: number, z: number, field: boolean): void => {
    const p = { x: corner(x), z: corner(z) };
    const clash = out.some(
      (d) => Math.abs(d.at.x - p.x) < 2 * cs && Math.abs(d.at.z - p.z) < 2 * cs,
    );
    if (!clash) out.push({ at: p, field });
  };
  const ring = Math.max(map.plateauRadius * DEPOSIT_RING, 30);
  for (const start of map.startPositions) {
    const cx = start.x * size;
    const cz = start.z * size;
    const back = atan2(size / 2 - cx, size / 2 - cz) + PI;
    for (let j = 0; j < map.startDeposits; j++) {
      const a = back + (j - (map.startDeposits - 1) / 2) * DEPOSIT_SPREAD;
      add(cx + sin(a) * ring, cz + cos(a) * ring, false);
    }
  }
  for (const d of map.deposits) add(d.x * size, d.z * size, true);
  return out;
}

/**
 * Builds the heightmap for a map, with its start positions flattened into base sites and a
 * small flat pad under every field deposit.
 */
export function generateMapTerrain(map: MapDef): Terrain {
  const size = map.cells * map.cellSize;
  const starts = map.startPositions.map((p) => ({
    x: p.x * size,
    z: p.z * size,
    radius: map.plateauRadius,
  }));
  const pads = depositList(map)
    .filter((d) => d.field)
    .map((d) => ({ x: d.at.x, z: d.at.z, radius: DEPOSIT_PAD }));
  return generateTerrain({
    seed: map.terrain.seed,
    cells: map.cells,
    cellSize: map.cellSize,
    amplitude: map.terrain.amplitude,
    wavelength: map.terrain.wavelength,
    plateaus: [...starts, ...pads],
  });
}

/**
 * Scatters each debris field's pieces, seeded by the map so every match on a map gets the
 * same debris. Pieces land on ground every movement class can cross, away from deposits and
 * start plateaus; a piece that finds no such spot in a few tries is skipped.
 */
export function mapFeatures(
  map: MapDef,
  ruleset: CompiledRuleset,
  terrain: Terrain,
  grids: readonly NavGrid[],
  deposits: readonly Vec2[],
): InitialFeature[] {
  const size = terrainWidth(terrain);
  const prng = new Prng((map.terrain.seed ^ 0x0deb12) >>> 0);
  const out: InitialFeature[] = [];
  const clearOfBases = (x: number, z: number): boolean =>
    map.startPositions.every((p) => {
      const dx = p.x * size - x;
      const dz = p.z * size - z;
      return dx * dx + dz * dz > map.plateauRadius * map.plateauRadius;
    });
  const clearOfDeposits = (x: number, z: number): boolean =>
    deposits.every((d) => {
      const dx = d.x - x;
      const dz = d.z - z;
      return dx * dx + dz * dz > DEBRIS_DEPOSIT_CLEARANCE * DEBRIS_DEPOSIT_CLEARANCE;
    });
  for (const field of map.debris) {
    const type = ruleset.features.findIndex((f) => f.id === field.feature);
    assert(type >= 0, `map "${map.id}" uses unknown feature "${field.feature}"`);
    for (let k = 0; k < field.count; k++) {
      for (let tries = 0; tries < 12; tries++) {
        const angle = prng.nextFloat() * TWO_PI;
        const r = Math.sqrt(prng.nextFloat()) * field.radius;
        const x = field.x * size + sin(angle) * r;
        const z = field.z * size + cos(angle) * r;
        const heading = prng.nextFloat() * TWO_PI;
        if (x < 16 || z < 16 || x > size - 16 || z > size - 16) continue;
        if (!grids.every((g) => g.passable[cellAt(g, x, z)] === 1)) continue;
        if (!clearOfBases(x, z) || !clearOfDeposits(x, z)) continue;
        out.push({ type, x, z, heading });
        break;
      }
    }
  }
  return out;
}

/**
 * Turns a skirmish configuration into a {@link MatchSetup}: generates the map with its
 * deposits and debris, then spawns each player's commander on its start position facing the
 * map centre, with the faction's starting units in rows in front of it. Each player gets
 * its faction's starting resources and reclaim bonus. Pure and deterministic, so every peer
 * of an online match (M8) derives the same setup from the same lobby settings.
 */
export function createSkirmishSetup(o: SkirmishOptions): MatchSetup {
  const { map, ruleset } = o;
  const terrain = generateMapTerrain(map);
  const size = terrainWidth(terrain);
  const grids = ruleset.movementClasses.map((m) => buildNavGrid(terrain, m.maxSlope));
  const deposits = mapDeposits(map);
  const initialUnits: InitialUnit[] = [];

  const players = [...o.players]
    .sort((a, b) => a.slot - b.slot)
    .map((p): PlayerSetup => {
      const faction = ruleset.factions.find((f) => f.id === p.factionId);
      assert(faction, `unknown faction "${p.factionId}" in slot ${p.slot}`);
      return {
        ...p,
        startingResources: { ...faction.startingResources },
        reclaimMultiplier: faction.reclaimMultiplier,
      };
    });
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

  const features = mapFeatures(map, ruleset, terrain, grids, deposits);
  return { seed: o.seed, terrain, players, ruleset, initialUnits, features, deposits };
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

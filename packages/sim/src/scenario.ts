import type { PlayerCommand } from "./commands";
import { Prng } from "./math/prng";
import { buildNavGrid, cellAt } from "./navigation";
import type { FeatureTypeStats, MatchSetup, SimRuleset, UnitTypeStats, WeaponStats } from "./rules";
import { generateTerrain, terrainDepth, terrainWidth } from "./terrain";

/** Ground units cross slopes up to 0.6 (about 31°). */
export const TEST_MOVEMENT_CLASSES = [{ maxSlope: 0.6 }] as const;

/** Test weapons: a short instant-hit beam and a slower area-damage cannon. */
export const TEST_WEAPONS: readonly WeaponStats[] = [
  { damage: 12, range: 40, reload: 0.5, areaRadius: 0, projectileSpeed: 0 },
  { damage: 60, range: 90, reload: 2, areaRadius: 6, projectileSpeed: 60 },
];

/** A mobile armed test unit that cannot build and produces nothing. */
function testUnit(
  speed: number,
  turnRate: number,
  radius: number,
  health: number,
  vision: number,
  weapon: number,
): UnitTypeStats {
  return {
    mobile: true,
    movementClass: 0,
    radius,
    speed,
    turnRate,
    health,
    vision,
    weapons: [weapon],
    wreckFeature: 0,
    commander: false,
    cost: { salvage: 0, power: 0, buildTime: 1 },
    footprint: { x: 0, z: 0 },
    placement: "ground",
    builds: [],
    buildRate: 0,
    buildRange: 0,
    economy: { salvagePerSec: 0, powerPerSec: 0, storageSalvage: 0, storagePower: 0 },
  };
}

/**
 * Placeholder unit types: a quick scout with a beam, and a slow heavy whose cannon outranges
 * its own sight, so it needs a spotter for its longest shots.
 */
export const TEST_UNIT_TYPES: readonly UnitTypeStats[] = [
  testUnit(9, 4, 2, 120, 140, 0),
  testUnit(5, 2, 3.5, 400, 70, 1),
];

/** The wreck both test unit types leave. */
export const TEST_FEATURES: readonly FeatureTypeStats[] = [{ radius: 3, salvage: 20 }];

/**
 * A minimal two-type ruleset for tests, benchmarks and the determinism check. It stays
 * fixed so the pinned determinism hashes don't move whenever game content is rebalanced.
 */
export const TEST_RULESET: SimRuleset = {
  movementClasses: TEST_MOVEMENT_CLASSES,
  units: TEST_UNIT_TYPES,
  features: TEST_FEATURES,
  weapons: TEST_WEAPONS,
};

/**
 * Builds a deterministic stress scenario: `unitCount` units split across `playerCount`
 * slots, scattered over hilly 2 km × 2 km terrain. Used by tests, `?bench=N` and `tools/det-check`.
 */
export function createTestMatch(unitCount: number, seed = 1, playerCount = 2): MatchSetup {
  const terrain = generateTerrain({
    seed,
    cells: 256,
    cellSize: 8,
    amplitude: 90,
    wavelength: 500,
  });
  const grid = buildNavGrid(terrain, TEST_MOVEMENT_CLASSES[0].maxSlope);
  const width = terrainWidth(terrain);
  const prng = new Prng(seed ^ 0x5eed);
  const players = Array.from({ length: playerCount }, (_, slot) => ({
    slot,
    team: slot,
    factionId: slot % 2 === 0 ? "directorate" : "scrapborn",
    color: slot % 2 === 0 ? "#4fd1c5" : "#e0902f",
  }));
  const initialUnits = Array.from({ length: unitCount }, (_, i) => {
    // Rejection-sample a passable spot; the bounded loop keeps this deterministic and finite.
    let x = 0;
    let z = 0;
    for (let tries = 0; tries < 50; tries++) {
      x = 64 + prng.nextFloat() * (width - 128);
      z = 64 + prng.nextFloat() * (width - 128);
      if (grid.passable[cellAt(grid, x, z)] === 1) break;
    }
    return {
      slot: i % playerCount,
      type: i % TEST_UNIT_TYPES.length,
      x,
      z,
      heading: prng.nextFloat() * 6,
    };
  });
  return {
    seed,
    terrain,
    players,
    ruleset: TEST_RULESET,
    initialUnits,
  };
}

/**
 * Scripted commands for tick `tick` of a test match: every 40 ticks each player sends all of
 * its units to a pseudo-random point. Entity ids are the first spawned ids, which are
 * predictable (slot i, generation 1).
 */
export function scriptedCommands(setup: MatchSetup, tick: number): PlayerCommand[] {
  if (tick % 40 !== 0) return [];
  const prng = new Prng(setup.seed + tick);
  const commands: PlayerCommand[] = [];
  for (const p of setup.players) {
    const units: number[] = [];
    setup.initialUnits.forEach((u, i) => {
      if (u.slot === p.slot) units.push((1 << 20) | i);
    });
    commands.push({
      t: "move",
      slot: p.slot,
      units,
      to: {
        x: prng.nextFloat() * terrainWidth(setup.terrain),
        z: prng.nextFloat() * terrainDepth(setup.terrain),
      },
    });
  }
  return commands;
}

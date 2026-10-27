import type { PlayerCommand } from "./commands";
import { Prng } from "./math/prng";
import { buildNavGrid, cellAt } from "./navigation";
import type { MatchSetup } from "./simulation";
import { generateTerrain, terrainDepth, terrainWidth } from "./terrain";

/** Ground units cross slopes up to 0.6 (about 31°). */
export const TEST_MOVEMENT_CLASSES = [{ maxSlope: 0.6 }] as const;

/** Placeholder unit types: a quick scout and a slow heavy. */
export const TEST_UNIT_TYPES = [
  { speed: 9, turnRate: 4, radius: 2, movementClass: 0 },
  { speed: 5, turnRate: 2, radius: 3.5, movementClass: 0 },
] as const;

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
    movementClasses: TEST_MOVEMENT_CLASSES,
    unitTypes: TEST_UNIT_TYPES,
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

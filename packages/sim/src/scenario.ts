import type { PlayerCommand } from "./commands";
import { Prng } from "./math/prng";
import type { MatchSetup } from "./simulation";

/** Placeholder unit types for M1: a quick scout and a slow heavy. */
export const TEST_UNIT_TYPES = [
  { speed: 9, turnRate: 4 },
  { speed: 5, turnRate: 2 },
] as const;

/**
 * Builds a deterministic stress scenario: `unitCount` units split across `playerCount`
 * slots, scattered over a square map. Used by tests, `?bench=N` and `tools/det-check`.
 */
export function createTestMatch(unitCount: number, seed = 1, playerCount = 2): MatchSetup {
  const size = 2048;
  const prng = new Prng(seed ^ 0x5eed);
  const players = Array.from({ length: playerCount }, (_, slot) => ({
    slot,
    team: slot,
    factionId: slot % 2 === 0 ? "directorate" : "scrapborn",
    color: slot % 2 === 0 ? "#4fd1c5" : "#e0902f",
  }));
  const initialUnits = Array.from({ length: unitCount }, (_, i) => ({
    slot: i % playerCount,
    type: i % TEST_UNIT_TYPES.length,
    x: 64 + prng.nextFloat() * (size - 128),
    z: 64 + prng.nextFloat() * (size - 128),
    heading: prng.nextFloat() * 6,
  }));
  return {
    seed,
    map: { width: size, height: size },
    players,
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
        x: prng.nextFloat() * setup.map.width,
        z: prng.nextFloat() * setup.map.height,
      },
    });
  }
  return commands;
}

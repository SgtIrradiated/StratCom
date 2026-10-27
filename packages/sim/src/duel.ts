import { RULESET, rulesetUnit } from "@stratcom/data";
import type { PlayerCommand } from "./commands";
import { HALF_PI } from "./math/trig";
import type { InitialUnit, MatchSetup } from "./rules";
import { generateTerrain } from "./terrain";

/** Lancers that back the Overseer in {@link createDuelMatch}. */
const DUEL_LANCERS = 20;

/**
 * A short real-content match for end-to-end checks of victory: on a flat 1 km map, a
 * Directorate Overseer and a wing of Lancers (slot 0, team 0) face a lone Scrapborn Warboss
 * (slot 1, team 1) out of its reach. With {@link duelCommands} slot 0 destroys the Warboss
 * within seconds, which ends the match in slot 0's favour.
 */
export function createDuelMatch(): MatchSetup {
  const overseer = rulesetUnit(RULESET, "dir_overseer").index;
  const lancer = rulesetUnit(RULESET, "dir_lancer").index;
  const warboss = rulesetUnit(RULESET, "scr_warboss").index;
  const initialUnits: InitialUnit[] = [
    { slot: 0, type: overseer, x: 400, z: 500, heading: HALF_PI },
    { slot: 1, type: warboss, x: 650, z: 500, heading: -HALF_PI },
  ];
  for (let k = 0; k < DUEL_LANCERS; k++) {
    initialUnits.push({
      slot: 0,
      type: lancer,
      x: 360 + (k % 5) * 12,
      z: 440 + Math.floor(k / 5) * 40,
      heading: HALF_PI,
    });
  }
  return {
    seed: 7,
    terrain: generateTerrain({ seed: 7, cells: 128, cellSize: 8, amplitude: 0, wavelength: 100 }),
    players: [
      { slot: 0, team: 0, factionId: "directorate", color: "#4fd1c5" },
      { slot: 1, team: 1, factionId: "scrapborn", color: "#e0902f" },
    ],
    ruleset: RULESET,
    initialUnits,
  };
}

/** The duel's only order: every slot-0 unit attacks the Warboss. Send it on tick 0. */
export function duelCommands(setup: MatchSetup): PlayerCommand[] {
  const id = (i: number): number => (1 << 20) | i;
  const ours = setup.initialUnits.flatMap((u, i) => (u.slot === 0 ? [id(i)] : []));
  const target = setup.initialUnits.findIndex((u) => u.slot === 1);
  return [{ t: "attack", slot: 0, units: ours, target: id(target) }];
}

import { RULESET, getMap } from "@stratcom/data";
import { createTestMatch, scriptedCommands } from "./scenario";
import { Simulation } from "./simulation";
import { createSkirmishSetup } from "./skirmish";

/** Ticks simulated by {@link runDetScenario}. */
export const DET_TICKS = 1000;

/**
 * The cross-runtime determinism scenario (docs/PLAN.md §4.2): 500 units, 3 players, a
 * scripted command stream, 1,000 ticks. Returns the state hash every 100 ticks. Node,
 * Chromium, Firefox and WebKit must all return exactly the same array; CI enforces it with
 * `e2e/determinism.spec.ts`.
 */
export function runDetScenario(): number[] {
  const setup = createTestMatch(500, 0xdecaf, 3);
  const sim = new Simulation(setup);
  const hashes: number[] = [];
  for (let t = 0; t < DET_TICKS; t++) {
    sim.step(scriptedCommands(setup, sim.tick));
    if ((t + 1) % 100 === 0) hashes.push(sim.stateHash());
  }
  return hashes;
}

/** Ticks simulated by {@link runSkirmishDetScenario}. */
export const SKIRMISH_DET_TICKS = 600;

/**
 * The determinism scenario for real content: a 4-player 2v2 on Rustbelt Ridge with the
 * built-in ruleset (both factions, every movement class, flattened start plateaus), driven
 * by the same scripted orders as {@link runDetScenario}. Returns the ruleset hash followed by
 * the state hash every 100 ticks.
 *
 * Unlike {@link runDetScenario} these values are not pinned, because any rebalance changes
 * them. What must hold is that every runtime returns the same array.
 */
export function runSkirmishDetScenario(): number[] {
  const factions = ["directorate", "scrapborn", "scrapborn", "directorate"];
  const setup = createSkirmishSetup({
    seed: 0xc0ffee,
    map: getMap("rustbelt_ridge"),
    ruleset: RULESET,
    players: factions.map((factionId, slot) => ({
      slot,
      team: slot % 2,
      factionId,
      color: "#ffffff",
    })),
  });
  const sim = new Simulation(setup);
  const hashes = [RULESET.hash];
  for (let t = 0; t < SKIRMISH_DET_TICKS; t++) {
    sim.step(scriptedCommands(setup, sim.tick));
    if ((t + 1) % 100 === 0) hashes.push(sim.stateHash());
  }
  return hashes;
}

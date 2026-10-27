import { createTestMatch, scriptedCommands } from "./scenario";
import { Simulation } from "./simulation";

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

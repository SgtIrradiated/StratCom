import { MAX_PLAYERS } from "./economy";

/** Marks a slot with no player in {@link denseTeams}. */
export const NO_TEAM = 255;

/**
 * Dense team index (0 … teams - 1, in ascending team-number order) per player slot, and the
 * number of teams. The simulation keeps per-team state (vision) by dense index; the client
 * uses the same mapping to read it.
 */
export function denseTeams(players: readonly { slot: number; team: number }[]): {
  teamOf: Uint8Array;
  count: number;
} {
  const teams = [...new Set(players.map((p) => p.team))].sort((a, b) => a - b);
  const teamOf = new Uint8Array(MAX_PLAYERS).fill(NO_TEAM);
  for (const p of players) teamOf[p.slot] = teams.indexOf(p.team);
  return { teamOf, count: teams.length };
}

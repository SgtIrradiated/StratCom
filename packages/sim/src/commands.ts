/** A point on the ground plane, in metres. */
export interface Vec2 {
  x: number;
  z: number;
}

/**
 * The only way to change game state (docs/PLAN.md §6.3). Every command names the issuing
 * player slot; the simulation validates ownership, so a malformed or hostile command is a
 * no-op on every peer. Commands are plain JSON-serialisable data.
 */
export type PlayerCommand =
  | { t: "move"; slot: number; units: readonly number[]; to: Vec2 }
  | { t: "stop"; slot: number; units: readonly number[] };

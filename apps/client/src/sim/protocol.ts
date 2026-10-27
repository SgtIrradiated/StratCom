import type { MatchSetup, PlayerCommand, SnapshotBuffers } from "@stratcom/sim";

/** Messages from the main thread to the sim worker. */
export type ToWorker =
  | {
      type: "init";
      setup: MatchSetup;
      snapshotCount: number;
      /** Drive the match with the built-in scripted commands (demo and `?bench=N`). */
      scripted: boolean;
    }
  | { type: "commands"; commands: PlayerCommand[] }
  | { type: "recycle"; snapshot: SnapshotBuffers }
  | { type: "pause"; paused: boolean };

/** Rolling performance figures reported by the worker. */
export interface SimStats {
  /** Mean milliseconds per `Simulation.step` over the last reporting window. */
  avgTickMs: number;
  /** Worst `step` in the window. */
  maxTickMs: number;
  /** Hash of the sim state after the latest tick. */
  hash: number;
  entityCount: number;
}

/** Messages from the sim worker to the main thread. */
export type FromWorker =
  | { type: "ready" }
  | { type: "snapshot"; snapshot: SnapshotBuffers }
  | { type: "stats"; stats: SimStats }
  | { type: "error"; message: string };

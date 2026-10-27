/**
 * Things that happened during a tick, for effects and sounds. Events are presentation only:
 * they are not simulation state, are not hashed, and may be dropped (see
 * {@link MAX_PENDING_EVENTS}) without affecting the match.
 */
export type SimEvent =
  /** A weapon fired from (`x`, `z`) at (`tx`, `tz`). */
  | {
      t: "fire";
      weapon: number;
      owner: number;
      x: number;
      z: number;
      tx: number;
      tz: number;
    }
  /** A unit of `type` owned by `owner` was destroyed at (`x`, `z`). */
  | { t: "death"; type: number; owner: number; x: number; z: number };

/** Events kept between snapshots; any beyond this are dropped until the next snapshot. */
export const MAX_PENDING_EVENTS = 2048;

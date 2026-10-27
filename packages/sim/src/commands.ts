/** A point on the ground plane, in metres. */
export interface Vec2 {
  x: number;
  z: number;
}

/** Structure orientation in quarter turns; 0 faces +z. Odd facings swap the footprint. */
export type Facing = 0 | 1 | 2 | 3;

/**
 * The only way to change game state (docs/PLAN.md §6.3). Every command names the issuing
 * player slot; the simulation validates ownership, so a malformed or hostile command is a
 * no-op on every peer. Commands are plain JSON-serialisable data.
 *
 * Orders with `queue: true` are appended to each unit's order queue (Shift in the UI);
 * otherwise they replace it.
 */
export type PlayerCommand =
  /** Mobile units walk to `to`. */
  | { t: "move"; slot: number; units: readonly number[]; to: Vec2; queue?: boolean }
  /** Clears order queues; for factories, also the production queue. */
  | { t: "stop"; slot: number; units: readonly number[] }
  /**
   * Mobile builders walk to `at` and construct a structure of `unitType` there. The site is
   * snapped to the terrain grid (or to the nearest deposit for extractors). Builders that
   * cannot build the type ignore the command.
   */
  | {
      t: "build";
      slot: number;
      units: readonly number[];
      unitType: number;
      at: Vec2;
      facing?: Facing;
      queue?: boolean;
    }
  /**
   * Armed units attack `target`, a hostile unit: mobile ones chase it into weapon range. Every
   * weapon that can reach it fires at it; unarmed units ignore the command.
   */
  | { t: "attack"; slot: number; units: readonly number[]; target: number; queue?: boolean }
  /** Mobile builders reclaim a feature or one of the player's own structures. */
  | { t: "reclaim"; slot: number; units: readonly number[]; target: number; queue?: boolean }
  /**
   * Mobile builders help `target`: finish it if unfinished, repair it if damaged, or put
   * their build power into whatever it is building or producing.
   */
  | { t: "assist"; slot: number; units: readonly number[]; target: number; queue?: boolean }
  /**
   * Factories add `count` units of `unitType` to the end of their production queue, or
   * remove that many from the end when `count` is negative.
   */
  | { t: "produce"; slot: number; units: readonly number[]; unitType: number; count: number }
  /** Factories send finished units to `to`. */
  | { t: "rally"; slot: number; units: readonly number[]; to: Vec2 };

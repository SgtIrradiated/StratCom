import { ECON_STRIDE, MAX_PLAYERS, readEconomy, type PlayerEconomy } from "./economy";
import type { SimEvent } from "./events";
import { PROJECTILE_CAPACITY } from "./projectiles";

/** One factory's production queue, as shown in the HUD. */
export interface ProductionInfo {
  /** Factory entity id. */
  id: number;
  /** Unit type ids, head (in production) first. */
  queue: number[];
  /** Progress of the head of the queue, in [0, 1]. */
  progress: number;
}

/**
 * Render snapshot: a compact, transferable copy of everything the renderer and HUD need.
 * Arrays are capacity-sized and reused; only the first `count` entries are valid. Entries
 * appear in ascending entity-slot order.
 *
 * The renderer interpolates between `prevX/prevZ` (position at the start of the tick) and
 * `x/z` (position at its end), so one snapshot is enough to draw smoothly.
 */
export interface SnapshotBuffers {
  /** Simulation tick this snapshot was taken after. */
  tick: number;
  /** Number of valid entries. */
  count: number;
  ids: Uint32Array;
  /** `EntityKind` per entry: unit or feature. */
  kinds: Uint8Array;
  /** Unit type id, or feature type id for features. */
  types: Uint16Array;
  /** Player slot, or `NEUTRAL_OWNER` for features. */
  owners: Uint8Array;
  prevX: Float32Array;
  prevZ: Float32Array;
  x: Float32Array;
  z: Float32Array;
  heading: Float32Array;
  /** Build progress for units (1 = complete); remaining salvage fraction for features. */
  progress: Float32Array;
  /** Health as a fraction of maximum for units; 0 for features. */
  health: Float32Array;
  /** Number of valid projectile entries. */
  projectileCount: number;
  /** Projectile ground positions at the start and end of the tick. */
  projPrevX: Float32Array;
  projPrevZ: Float32Array;
  projX: Float32Array;
  projZ: Float32Array;
  /** Fraction of each projectile's flight done, for arcs. */
  projT: Float32Array;
  /** Weapon id of each projectile. */
  projWeapon: Uint16Array;
  /** Per-player economy, `ECON_STRIDE` figures per slot laid out by `Econ`. */
  economy: Float64Array;
  /**
   * Factories with a non-empty queue. Small and variable-sized, so it is structured-cloned
   * rather than transferred.
   */
  production: ProductionInfo[];
  /** What happened since the previous snapshot (shots, deaths). Structured-cloned. */
  events: SimEvent[];
}

/** Allocates snapshot buffers able to hold `capacity` entities. */
export function createSnapshotBuffers(capacity: number): SnapshotBuffers {
  return {
    tick: 0,
    count: 0,
    ids: new Uint32Array(capacity),
    kinds: new Uint8Array(capacity),
    types: new Uint16Array(capacity),
    owners: new Uint8Array(capacity),
    prevX: new Float32Array(capacity),
    prevZ: new Float32Array(capacity),
    x: new Float32Array(capacity),
    z: new Float32Array(capacity),
    heading: new Float32Array(capacity),
    progress: new Float32Array(capacity),
    health: new Float32Array(capacity),
    projectileCount: 0,
    projPrevX: new Float32Array(PROJECTILE_CAPACITY),
    projPrevZ: new Float32Array(PROJECTILE_CAPACITY),
    projX: new Float32Array(PROJECTILE_CAPACITY),
    projZ: new Float32Array(PROJECTILE_CAPACITY),
    projT: new Float32Array(PROJECTILE_CAPACITY),
    projWeapon: new Uint16Array(PROJECTILE_CAPACITY),
    economy: new Float64Array(MAX_PLAYERS * ECON_STRIDE),
    production: [],
    events: [],
  };
}

/**
 * The `ArrayBuffer`s backing a snapshot, for use as a `postMessage` transfer list: every
 * typed-array field, found at run time, so a new array is transferred without being listed.
 */
export function snapshotTransferList(s: SnapshotBuffers): ArrayBuffer[] {
  return Object.values(s)
    .filter((v): v is ArrayBufferView => ArrayBuffer.isView(v))
    .map((a) => a.buffer as ArrayBuffer);
}

/** One player's economy as of this snapshot. */
export function snapshotEconomy(s: SnapshotBuffers, slot: number): PlayerEconomy {
  return readEconomy(s.economy, slot);
}

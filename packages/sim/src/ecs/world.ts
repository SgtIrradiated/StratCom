import { assert } from "@stratcom/shared";
import type { StateHasher } from "../math/hash";
import { MAX_ENTITIES, entityGeneration, entityIndex, makeEntityId, type EntityId } from "./entity";

/** What an entity is. `type` indexes a different table for each kind. */
export const EntityKind = {
  /** A unit or structure: `type` indexes `SimRuleset.units`. */
  unit: 0,
  /** Neutral debris or a wreck: `type` indexes `SimRuleset.features`. */
  feature: 1,
} as const;
export type EntityKind = (typeof EntityKind)[keyof typeof EntityKind];

/** Owner of entities that belong to no player (features). */
export const NEUTRAL_OWNER = 255;

/** Parameters for {@link World.spawn}. */
export interface SpawnParams {
  /** Defaults to {@link EntityKind.unit}. */
  kind?: EntityKind;
  /** Index into the match's unit-type (or feature-type) table. */
  type: number;
  /** Owning player slot, or {@link NEUTRAL_OWNER}. */
  owner: number;
  x: number;
  z: number;
  /** Initial heading in radians; 0 faces +z. */
  heading?: number;
  /** Build progress in [0, 1]; defaults to 1 (complete). */
  progress?: number;
  /** Hit points; defaults to 0. Units must be given theirs (features have none). */
  health?: number;
}

/**
 * Structure-of-arrays entity store (ADR-0005).
 *
 * Components are parallel typed arrays indexed by entity slot. Slots are recycled through a
 * free list (LIFO, so allocation order is deterministic) and each reuse bumps the slot's
 * generation, which invalidates stale {@link EntityId}s. Systems iterate `0 … highWater`
 * in ascending order and skip slots where `alive[i] === 0`.
 */
export class World {
  /** One past the highest slot ever used. Iterate `0 … highWater - 1`. */
  highWater = 0;
  /** Number of live entities. */
  liveCount = 0;

  readonly alive: Uint8Array;
  readonly generation: Uint16Array;
  /** {@link EntityKind} per slot. */
  readonly kind: Uint8Array;
  readonly type: Uint16Array;
  readonly owner: Uint8Array;
  readonly x: Float64Array;
  readonly z: Float64Array;
  /** Position at the start of the current tick, for render interpolation. */
  readonly prevX: Float64Array;
  readonly prevZ: Float64Array;
  readonly heading: Float64Array;
  /**
   * Units: build progress, 1 when complete. Unfinished units do nothing until built.
   * Features: the fraction of their salvage not yet reclaimed.
   */
  readonly progress: Float64Array;
  /** Units: current hit points. A unit at or below 0 is destroyed at the end of the tick. */
  readonly health: Float64Array;

  private readonly freeList: number[] = [];

  /** @param capacity Maximum live entities (at most {@link MAX_ENTITIES}). */
  constructor(readonly capacity: number) {
    assert(capacity > 0 && capacity <= MAX_ENTITIES, `capacity out of range: ${capacity}`);
    this.alive = new Uint8Array(capacity);
    this.generation = new Uint16Array(capacity);
    this.kind = new Uint8Array(capacity);
    this.type = new Uint16Array(capacity);
    this.owner = new Uint8Array(capacity);
    this.x = new Float64Array(capacity);
    this.z = new Float64Array(capacity);
    this.prevX = new Float64Array(capacity);
    this.prevZ = new Float64Array(capacity);
    this.heading = new Float64Array(capacity);
    this.progress = new Float64Array(capacity);
    this.health = new Float64Array(capacity);
  }

  /** Creates an entity and returns its id. Throws if the world is full. */
  spawn(params: SpawnParams): EntityId {
    const reused = this.freeList.pop();
    const i = reused ?? this.highWater++;
    assert(i < this.capacity, "World is full");
    let gen = (this.generation[i] ?? 0) + 1;
    if (gen > 0xfff) gen = 1; // 12-bit generation; never 0 so that id 0 stays invalid
    this.generation[i] = gen;
    this.alive[i] = 1;
    this.kind[i] = params.kind ?? EntityKind.unit;
    this.type[i] = params.type;
    this.owner[i] = params.owner;
    this.x[i] = this.prevX[i] = params.x;
    this.z[i] = this.prevZ[i] = params.z;
    this.heading[i] = params.heading ?? 0;
    this.progress[i] = params.progress ?? 1;
    this.health[i] = params.health ?? 0;
    this.liveCount++;
    return makeEntityId(i, gen);
  }

  /** Removes an entity. Returns false if the id was stale. */
  despawn(id: number): boolean {
    const i = this.resolve(id);
    if (i < 0) return false;
    this.alive[i] = 0;
    this.freeList.push(i);
    this.liveCount--;
    return true;
  }

  /** Slot index for a live id, or -1 if the id is stale, unknown or malformed. */
  resolve(id: number): number {
    if (!Number.isInteger(id) || id <= 0 || id > 0xffffffff) return -1;
    const i = entityIndex(id);
    if (i >= this.highWater || this.alive[i] === 0) return -1;
    return this.generation[i] === entityGeneration(id) ? i : -1;
  }

  /** The id currently stored at a live slot. */
  idAt(i: number): EntityId {
    return makeEntityId(i, this.generation[i] ?? 0);
  }

  /** Mixes all world state into `h`, in slot order. */
  hashInto(h: StateHasher): void {
    h.u32(this.highWater).u32(this.liveCount);
    for (const slot of this.freeList) h.u32(slot);
    for (let i = 0; i < this.highWater; i++) {
      h.u32(this.alive[i] ?? 0);
      if (this.alive[i] === 0) continue;
      h.u32(this.generation[i] ?? 0)
        .u32(this.kind[i] ?? 0)
        .u32(this.type[i] ?? 0)
        .u32(this.owner[i] ?? 0)
        .f64(this.x[i] ?? 0)
        .f64(this.z[i] ?? 0)
        .f64(this.heading[i] ?? 0)
        .f64(this.progress[i] ?? 0)
        .f64(this.health[i] ?? 0);
    }
  }
}

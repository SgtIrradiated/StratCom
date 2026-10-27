import type { Brand } from "@stratcom/shared";

/** Generational entity id: low 20 bits are the slot index, high 12 bits the generation. */
export type EntityId = Brand<number, "EntityId">;

const INDEX_BITS = 20;
const INDEX_MASK = (1 << INDEX_BITS) - 1;
const GENERATION_MASK = (1 << (32 - INDEX_BITS)) - 1;

/** Maximum number of simultaneously live entities. */
export const MAX_ENTITIES = 1 << INDEX_BITS;

/**
 * Builds an id from a slot index and generation. Generations start at 1, so id 0 is never
 * a valid entity and can mean "none".
 */
export function makeEntityId(index: number, generation: number): EntityId {
  return ((((generation & GENERATION_MASK) << INDEX_BITS) | index) >>> 0) as EntityId;
}

/** Slot index of an id. */
export function entityIndex(id: number): number {
  return id & INDEX_MASK;
}

/** Generation of an id. */
export function entityGeneration(id: number): number {
  return (id >>> INDEX_BITS) & GENERATION_MASK;
}

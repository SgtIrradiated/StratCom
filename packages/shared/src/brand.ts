declare const brand: unique symbol;

/**
 * Nominal ("branded") type. Prevents mixing structurally identical values such as
 * entity ids and player ids.
 *
 * @example
 * type EntityId = Brand<number, "EntityId">;
 * const id = 5 as EntityId;
 */
export type Brand<T, Name extends string> = T & { readonly [brand]: Name };

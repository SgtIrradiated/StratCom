/**
 * @stratcom/sim — the deterministic game simulation.
 *
 * M0 ships only the deterministic math foundation. The ECS world, systems and
 * snapshot API described in docs/PLAN.md §4.4 and §6.2 are built in M1.
 */
export * from "./math/index";

/** Fixed simulation rate in ticks per second (ADR-0007). */
export const TICK_RATE = 20;

/** Duration of one simulation tick in milliseconds. */
export const TICK_MS = 1000 / TICK_RATE;

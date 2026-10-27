/**
 * @stratcom/sim — the deterministic game simulation.
 *
 * `Simulation` is the public entry point (docs/PLAN.md §6.2): construct it from a
 * `MatchSetup`, call `step(commands)` once per tick, and read `stateHash()` and
 * `writeSnapshot()`. Deterministic math lives in `@stratcom/sim/math`.
 */
export * from "./math/index";
export type { PlayerCommand, Vec2 } from "./commands";
export { MAX_ENTITIES, World, entityGeneration, entityIndex, type EntityId } from "./ecs/index";
export {
  TEST_MOVEMENT_CLASSES,
  TEST_UNIT_TYPES,
  createTestMatch,
  scriptedCommands,
} from "./scenario";
export {
  NEIGHBOURS,
  UNREACHABLE,
  buildNavGrid,
  cellAt,
  computeFlowCosts,
  flowDirection,
  hasLineOfSight,
  nearestPassable,
  type FlowField,
  type NavGrid,
} from "./navigation";
export { SpatialGrid } from "./spatialGrid";
export {
  generateTerrain,
  raycastTerrain,
  sampleHeight,
  terrainDepth,
  terrainWidth,
  type Terrain,
  type TerrainParams,
} from "./terrain";
export {
  Simulation,
  TICK_MS,
  TICK_RATE,
  type InitialUnit,
  type MovementClassDef,
  type MatchSetup,
  type PlayerSetup,
  type UnitTypeStats,
} from "./simulation";
export { DET_TICKS, runDetScenario } from "./detcheck";
export { createSnapshotBuffers, snapshotTransferList, type SnapshotBuffers } from "./snapshot";

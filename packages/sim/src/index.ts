/**
 * @stratcom/sim — the deterministic game simulation.
 *
 * `Simulation` is the public entry point (docs/PLAN.md §6.2): construct it from a
 * `MatchSetup`, call `step(commands)` once per tick, and read `stateHash()` and
 * `writeSnapshot()`. Deterministic math lives in `@stratcom/sim/math`.
 */
export * from "./math/index";
export type { Facing, PlayerCommand, Vec2 } from "./commands";
export {
  ECON_STRIDE,
  Econ,
  MAX_PLAYERS,
  readEconomy,
  stallFactor,
  type PlayerEconomy,
} from "./economy";
export {
  EntityKind,
  MAX_ENTITIES,
  NEUTRAL_OWNER,
  World,
  entityGeneration,
  entityIndex,
  type EntityId,
} from "./ecs/index";
export {
  BUILD_MAX_SLOPE,
  DEPOSIT_SNAP_RADIUS,
  distanceToFootprint,
  facingHeading,
  footprintAt,
  headingFacing,
  placementProblem,
  snapSite,
  toFacing,
  type Footprint,
  type PlacementProblem,
  type PlacementStats,
} from "./placement";
export {
  TEST_MOVEMENT_CLASSES,
  TEST_RULESET,
  TEST_FEATURES,
  TEST_UNIT_TYPES,
  TEST_WEAPONS,
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
  type Plateau,
  type Terrain,
  type TerrainParams,
} from "./terrain";
export {
  createSkirmishSetup,
  generateMapTerrain,
  mapDeposits,
  mapFeatures,
  type SkirmishOptions,
} from "./skirmish";
export type { SimEvent } from "./events";
export { MAX_PENDING_EVENTS } from "./events";
export { PROJECTILE_CAPACITY } from "./projectiles";
export { RETARGET_TICKS } from "./systems/combat";
export type { PlayerCombatStats } from "./systems/health";
export type { MatchStatus, PlayerStatus, VictoryRule } from "./systems/victory";
export {
  MAX_WEAPONS,
  Simulation,
  TICK_MS,
  TICK_RATE,
  setupCapacity,
  type FeatureTypeStats,
  type InitialFeature,
  type InitialUnit,
  type MatchRules,
  type MovementClassDef,
  type MatchSetup,
  type PlayerSetup,
  type SimRuleset,
  type UnitTypeStats,
  type WeaponStats,
} from "./simulation";
export { createDuelMatch, duelCommands } from "./duel";
export { DET_TICKS, SKIRMISH_DET_TICKS, runDetScenario, runSkirmishDetScenario } from "./detcheck";
export {
  createSnapshotBuffers,
  snapshotEconomy,
  snapshotTransferList,
  type ProductionInfo,
  type SnapshotBuffers,
} from "./snapshot";

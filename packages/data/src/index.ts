import { RAW_FEATURES } from "./features";
import { CONTENT_PACKS } from "./factions/index";
import { RAW_MOVEMENT_CLASSES } from "./movement";
import { compileRuleset, type CompiledRuleset } from "./ruleset";

export { CONTENT_PACKS, FACTIONS, getFaction, validateFactions } from "./factions/index";
export type { ContentPack } from "./factions/index";
export { RAW_FEATURES } from "./features";
export { MAPS, getMap, validateMaps } from "./maps/index";
export { RAW_MOVEMENT_CLASSES } from "./movement";
export {
  RulesetError,
  compileRuleset,
  rulesetFaction,
  rulesetFeature,
  rulesetUnit,
  type CompiledFaction,
  type CompiledFeature,
  type CompiledMovementClass,
  type CompiledRuleset,
  type CompiledUnit,
  type CompiledWeapon,
  type RulesetSource,
} from "./ruleset";
export { ContentId, HexColor } from "./schema/common";
export { FactionDef, FactionTheme, StartingUnit, type FactionInput } from "./schema/faction";
export { FeatureDef, type FeatureInput } from "./schema/feature";
export { DebrisField, MapDef, MapPoint, StartPosition, type MapInput } from "./schema/map";
export {
  IconShape,
  MovementClassDef,
  Placement,
  UnitDef,
  UnitRole,
  WeaponDef,
  WeaponKind,
  type UnitInput,
  type WeaponInput,
} from "./schema/unit";

/**
 * The built-in ruleset: every content pack, compiled once at module load. Bad content throws
 * here, at start-up, never mid-match (ADR-0006).
 */
export const RULESET: CompiledRuleset = compileRuleset({
  movementClasses: RAW_MOVEMENT_CLASSES,
  features: RAW_FEATURES,
  packs: CONTENT_PACKS,
});

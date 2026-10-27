import type { CompiledRuleset } from "@stratcom/data";
import type { FeatureVisual, UnitVisual, WeaponKind } from "../render/types";

/** Placeholder looks for every unit type in a ruleset, indexed by unit type id. */
export function visualsFromRuleset(ruleset: CompiledRuleset): UnitVisual[] {
  return ruleset.units.map((u) => ({
    size: u.visual.size,
    radius: u.radius,
    icon: u.visual.icon,
  }));
}

/** Placeholder looks for every feature type in a ruleset, indexed by feature type id. */
export function featureVisualsFromRuleset(ruleset: CompiledRuleset): FeatureVisual[] {
  return ruleset.features.map((f) => ({ size: f.visual.size, color: f.visual.color }));
}

/** Kind of every weapon in a ruleset, indexed by weapon id, for its effects. */
export function weaponKindsFromRuleset(ruleset: CompiledRuleset): WeaponKind[] {
  return ruleset.weapons.map((w) => w.kind);
}

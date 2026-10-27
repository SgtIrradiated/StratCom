import type { CompiledRuleset } from "@stratcom/data";
import type { UnitVisual } from "../render/types";

/** Placeholder looks for every unit type in a ruleset, indexed by unit type id. */
export function visualsFromRuleset(ruleset: CompiledRuleset): UnitVisual[] {
  return ruleset.units.map((u) => ({
    size: u.visual.size,
    radius: u.radius,
    icon: u.visual.icon,
  }));
}

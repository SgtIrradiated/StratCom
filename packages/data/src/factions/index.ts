import { assert } from "@stratcom/shared";
import { FactionDef, type FactionInput } from "../schema/faction";
import type { UnitInput, WeaponInput } from "../schema/unit";
import { directorate } from "./directorate/faction";
import { directorateUnits, directorateWeapons } from "./directorate/units";
import { scrapborn } from "./scrapborn/faction";
import { scrapbornUnits, scrapbornWeapons } from "./scrapborn/units";

/** Everything one faction contributes: its definition, units and weapons, as authored. */
export interface ContentPack {
  faction: FactionInput;
  units: readonly UnitInput[];
  weapons: readonly WeaponInput[];
}

/**
 * Every faction's content pack, in display order. To add a faction, create
 * `src/factions/<id>/` with `faction.ts` and `units.ts` and append it here. No engine
 * changes are needed (docs/content-authoring.md).
 */
export const CONTENT_PACKS: readonly ContentPack[] = [
  { faction: directorate, units: directorateUnits, weapons: directorateWeapons },
  { faction: scrapborn, units: scrapbornUnits, weapons: scrapbornWeapons },
];

/** Parses faction definitions and rejects duplicate ids. Throws a descriptive error. */
export function validateFactions(raw: readonly unknown[]): readonly FactionDef[] {
  const factions = raw.map((f, i) => {
    const result = FactionDef.safeParse(f);
    if (!result.success) {
      throw new Error(`Invalid faction at index ${i}:\n${result.error.message}`);
    }
    return result.data;
  });
  const ids = new Set<string>();
  for (const f of factions) {
    assert(!ids.has(f.id), `Duplicate faction id "${f.id}"`);
    ids.add(f.id);
  }
  return factions;
}

/** Validated faction registry. Validation runs once at module load, so bad data fails fast. */
export const FACTIONS: readonly FactionDef[] = validateFactions(
  CONTENT_PACKS.map((p) => p.faction),
);

/** Looks up a faction by id. Throws if the id is unknown. */
export function getFaction(id: string): FactionDef {
  const faction = FACTIONS.find((f) => f.id === id);
  assert(faction, `Unknown faction "${id}"`);
  return faction;
}

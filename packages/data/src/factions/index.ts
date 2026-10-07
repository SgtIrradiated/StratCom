import { assert } from "@stratcom/shared";
import { FactionDef } from "../schema/faction";
import { directorate } from "./directorate";
import { scrapborn } from "./scrapborn";

/**
 * Every playable faction, in display order. To add a faction, create
 * `src/factions/<id>.ts` and append it here. No engine changes are needed.
 */
const RAW_FACTIONS: readonly FactionDef[] = [directorate, scrapborn];

/** Parses and cross-checks faction definitions. Throws a descriptive error on bad data. */
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
export const FACTIONS: readonly FactionDef[] = validateFactions(RAW_FACTIONS);

/** Looks up a faction by id. Throws if the id is unknown. */
export function getFaction(id: string): FactionDef {
  const faction = FACTIONS.find((f) => f.id === id);
  assert(faction, `Unknown faction "${id}"`);
  return faction;
}

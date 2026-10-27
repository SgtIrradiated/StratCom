import { z } from "zod";
import { ContentId, HexColor } from "./common";

/**
 * Visual identity of a faction. Drives the faction-select screen, the HUD skin and the
 * placeholder renderer until real art exists.
 */
export const FactionTheme = z.object({
  /** Terminal text colour for this faction's UI (green or amber phosphor). */
  phosphor: HexColor,
  /** Highlight colour: buttons, selection rings, energy effects. */
  accent: HexColor,
  /** Dominant hull/armour colour used by placeholder meshes. */
  base: HexColor,
  /** CSS skin applied to the HUD. New skins need a matching stylesheet in apps/client. */
  uiSkin: z.enum(["terminal-clean", "terminal-rust"]),
  /**
   * Player colours offered on the faction-select screen, in preference order. At least 8,
   * so every slot of an 8-player match can get a distinct colour.
   */
  teamColors: z
    .array(HexColor)
    .min(8)
    .refine((c) => new Set(c.map((x) => x.toLowerCase())).size === c.length, "duplicate colour"),
});
export type FactionTheme = z.infer<typeof FactionTheme>;

/** Units placed next to the commander when a match starts. */
export const StartingUnit = z.object({
  /** Unit id; must belong to this faction. */
  unit: ContentId,
  count: z.number().int().min(1).max(20),
});
export type StartingUnit = z.infer<typeof StartingUnit>;

/**
 * A playable faction. Each faction is a content pack under `src/factions/<id>/` with its
 * faction, unit and weapon definitions. The roster is every unit whose `faction` is this id.
 */
export const FactionDef = z.object({
  id: ContentId,
  /** Display name, e.g. "The Atomic Directorate". */
  name: z.string().min(1),
  /** Short label for tight UI spots, e.g. "Directorate". */
  shortName: z.string().min(1).max(16),
  /** One-line pitch shown on the faction card. */
  tagline: z.string().min(1),
  /** Short lore paragraph shown on the faction-select screen. */
  lore: z.string().min(1),
  /** Title of the faction's commander, e.g. "Overseer". */
  commanderTitle: z.string().min(1),
  /** Unit id of the commander every player of this faction starts with. */
  commanderUnit: ContentId,
  /**
   * Extra units spawned around the commander. Supreme Commander-style starts use only the
   * commander; until construction arrives (M4) this gives each side something to command.
   */
  startingUnits: z.array(StartingUnit).default([]),
  /** Stored resources at tick 0. */
  startingResources: z.object({
    salvage: z.number().min(0),
    power: z.number().min(0),
  }),
  /**
   * Multiplier on salvage recovered by reclaiming features and wrecks. The Scrapborn
   * economy twist (docs/PLAN.md §2) lives here, as data.
   */
  reclaimMultiplier: z.number().positive().max(4).default(1),
  theme: FactionTheme,
});
/** A validated faction (defaults applied). */
export type FactionDef = z.infer<typeof FactionDef>;
/** A faction as authored, before defaults are applied. */
export type FactionInput = z.input<typeof FactionDef>;

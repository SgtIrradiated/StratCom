import { z } from "zod";

const hexColor = z.string().regex(/^#[0-9a-f]{6}$/i, "expected a #rrggbb colour");

/**
 * Visual identity of a faction. Drives the faction-select screen, the HUD skin and the
 * placeholder renderer until real art exists.
 */
export const FactionTheme = z.object({
  /** Terminal text colour for this faction's UI (green or amber phosphor). */
  phosphor: hexColor,
  /** Highlight colour: buttons, selection rings, energy effects. */
  accent: hexColor,
  /** Dominant hull/armour colour used by placeholder meshes. */
  base: hexColor,
  /** CSS skin applied to the HUD. New skins need a matching stylesheet in apps/client. */
  uiSkin: z.enum(["terminal-clean", "terminal-rust"]),
});
export type FactionTheme = z.infer<typeof FactionTheme>;

/**
 * A playable faction. One file per faction under `src/factions/<id>/`.
 * Fields for rosters, starting units and economy modifiers are added in M3/M4.
 */
export const FactionDef = z.object({
  /** Stable machine id (lowercase snake_case). Used in replays and the network protocol. */
  id: z.string().regex(/^[a-z][a-z0-9_]*$/, "lowercase snake_case"),
  /** Display name, e.g. "The Atomic Directorate". */
  name: z.string().min(1),
  /** Short label for tight UI spots, e.g. "Directorate". */
  shortName: z.string().min(1).max(16),
  /** One-line pitch shown on the faction card. */
  tagline: z.string().min(1),
  /** Short lore paragraph shown on the faction-select screen. */
  lore: z.string().min(1),
  /** Title of the faction's commander unit, e.g. "Overseer". */
  commanderTitle: z.string().min(1),
  theme: FactionTheme,
});
export type FactionDef = z.infer<typeof FactionDef>;

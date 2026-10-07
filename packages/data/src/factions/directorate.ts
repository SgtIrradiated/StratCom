import type { FactionDef } from "../schema/faction";

export const directorate = {
  id: "directorate",
  name: "The Atomic Directorate",
  shortName: "Directorate",
  tagline: "Order, progress, and a fusion reactor in every home.",
  lore:
    "When the bombs fell, the Directorate's engineers and administrators sealed themselves in " +
    "deep Shelters with their archives and their reactors intact. Two generations later the " +
    "blast doors are opening. The Overseers mean to reclaim the surface for civilization, " +
    "whether or not the surface wants to be reclaimed.",
  commanderTitle: "Overseer",
  theme: {
    phosphor: "#4cff7a",
    accent: "#3fd0c9",
    base: "#6b7a4f",
    uiSkin: "terminal-clean",
  },
} as const satisfies FactionDef;

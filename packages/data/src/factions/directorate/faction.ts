import type { FactionInput } from "../../schema/faction";

/** The Atomic Directorate: expensive, durable, long-range energy weapons. */
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
  commanderUnit: "dir_overseer",
  startingUnits: [
    { unit: "dir_technician", count: 2 },
    { unit: "dir_warden", count: 4 },
    { unit: "dir_lancer", count: 1 },
  ],
  startingResources: { salvage: 650, power: 2500 },
  theme: {
    phosphor: "#4cff7a",
    accent: "#3fd0c9",
    base: "#6b7a4f",
    uiSkin: "terminal-clean",
    teamColors: [
      "#3fd0c9",
      "#e8e0c0",
      "#8fae55",
      "#5aa0e6",
      "#b8c4cc",
      "#2fae7a",
      "#9b7fe0",
      "#e0c050",
    ],
  },
} satisfies FactionInput;

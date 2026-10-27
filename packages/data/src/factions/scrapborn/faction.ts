import type { FactionInput } from "../../schema/faction";

/** The Scrapborn Clans: cheap, numerous, fast, short-range ballistics and flamers. */
export const scrapborn = {
  id: "scrapborn",
  name: "The Scrapborn Clans",
  shortName: "Scrapborn",
  tagline: "If it moves, armor it. If it doesn't, salvage it.",
  lore:
    "The Scrapborn never had a Shelter. They grew up in the ash, raiding convoys, stripping " +
    "ruins, and welding the old world's wreckage into war machines. The clans answer to " +
    "whichever Warboss rides the biggest rolling fortress, and every Directorate convoy looks " +
    "like spare parts to them.",
  commanderTitle: "Warboss",
  commanderUnit: "scr_warboss",
  startingUnits: [
    { unit: "scr_rig", count: 2 },
    { unit: "scr_buggy", count: 6 },
    { unit: "scr_crawler", count: 2 },
  ],
  startingResources: { salvage: 800, power: 1800 },
  theme: {
    phosphor: "#ffb000",
    accent: "#e8c547",
    base: "#8a4b2a",
    uiSkin: "terminal-rust",
    teamColors: [
      "#d0602c",
      "#f2c230",
      "#b0302a",
      "#d8c8a8",
      "#8fc23a",
      "#3a6fb0",
      "#c04890",
      "#5a5a5a",
    ],
  },
} satisfies FactionInput;

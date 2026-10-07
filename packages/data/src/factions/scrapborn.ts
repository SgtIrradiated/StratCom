import type { FactionDef } from "../schema/faction";

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
  theme: {
    phosphor: "#ffb000",
    accent: "#e8c547",
    base: "#8a4b2a",
    uiSkin: "terminal-rust",
  },
} as const satisfies FactionDef;

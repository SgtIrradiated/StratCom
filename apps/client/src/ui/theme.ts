import type { FactionDef } from "@stratcom/data";

/** Class and CSS custom properties that skin a subtree for a faction. */
export interface Skin {
  className: string;
  style: Record<string, string>;
}

/** The neutral skin used before a faction is chosen (main menu). */
const NEUTRAL: Skin = {
  className: "skin-terminal-clean",
  style: { "--phosphor": "#4cff7a", "--accent": "#3fd0c9" },
};

/**
 * The HUD skin for a faction (ADR-0006: the look comes from data). `uiSkin` picks the
 * stylesheet variant in `styles/terminal.css`; the colours come straight from the theme.
 */
export function skinFor(faction: FactionDef | undefined): Skin {
  if (!faction) return NEUTRAL;
  return {
    className: `skin-${faction.theme.uiSkin}`,
    style: { "--phosphor": faction.theme.phosphor, "--accent": faction.theme.accent },
  };
}

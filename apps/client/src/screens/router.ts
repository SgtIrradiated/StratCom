import type { SkirmishConfig } from "../game/skirmishConfig";

/** How a match ended, shown on the Results screen. */
export interface MatchResult {
  /** `surrender` ends the match as a loss; victory conditions arrive with combat in M5. */
  outcome: "victory" | "defeat" | "surrender";
  /** Simulation ticks played. */
  ticks: number;
  /** Fingerprint of the content the match ran on. */
  rulesetHash: number;
}

/**
 * The game-flow state machine (docs/PLAN.md §7). Game flow is linear and stateful, so this
 * is a tiny explicit machine rather than a URL router:
 *
 * ```
 * menu → setup → faction → loading → game → results → menu
 * ```
 *
 * Back steps one screen back before the match; quitting a match skips the results.
 */
export type Screen =
  | { id: "menu"; notice?: string }
  | { id: "setup"; config: SkirmishConfig }
  | { id: "faction"; config: SkirmishConfig }
  | { id: "loading"; config: SkirmishConfig }
  | { id: "game"; config: SkirmishConfig }
  | { id: "results"; config: SkirmishConfig; result: MatchResult };

/** Everything that can move the flow along. Events that don't apply to a screen are ignored. */
export type ScreenEvent =
  | { t: "skirmish"; config: SkirmishConfig }
  | { t: "configure"; config: SkirmishConfig }
  | { t: "next" }
  | { t: "back" }
  | { t: "loaded" }
  | { t: "failed"; message: string }
  | { t: "ended"; result: MatchResult }
  | { t: "quit" };

/** The screen after `event`. Pure; returns `screen` itself when the event doesn't apply. */
export function transition(screen: Screen, event: ScreenEvent): Screen {
  switch (screen.id) {
    case "menu":
      return event.t === "skirmish" ? { id: "setup", config: event.config } : screen;
    case "setup":
      if (event.t === "configure") return { id: "setup", config: event.config };
      if (event.t === "next") return { id: "faction", config: screen.config };
      if (event.t === "back") return { id: "menu" };
      return screen;
    case "faction":
      if (event.t === "configure") return { id: "faction", config: event.config };
      if (event.t === "next") return { id: "loading", config: screen.config };
      if (event.t === "back") return { id: "setup", config: screen.config };
      return screen;
    case "loading":
      if (event.t === "loaded") return { id: "game", config: screen.config };
      if (event.t === "failed") return { id: "menu", notice: event.message };
      if (event.t === "back") return { id: "setup", config: screen.config };
      return screen;
    case "game":
      if (event.t === "ended")
        return { id: "results", config: screen.config, result: event.result };
      if (event.t === "quit") return { id: "menu" };
      if (event.t === "failed") return { id: "menu", notice: event.message };
      return screen;
    case "results":
      if (event.t === "back") return { id: "menu" };
      if (event.t === "skirmish") return { id: "setup", config: event.config };
      return screen;
  }
}

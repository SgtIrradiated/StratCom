import { FACTIONS, MAPS } from "@stratcom/data";
import { describe, expect, it } from "vitest";
import { defaultSkirmish } from "../game/skirmishConfig";
import { transition, type Screen, type ScreenEvent } from "./router";

const config = defaultSkirmish({ factions: FACTIONS, maps: MAPS }, 1);
const result = { outcome: "surrender" as const, ticks: 1200, rulesetHash: 7, players: [] };

const run = (events: ScreenEvent[], from: Screen = { id: "menu" }): Screen =>
  events.reduce(transition, from);

describe("screen router", () => {
  it("walks the full skirmish flow and back to the menu", () => {
    const ids: string[] = [];
    let s: Screen = { id: "menu" };
    for (const e of [
      { t: "skirmish", config },
      { t: "next" },
      { t: "next" },
      { t: "loaded" },
      { t: "ended", result },
      { t: "back" },
    ] satisfies ScreenEvent[]) {
      s = transition(s, e);
      ids.push(s.id);
    }
    expect(ids).toEqual(["setup", "faction", "loading", "game", "results", "menu"]);
  });

  it("goes back one step at a time before the match starts", () => {
    const faction = run([{ t: "skirmish", config }, { t: "next" }]);
    expect(run([{ t: "back" }], faction).id).toBe("setup");
    expect(run([{ t: "back" }, { t: "back" }], faction).id).toBe("menu");
  });

  it("carries configuration changes forward", () => {
    const changed = { ...config, mapId: "glassed_flats" };
    const s = run([{ t: "skirmish", config }, { t: "configure", config: changed }, { t: "next" }]);
    expect(s).toEqual({ id: "faction", config: changed });
  });

  it("quits a running match straight to the menu", () => {
    const game = run([{ t: "skirmish", config }, { t: "next" }, { t: "next" }, { t: "loaded" }]);
    expect(transition(game, { t: "quit" })).toEqual({ id: "menu" });
  });

  it("returns to the menu with a notice when loading fails", () => {
    const s = run([
      { t: "skirmish", config },
      { t: "next" },
      { t: "next" },
      { t: "failed", message: "boom" },
    ]);
    expect(s).toEqual({ id: "menu", notice: "boom" });
  });

  it("ignores events that don't apply, returning the same object", () => {
    const menu: Screen = { id: "menu" };
    expect(transition(menu, { t: "next" })).toBe(menu);
    const game = run([{ t: "skirmish", config }, { t: "next" }, { t: "next" }, { t: "loaded" }]);
    expect(transition(game, { t: "back" })).toBe(game);
  });
});

import { FACTIONS, MAPS, getFaction, getMap } from "@stratcom/data";
import { describe, expect, it } from "vitest";
import {
  defaultSkirmish,
  localSlot,
  pickColor,
  toPlayers,
  validateSkirmish,
  withFaction,
  withMap,
  withSlot,
} from "./skirmishConfig";

const content = { factions: FACTIONS, maps: MAPS };

describe("skirmish slot model", () => {
  it("defaults to a valid 1v1: you against an AI of the other faction", () => {
    const c = defaultSkirmish(content, 5);
    expect(c.slots.map((s) => s.kind)).toEqual(["human", "ai", "closed", "closed"]);
    expect(c.slots[0]!.factionId).not.toBe(c.slots[1]!.factionId);
    expect(validateSkirmish(c, content)).toEqual([]);
    expect(localSlot(c)).toBe(0);
  });

  it("maps active slots to sim players, keeping slot numbers", () => {
    let c = defaultSkirmish(content, 5);
    c = withSlot(c, 1, { kind: "closed" });
    c = withSlot(c, 3, { kind: "ai", factionId: "scrapborn", color: "#123456" });
    expect(toPlayers(c).map((p) => p.slot)).toEqual([0, 3]);
    expect(toPlayers(c)[1]).toEqual({
      slot: 3,
      team: 3,
      factionId: "scrapborn",
      color: "#123456",
    });
  });

  it("reports unplayable setups", () => {
    const c = defaultSkirmish(content, 5);
    const sameTeam = withSlot(c, 1, { team: 0 });
    expect(validateSkirmish(sameTeam, content)).toContain("Every player is on one team.");
    const sameColour = withSlot(c, 1, { color: c.slots[0]!.color });
    expect(validateSkirmish(sameColour, content)).toContain("Two players share a colour.");
    const alone = withSlot(c, 1, { kind: "open" });
    expect(validateSkirmish(alone, content)).toContain("At least two players are needed.");
    const noHuman = withSlot(c, 0, { kind: "ai" });
    expect(validateSkirmish(noHuman, content)).toContain("Exactly one local player is needed.");
  });

  it("resizes slots when the map changes", () => {
    const c = withMap(defaultSkirmish(content, 5), getMap("glassed_flats"), content);
    expect(c.slots).toHaveLength(2);
    expect(validateSkirmish(c, content)).toEqual([]);
    const back = withMap(c, getMap("ashfall_basin"), content);
    expect(back.slots.map((s) => s.kind)).toEqual(["human", "ai", "closed", "closed"]);
  });

  it("keeps colours inside the chosen faction's palette and distinct", () => {
    const c = defaultSkirmish(content, 5);
    const dir = getFaction("directorate");
    const both = withFaction(c, 1, dir);
    expect(dir.theme.teamColors).toContain(both.slots[1]!.color);
    expect(both.slots[1]!.color).not.toBe(both.slots[0]!.color);
    expect(validateSkirmish(both, content)).toEqual([]);
    expect(pickColor(dir, dir.theme.teamColors.slice(0, 2))).toBe(dir.theme.teamColors[2]);
  });
});

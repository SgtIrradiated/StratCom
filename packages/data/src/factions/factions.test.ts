import { describe, expect, it } from "vitest";
import { FACTIONS, getFaction, validateFactions } from "./index";

describe("faction registry", () => {
  it("ships the two launch factions in display order", () => {
    expect(FACTIONS.map((f) => f.id)).toEqual(["directorate", "scrapborn"]);
  });

  it("looks factions up by id", () => {
    expect(getFaction("scrapborn").commanderTitle).toBe("Warboss");
    expect(() => getFaction("nope")).toThrow(/Unknown faction/);
  });

  it("rejects malformed definitions with a useful message", () => {
    const bad = { ...getFaction("directorate"), id: "Bad Id" };
    expect(() => validateFactions([bad])).toThrow(/index 0[\s\S]*snake_case/);
  });

  it("rejects duplicate ids", () => {
    const f = getFaction("directorate");
    expect(() => validateFactions([f, f])).toThrow(/Duplicate faction id/);
  });
});

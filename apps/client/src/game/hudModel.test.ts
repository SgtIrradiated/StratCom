import { RULESET, rulesetUnit } from "@stratcom/data";
import { createSnapshotBuffers } from "@stratcom/sim";
import { describe, expect, it } from "vitest";
import { buildOptions, findUnit, formatClock, summarizeSelection } from "./hudModel";

function snapshot(units: readonly { id: number; type: number; owner: number }[]) {
  const s = createSnapshotBuffers(units.length);
  units.forEach((u, i) => {
    s.ids[i] = u.id;
    s.types[i] = u.type;
    s.owners[i] = u.owner;
  });
  s.count = units.length;
  return s;
}

describe("HUD model", () => {
  const snap = snapshot([
    { id: 11, type: 5, owner: 0 },
    { id: 12, type: 2, owner: 0 },
    { id: 13, type: 5, owner: 0 },
    { id: 14, type: 2, owner: 1 },
  ]);

  it("groups the selection by type and ignores ids that are gone", () => {
    expect(summarizeSelection(snap, new Set([11, 12, 13, 99]))).toEqual([
      { type: 2, count: 1 },
      { type: 5, count: 2 },
    ]);
    expect(summarizeSelection(snap, new Set())).toEqual([]);
  });

  it("lists what the selected builders can build, without duplicates", () => {
    const overseer = rulesetUnit(RULESET, "dir_overseer");
    const tech = rulesetUnit(RULESET, "dir_technician");
    const works = rulesetUnit(RULESET, "dir_works");
    const opts = buildOptions(RULESET, [
      { type: overseer.index, count: 1 },
      { type: tech.index, count: 2 },
      { type: works.index, count: 1 },
    ]);
    expect(opts.slice(0, 3)).toEqual([...overseer.builds]);
    expect(new Set(opts).size).toBe(opts.length);
    expect(opts).toContain(rulesetUnit(RULESET, "dir_lancer").index);
  });

  it("formats the match clock", () => {
    expect(formatClock(0)).toBe("00:00");
    expect(formatClock(20 * 75)).toBe("01:15");
    expect(formatClock(20 * 3725)).toBe("1:02:05");
  });

  it("finds a unit by owner and type", () => {
    expect(findUnit(snap, 1, 2)).toBe(3);
    expect(findUnit(snap, 1, 5)).toBe(-1);
  });
});

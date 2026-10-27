import { RULESET, rulesetUnit } from "@stratcom/data";
import { createSnapshotBuffers, type MatchStatus } from "@stratcom/sim";
import { describe, expect, it } from "vitest";
import {
  buildMenu,
  findUnit,
  formatAmount,
  formatClock,
  formatRate,
  formatSpending,
  matchOutcome,
  playerResults,
  summarizeSelection,
} from "./hudModel";

function snapshot(
  units: readonly { id: number; type: number; owner: number; progress?: number }[],
) {
  const s = createSnapshotBuffers(units.length);
  units.forEach((u, i) => {
    s.ids[i] = u.id;
    s.types[i] = u.type;
    s.owners[i] = u.owner;
    s.progress[i] = u.progress ?? 1;
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

  it("lists structures to place and units to produce, once each, with queued counts", () => {
    const overseer = rulesetUnit(RULESET, "dir_overseer");
    const tech = rulesetUnit(RULESET, "dir_technician");
    const works = rulesetUnit(RULESET, "dir_works");
    const lancer = rulesetUnit(RULESET, "dir_lancer");
    const s = snapshot([
      { id: 1, type: overseer.index, owner: 0 },
      { id: 2, type: tech.index, owner: 0 },
      { id: 3, type: works.index, owner: 0 },
      { id: 4, type: works.index, owner: 0, progress: 0.5 }, // unfinished: builds nothing
    ]);
    s.production = [{ id: 3, queue: [lancer.index, lancer.index], progress: 0.2 }];
    const menu = buildMenu(RULESET, s, new Set([1, 2, 3, 4]), 0);
    expect(menu.filter((o) => o.mode === "place").map((o) => o.type)).toEqual([...overseer.builds]);
    expect(menu.filter((o) => o.mode === "produce").map((o) => o.type)).toEqual([...works.builds]);
    expect(menu.find((o) => o.type === lancer.index)?.queued).toBe(2);
    expect(buildMenu(RULESET, s, new Set([4]), 0)).toEqual([]);
  });

  it("formats amounts and signed rates", () => {
    expect(formatAmount(1234.9)).toBe("1,234");
    expect(formatRate(3.04)).toBe("+3");
    expect(formatRate(2.55)).toBe("+2.6");
    expect(formatRate(-12.5)).toBe("-12.5");
    expect(formatRate(-0.01)).toBe("+0");
    expect(formatRate(1234.4)).toBe("+1,234");
    expect(formatSpending(18.04)).toBe("-18");
    expect(formatSpending(0)).toBe("-0");
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

describe("match outcome", () => {
  const status = (over: boolean, winnerTeam: number, defeated: boolean[]): MatchStatus => ({
    over,
    winnerTeam,
    players: defeated.map((d, slot) => ({
      slot,
      team: slot % 2,
      defeated: d,
      defeatedAt: d ? 10 : -1,
      kills: slot,
      losses: 1,
    })),
  });

  it("plays on until the local player falls or the match is decided", () => {
    expect(matchOutcome(status(false, -1, [false, false]), 0)).toBe(undefined);
    expect(matchOutcome(status(false, -1, [false, true, false, false]), 0)).toBe(undefined);
    expect(matchOutcome(status(false, -1, [true, false, false, false]), 0)).toBe("defeat");
  });

  it("is victory for the winning team, defeat for the rest, and a draw with no winner", () => {
    expect(matchOutcome(status(true, 0, [false, true]), 0)).toBe("victory");
    expect(matchOutcome(status(true, 0, [false, true]), 1)).toBe("defeat");
    expect(matchOutcome(status(true, -1, [true, true]), 0)).toBe("draw");
  });

  it("lists every player's record in slot order", () => {
    const s = status(true, 0, [false, true]);
    s.players.reverse();
    expect(playerResults(s)).toEqual([
      { slot: 0, kills: 0, losses: 1, defeated: false },
      { slot: 1, kills: 1, losses: 1, defeated: true },
    ]);
  });
});

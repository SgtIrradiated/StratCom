import { RULESET, rulesetUnit } from "@stratcom/data";
import {
  EntityKind,
  Fog,
  NEUTRAL_OWNER,
  VISION_CELL,
  createSnapshotBuffers,
  denseTeams,
} from "@stratcom/sim";
import { describe, expect, it } from "vitest";
import { FogView } from "./FogView";

const warden = rulesetUnit(RULESET, "dir_warden").index;
const works = rulesetUnit(RULESET, "dir_works").index;

/** Slots 0 and 2 are allies (dense team 0); slot 1 is the enemy (dense team 1). */
const teams = denseTeams([
  { slot: 0, team: 0 },
  { slot: 1, team: 1 },
  { slot: 2, team: 0 },
]);
const COLS = 8;
const CELLS = COLS * COLS;

interface Entry {
  id: number;
  owner: number;
  type?: number;
  kind?: number;
  x: number;
  z: number;
  /** Dense teams that see it, as a bitmask. */
  seenBy?: number;
}

/** A snapshot of `entries`; team 0 sees the cells listed in `visible` and has explored `explored`. */
function snapshot(entries: Entry[], visible: number[], explored: number[] = []) {
  const s = createSnapshotBuffers(16, CELLS * 2);
  entries.forEach((e, i) => {
    s.ids[i] = e.id;
    s.owners[i] = e.owner;
    s.types[i] = e.type ?? warden;
    s.kinds[i] = e.kind ?? EntityKind.unit;
    s.x[i] = s.prevX[i] = e.x;
    s.z[i] = s.prevZ[i] = e.z;
    s.progress[i] = 1;
    s.health[i] = 1;
    s.seenBy[i] = e.seenBy ?? 0;
  });
  s.count = entries.length;
  s.visionCols = COLS;
  s.visionRows = COLS;
  s.visionTeams = 2;
  for (const c of explored) s.vision[c] = Fog.explored;
  for (const c of visible) s.vision[c] = Fog.visible;
  return s;
}

/** The vision cell of a point. */
const cell = (x: number, z: number): number =>
  Math.floor(z / VISION_CELL) * COLS + Math.floor(x / VISION_CELL);
const ids = (v: { count: number; ids: Uint32Array }): number[] => [...v.ids.slice(0, v.count)];

describe("FogView", () => {
  it("shows own and allied units always, and enemies only while seen", () => {
    const fog = new FogView(32, teams.teamOf, RULESET, 0);
    const s = snapshot(
      [
        { id: 1, owner: 0, x: 10, z: 10 },
        { id: 2, owner: 2, x: 200, z: 200 },
        { id: 3, owner: 1, x: 40, z: 10, seenBy: 0b11 },
        { id: 4, owner: 1, x: 220, z: 220, seenBy: 0b10 },
      ],
      [cell(10, 10), cell(40, 10)],
    );
    expect(ids(fog.update(s))).toEqual([1, 2, 3]);
  });

  it("remembers enemy structures out of sight until their spot is seen empty", () => {
    const fog = new FogView(32, teams.teamOf, RULESET, 0);
    const base = { id: 9, owner: 1, type: works, x: 100, z: 100 };
    fog.update(snapshot([{ ...base, seenBy: 0b11 }], [cell(100, 100)]));

    // Out of sight: still drawn, dimmed, where it was.
    const away = fog.update(snapshot([{ ...base, seenBy: 0b10 }], [], [cell(100, 100)]));
    expect(ids(away)).toEqual([9]);
    expect(away.remembered[0]).toBe(1);

    // Seen again and gone (destroyed meanwhile): forgotten.
    const gone = fog.update(snapshot([], [cell(100, 100)]));
    expect(ids(gone)).toEqual([]);
    expect(ids(fog.update(snapshot([], [], [cell(100, 100)])))).toEqual([]);
  });

  it("does not remember mobile units", () => {
    const fog = new FogView(32, teams.teamOf, RULESET, 0);
    fog.update(snapshot([{ id: 5, owner: 1, x: 100, z: 100, seenBy: 0b11 }], [cell(100, 100)]));
    expect(ids(fog.update(snapshot([{ id: 5, owner: 1, x: 100, z: 100 }], [])))).toEqual([]);
  });

  it("shows features on explored ground only", () => {
    const fog = new FogView(32, teams.teamOf, RULESET, 0);
    const feature = { owner: NEUTRAL_OWNER, type: 0, kind: EntityKind.feature };
    const s = snapshot(
      [
        { ...feature, id: 6, x: 10, z: 10 },
        { ...feature, id: 7, x: 200, z: 10 },
      ],
      [],
      [cell(10, 10)],
    );
    expect(ids(fog.update(s))).toEqual([6]);
  });

  it("shows everything with no view team", () => {
    const fog = new FogView(32, teams.teamOf, RULESET, undefined);
    const s = snapshot([{ id: 4, owner: 1, x: 220, z: 220 }], []);
    expect(ids(fog.update(s))).toEqual([4]);
  });
});

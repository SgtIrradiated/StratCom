import { RULESET, rulesetUnit } from "@stratcom/data";
import { EntityKind, NEUTRAL_OWNER, createSnapshotBuffers, generateTerrain } from "@stratcom/sim";
import { describe, expect, it } from "vitest";
import { contextCommands, occupiedCells, previewPlacement, selectionRoles } from "./orders";

const overseer = rulesetUnit(RULESET, "dir_overseer");
const warden = rulesetUnit(RULESET, "dir_warden");
const works = rulesetUnit(RULESET, "dir_works");
const reactor = rulesetUnit(RULESET, "dir_reactor");
const extractor = rulesetUnit(RULESET, "dir_extractor");

interface Entry {
  id: number;
  type: number;
  owner?: number;
  kind?: number;
  progress?: number;
  health?: number;
  x?: number;
  z?: number;
}

function snapshot(entries: readonly Entry[]) {
  const s = createSnapshotBuffers(entries.length);
  entries.forEach((e, i) => {
    s.ids[i] = e.id;
    s.types[i] = e.type;
    s.owners[i] = e.owner ?? 0;
    s.kinds[i] = e.kind ?? EntityKind.unit;
    s.progress[i] = e.progress ?? 1;
    s.health[i] = e.health ?? 1;
    s.x[i] = e.x ?? 0;
    s.z[i] = e.z ?? 0;
  });
  s.count = entries.length;
  return s;
}

const snap = snapshot([
  { id: 1, type: overseer.index },
  { id: 2, type: warden.index },
  { id: 3, type: works.index },
  { id: 4, type: 0, kind: EntityKind.feature, owner: NEUTRAL_OWNER },
  { id: 5, type: reactor.index, progress: 0.3 },
  { id: 6, type: warden.index, owner: 1 },
  { id: 7, type: warden.index, health: 0.4 },
  { id: 8, type: warden.index, owner: 2 },
]);
/** Slot 0 (local) and slot 2 are allies; slot 1 is the enemy. */
const ctx = (selected: number[]) => ({
  ruleset: RULESET,
  localSlot: 0,
  teams: [0, 1, 0],
  snapshot: snap,
  selected: new Set(selected),
});
const ground = { x: 100, z: 200 };

describe("selection roles", () => {
  it("splits builders, other units and factories, ignoring others' and unfinished units", () => {
    expect(selectionRoles(ctx([1, 2, 3, 5, 6]))).toEqual({
      builders: [1],
      movers: [2],
      factories: [3],
      armed: [1, 2],
    });
  });
});

describe("context commands", () => {
  it("moves units and sets the factory rally point on open ground", () => {
    expect(contextCommands(ctx([1, 2, 3]), -1, ground, false)).toEqual([
      { t: "move", slot: 0, units: [2, 1], to: ground, queue: false },
      { t: "rally", slot: 0, units: [3], to: ground },
    ]);
  });

  it("sends builders to reclaim debris while the rest move", () => {
    expect(contextCommands(ctx([1, 2]), 3, ground, true)).toEqual([
      { t: "reclaim", slot: 0, units: [1], target: 4, queue: true },
      { t: "move", slot: 0, units: [2], to: ground, queue: true },
    ]);
  });

  it("assists own construction and factories, but not finished non-builders or enemies", () => {
    expect(contextCommands(ctx([1]), 4, ground, false)).toEqual([
      { t: "assist", slot: 0, units: [1], target: 5, queue: false },
    ]);
    expect(contextCommands(ctx([1]), 2, ground, false)[0]).toEqual({
      t: "assist",
      slot: 0,
      units: [1],
      target: 3,
      queue: false,
    });
    expect(contextCommands(ctx([1]), 1, ground, false)[0]?.t).toBe("move");
    expect(contextCommands(ctx([1]), 7, ground, false)[0]?.t).toBe("move");
  });

  it("repairs damaged own units", () => {
    expect(contextCommands(ctx([1]), 6, ground, false)).toEqual([
      { t: "assist", slot: 0, units: [1], target: 7, queue: false },
    ]);
  });

  it("attacks hostile units with everything armed, and never allies", () => {
    expect(contextCommands(ctx([1, 2, 3]), 5, ground, true)).toEqual([
      { t: "attack", slot: 0, units: [1, 2], target: 6, queue: true },
      { t: "rally", slot: 0, units: [3], to: ground },
    ]);
    expect(contextCommands(ctx([2]), 7, ground, false)).toEqual([
      { t: "move", slot: 0, units: [2], to: ground, queue: false },
    ]);
  });
});

describe("placement preview", () => {
  const terrain = generateTerrain({
    seed: 1,
    cells: 64,
    cellSize: 8,
    amplitude: 0,
    wavelength: 50,
  });
  const deposits = [{ x: 200, z: 200 }];
  const empty = snapshot([]);

  it("snaps extractors onto deposits and rejects them elsewhere", () => {
    const on = previewPlacement(RULESET, terrain, deposits, empty, extractor.index, 0, 210, 190);
    expect([on?.site.x, on?.site.z, on?.problem]).toEqual([200, 200, undefined]);
    const off = previewPlacement(RULESET, terrain, deposits, empty, extractor.index, 0, 400, 400);
    expect(off?.problem).toBe("needs-deposit");
    expect(previewPlacement(RULESET, terrain, deposits, empty, warden.index, 0, 1, 1)).toBe(
      undefined,
    );
  });

  it("sees structures in the snapshot as occupied, and keeps ground structures off deposits", () => {
    const built = snapshot([{ id: 9, type: works.index, x: 320, z: 320 }]);
    expect(occupiedCells(RULESET, terrain, built).size).toBe(16);
    const clash = previewPlacement(RULESET, terrain, deposits, built, reactor.index, 0, 330, 330);
    expect(clash?.problem).toBe("occupied");
    const onDeposit = previewPlacement(
      RULESET,
      terrain,
      deposits,
      built,
      reactor.index,
      0,
      200,
      200,
    );
    expect(onDeposit?.problem).toBe("on-deposit");
    const free = previewPlacement(RULESET, terrain, deposits, built, reactor.index, 1, 100, 100);
    expect(free?.problem).toBe(undefined);
  });
});

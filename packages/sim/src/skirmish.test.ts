import { MAPS, RULESET, getMap, rulesetFaction, rulesetUnit } from "@stratcom/data";
import { describe, expect, it } from "vitest";
import { buildNavGrid, cellAt } from "./navigation";
import { Simulation, type PlayerSetup } from "./simulation";
import { createSkirmishSetup } from "./skirmish";
import { sampleHeight, terrainWidth } from "./terrain";

const PLAYERS: readonly PlayerSetup[] = [
  { slot: 0, team: 0, factionId: "scrapborn", color: "#d0602c" },
  { slot: 1, team: 1, factionId: "directorate", color: "#3fd0c9" },
];

const setupFor = (mapId = "ashfall_basin", players = PLAYERS) =>
  createSkirmishSetup({ seed: 99, map: getMap(mapId), ruleset: RULESET, players });

describe("createSkirmishSetup", () => {
  it("spawns each player's own commander first, on its start position", () => {
    const setup = setupFor();
    const map = getMap("ashfall_basin");
    const size = terrainWidth(setup.terrain);
    for (const p of PLAYERS) {
      const own = setup.initialUnits.filter((u) => u.slot === p.slot);
      const faction = rulesetFaction(RULESET, p.factionId);
      expect(own[0]!.type).toBe(faction.commanderUnit);
      expect(own[0]!.x).toBeCloseTo(map.startPositions[p.slot]!.x * size, 6);
      expect(own[0]!.z).toBeCloseTo(map.startPositions[p.slot]!.z * size, 6);
      const escorts = faction.startingUnits.reduce((n, s) => n + s.count, 0);
      expect(own.length).toBe(1 + escorts);
      for (const u of own) expect(RULESET.units[u.type]!.faction).toBe(faction.index);
    }
    expect(rulesetUnit(RULESET, "scr_warboss").index).toBe(setup.initialUnits[0]!.type);
  });

  it("places every unit on ground its movement class can cross, on every map", () => {
    for (const map of MAPS) {
      const players = map.startPositions.map((_, slot) => ({
        slot,
        team: slot,
        factionId: slot % 2 === 0 ? "directorate" : "scrapborn",
        color: "#ffffff",
      }));
      const setup = setupFor(map.id, players);
      const grids = RULESET.movementClasses.map((m) => buildNavGrid(setup.terrain, m.maxSlope));
      for (const u of setup.initialUnits) {
        const grid = grids[RULESET.units[u.type]!.movementClass]!;
        expect(grid.passable[cellAt(grid, u.x, u.z)], `${map.id} slot ${u.slot}`).toBe(1);
      }
    }
  });

  it("flattens the base site around each start position", () => {
    const setup = setupFor("rustbelt_ridge");
    const map = getMap("rustbelt_ridge");
    const size = terrainWidth(setup.terrain);
    for (const s of map.startPositions) {
      const h = sampleHeight(setup.terrain, s.x * size, s.z * size);
      expect(sampleHeight(setup.terrain, s.x * size + 40, s.z * size)).toBeCloseTo(h, 3);
      expect(sampleHeight(setup.terrain, s.x * size, s.z * size - 40)).toBeCloseTo(h, 3);
    }
  });

  it("is deterministic and runs as a match", () => {
    const a = new Simulation(setupFor());
    const b = new Simulation(setupFor());
    const ids = Array.from({ length: 11 }, (_, i) => (1 << 20) | i);
    const order = [{ t: "move" as const, slot: 0, units: ids, to: { x: 1024, z: 1024 } }];
    a.step(order);
    b.step(order);
    for (let t = 0; t < 200; t++) {
      a.step([]);
      b.step([]);
    }
    expect(a.stateHash()).toBe(b.stateHash());
    expect(a.entityCount).toBe(setupFor().initialUnits.length);
  });

  it("rejects slots without a start position and unknown factions", () => {
    expect(() => setupFor("glassed_flats", [...PLAYERS, { ...PLAYERS[0]!, slot: 2 }])).toThrow(
      /no start position for slot 2/,
    );
    expect(() => setupFor("ashfall_basin", [{ ...PLAYERS[0]!, factionId: "nope" }])).toThrow(
      /unknown faction "nope"/,
    );
  });
});

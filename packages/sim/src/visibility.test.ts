import { describe, expect, it } from "vitest";
import type { MatchSetup, UnitTypeStats } from "./rules";
import { Simulation } from "./simulation";
import { createSnapshotBuffersFor } from "./snapshot";
import { Fog, VISION_CELL, VISION_TICKS } from "./systems/visibility";
import { generateTerrain } from "./terrain";

const unit = (over: Partial<UnitTypeStats>): UnitTypeStats => ({
  mobile: true,
  movementClass: 0,
  radius: 2,
  speed: 10,
  turnRate: 6,
  health: 100,
  vision: 100,
  weapons: [],
  wreckFeature: -1,
  commander: false,
  cost: { salvage: 100, power: 100, buildTime: 10 },
  footprint: { x: 0, z: 0 },
  placement: "ground",
  builds: [],
  buildRate: 0,
  buildRange: 0,
  economy: { salvagePerSec: 0, powerPerSec: 0, storageSalvage: 0, storagePower: 0 },
  ...over,
});

/** Unit types: a scout that sees 100 m, and a gun that reaches 100 m but sees only 40 m. */
const T = { scout: 0, gun: 1 };

/** A flat 1 km map. Slots 0 and 2 are allies (team 0); slot 1 is the enemy (team 7). */
function match(initialUnits: MatchSetup["initialUnits"]): MatchSetup {
  return {
    seed: 9,
    terrain: generateTerrain({ seed: 1, cells: 128, cellSize: 8, amplitude: 0, wavelength: 100 }),
    players: [0, 1, 2].map((slot) => ({
      slot,
      team: slot === 1 ? 7 : 0,
      factionId: "test",
      color: "#ffffff",
    })),
    ruleset: {
      movementClasses: [{ maxSlope: 0.6 }],
      units: [unit({}), unit({ vision: 40, weapons: [0] })],
      features: [],
      weapons: [{ damage: 10, range: 100, reload: 1, areaRadius: 0, projectileSpeed: 0 }],
    },
    initialUnits,
  };
}

const id = (i: number): number => (1 << 20) | i;

describe("fog of war", () => {
  it("shows each team what its units see, and remembers what it has seen", () => {
    const setup = match([
      { slot: 0, type: T.scout, x: 500, z: 500 },
      { slot: 1, type: T.scout, x: 900, z: 900 },
    ]);
    const sim = new Simulation(setup);
    const s = createSnapshotBuffersFor(setup);
    sim.writeSnapshot(s);
    expect([s.visionCols, s.visionRows, s.visionTeams]).toEqual([32, 32, 2]);
    const fog = (team: number, x: number, z: number): number =>
      s.vision[team * 1024 + Math.floor(z / VISION_CELL) * 32 + Math.floor(x / VISION_CELL)]!;
    expect(fog(0, 500, 500)).toBe(Fog.visible);
    expect(fog(0, 580, 500)).toBe(Fog.visible);
    expect(fog(0, 700, 500)).toBe(Fog.unexplored);
    expect(fog(1, 500, 500)).toBe(Fog.unexplored);
    // Each team sees its own unit, not the other's.
    expect([s.seenBy[0], s.seenBy[1]]).toEqual([0b01, 0b10]);

    // The scout drives off: the cells it leaves stay explored.
    sim.step([{ t: "move", slot: 0, units: [id(0)], to: { x: 250, z: 250 } }]);
    for (let t = 1; t < 900; t++) sim.step([]); // 354 m at 10 m/s
    sim.writeSnapshot(s);
    expect(fog(0, 500, 500)).toBe(Fog.explored);
    expect(fog(0, 250, 250)).toBe(Fog.visible);
  });

  it("is shared by allies", () => {
    const setup = match([
      { slot: 0, type: T.scout, x: 200, z: 200 },
      { slot: 2, type: T.scout, x: 800, z: 800 },
    ]);
    const sim = new Simulation(setup);
    const s = createSnapshotBuffersFor(setup);
    sim.writeSnapshot(s);
    expect(s.visionTeams).toBe(2);
    expect(s.vision[25 * 32 + 25]).toBe(Fog.visible); // around slot 2's scout, for team 0
  });

  it("keeps weapons from firing at what their team cannot see, until a spotter arrives", () => {
    const blind = new Simulation(
      match([
        { slot: 0, type: T.gun, x: 300, z: 300 },
        { slot: 1, type: T.scout, x: 380, z: 300 },
      ]),
    );
    for (let t = 0; t < 40; t++) blind.step([]);
    expect(blind.state.health[1]).toBe(100);

    const spotted = new Simulation(
      match([
        { slot: 0, type: T.gun, x: 300, z: 300 },
        { slot: 1, type: T.scout, x: 380, z: 300 },
        { slot: 2, type: T.scout, x: 330, z: 330 },
      ]),
    );
    for (let t = 0; t < 40; t++) spotted.step([]);
    expect(spotted.state.health[1]).toBeLessThan(100);
  });

  it(`updates every ${VISION_TICKS} ticks`, () => {
    const setup = match([{ slot: 0, type: T.scout, x: 100, z: 500 }]);
    const sim = new Simulation(setup);
    const s = createSnapshotBuffersFor(setup);
    sim.step([{ t: "move", slot: 0, units: [id(0)], to: { x: 900, z: 500 } }]);
    for (let t = 1; t < 400; t++) sim.step([]); // 200 m on: x = 100 is now out of sight
    sim.writeSnapshot(s);
    const at = (x: number): number => s.vision[Math.floor(500 / 32) * 32 + Math.floor(x / 32)]!;
    expect(at(sim.state.x[0]!)).toBe(Fog.visible);
    expect(at(100)).toBe(Fog.explored);
  });
});

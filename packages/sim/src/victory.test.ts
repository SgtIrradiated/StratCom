import { describe, expect, it } from "vitest";
import type { PlayerCommand } from "./commands";
import { createDuelMatch, duelCommands } from "./duel";
import { EntityKind } from "./ecs/world";
import type { MatchSetup, PlayerSetup, UnitTypeStats } from "./rules";
import { Simulation } from "./simulation";
import { generateTerrain } from "./terrain";

const unit = (over: Partial<UnitTypeStats>): UnitTypeStats => ({
  mobile: true,
  movementClass: 0,
  radius: 2,
  speed: 10,
  turnRate: 6,
  health: 100,
  weapons: [],
  wreckFeature: 0,
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

/** Unit type ids: an armed commander, a fragile armed commander, and an unarmed truck. */
const T = { commander: 0, glass: 1, truck: 2 };

function match(
  players: PlayerSetup[],
  initialUnits: MatchSetup["initialUnits"],
  rules?: MatchSetup["rules"],
): MatchSetup {
  return {
    seed: 5,
    terrain: generateTerrain({ seed: 1, cells: 128, cellSize: 8, amplitude: 0, wavelength: 100 }),
    players,
    ruleset: {
      movementClasses: [{ maxSlope: 0.6 }],
      units: [
        unit({ commander: true, weapons: [0] }),
        unit({ commander: true, health: 10, weapons: [0] }),
        unit({}),
      ],
      features: [{ radius: 3, salvage: 50 }],
      weapons: [{ damage: 10, range: 50, reload: 1, areaRadius: 0, projectileSpeed: 0 }],
    },
    initialUnits,
    ...(rules ? { rules } : {}),
  };
}

const player = (slot: number, team: number): PlayerSetup => ({
  slot,
  team,
  factionId: "test",
  color: "#ffffff",
});
const id = (i: number): number => (1 << 20) | i;

function run(sim: Simulation, ticks: number, commands: PlayerCommand[] = []): void {
  sim.step(commands);
  for (let t = 1; t < ticks; t++) sim.step([]);
}

const unitsOf = (sim: Simulation, slot: number): number => {
  const w = sim.state;
  let n = 0;
  for (let i = 0; i < w.highWater; i++) {
    if (w.alive[i] === 1 && w.kind[i] === EntityKind.unit && w.owner[i] === slot) n++;
  }
  return n;
};

describe("victory", () => {
  it("defeats a player whose commander dies, destroys the rest of their army, and ends", () => {
    const sim = new Simulation(
      match(
        [player(0, 0), player(1, 1)],
        [
          { slot: 0, type: T.commander, x: 300, z: 300 },
          { slot: 1, type: T.glass, x: 330, z: 300 },
          { slot: 1, type: T.truck, x: 700, z: 700 },
          { slot: 1, type: T.truck, x: 720, z: 700 },
        ],
      ),
    );
    run(sim, 1, [{ t: "attack", slot: 0, units: [id(0)], target: id(1) }]);
    const status = sim.matchStatus();
    expect(status.over).toBe(true);
    expect(status.winnerTeam).toBe(0);
    expect(status.players[1]).toMatchObject({ defeated: true, defeatedAt: 0, losses: 3 });
    expect(status.players[0]).toMatchObject({ defeated: false, kills: 1, losses: 0 });
    expect(unitsOf(sim, 1)).toBe(0);
  });

  it("keeps a team in the match while any of its players stands", () => {
    const sim = new Simulation(
      match(
        [player(0, 0), player(1, 1), player(2, 1)],
        [
          { slot: 0, type: T.commander, x: 300, z: 300 },
          { slot: 1, type: T.glass, x: 330, z: 300 },
          { slot: 2, type: T.glass, x: 300, z: 700 },
        ],
      ),
    );
    run(sim, 1, [{ t: "attack", slot: 0, units: [id(0)], target: id(1) }]);
    expect(sim.matchStatus()).toMatchObject({ over: false, winnerTeam: -1 });
    expect(sim.matchStatus().players.map((p) => p.defeated)).toEqual([false, true, false]);
    run(sim, 900, [{ t: "attack", slot: 0, units: [id(0)], target: id(2) }]); // 400 m away
    expect(sim.matchStatus()).toMatchObject({ over: true, winnerTeam: 0 });
  });

  it("is a draw when the last players fall on the same tick", () => {
    const sim = new Simulation(
      match(
        [player(0, 0), player(1, 1)],
        [
          { slot: 0, type: T.glass, x: 300, z: 300 },
          { slot: 1, type: T.glass, x: 320, z: 300 },
        ],
      ),
    );
    run(sim, 1, [
      { t: "attack", slot: 0, units: [id(0)], target: id(1) },
      { t: "attack", slot: 1, units: [id(1)], target: id(0) },
    ]);
    expect(sim.matchStatus()).toMatchObject({ over: true, winnerTeam: -1 });
  });

  it("under annihilation, fights on after the commander dies", () => {
    const sim = new Simulation(
      match(
        [player(0, 0), player(1, 1)],
        [
          { slot: 0, type: T.commander, x: 300, z: 300 },
          { slot: 1, type: T.glass, x: 330, z: 300 },
          { slot: 1, type: T.truck, x: 700, z: 700 },
        ],
        { victory: "annihilation" },
      ),
    );
    run(sim, 1, [{ t: "attack", slot: 0, units: [id(0)], target: id(1) }]);
    expect(sim.matchStatus().over).toBe(false);
    expect(unitsOf(sim, 1)).toBe(1);
    run(sim, 1600, [{ t: "attack", slot: 0, units: [id(0)], target: id(2) }]); // 570 m away
    expect(sim.matchStatus()).toMatchObject({ over: true, winnerTeam: 0 });
  });

  it("never ends a match set up with a single team", () => {
    const sim = new Simulation(match([player(0, 0)], [{ slot: 0, type: T.truck, x: 300, z: 300 }]));
    run(sim, 10);
    expect(sim.matchStatus().over).toBe(false);
  });
});

describe("duel scenario", () => {
  it("ends within seconds in slot 0's favour", () => {
    const setup = createDuelMatch();
    const sim = new Simulation(setup);
    sim.step(duelCommands(setup));
    let ticks = 1;
    while (!sim.matchStatus().over && ticks < 400) {
      sim.step([]);
      ticks++;
    }
    expect(sim.matchStatus()).toMatchObject({ over: true, winnerTeam: 0 });
    expect(ticks).toBeLessThan(400);
  });
});

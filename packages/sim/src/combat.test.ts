import { describe, expect, it } from "vitest";
import type { PlayerCommand } from "./commands";
import { EntityKind } from "./ecs/world";
import type { MatchSetup, UnitTypeStats, WeaponStats } from "./rules";
import { Simulation } from "./simulation";
import { createSnapshotBuffers } from "./snapshot";
import { generateTerrain } from "./terrain";

const W = { beam: 0, shell: 1, mortar: 2 };
const WEAPONS: WeaponStats[] = [
  { damage: 10, range: 50, reload: 1, areaRadius: 0, projectileSpeed: 0 },
  { damage: 50, range: 100, reload: 1, areaRadius: 0, projectileSpeed: 20 },
  { damage: 30, range: 120, reload: 2, areaRadius: 10, projectileSpeed: 40 },
];

/** Unit type ids of the combat test ruleset. */
const T = { gunner: 0, tank: 1, scout: 2, bunker: 3, mortar: 4, engineer: 5, glass: 6 };
const WRECK = 0;

const unit = (over: Partial<UnitTypeStats>): UnitTypeStats => ({
  mobile: true,
  movementClass: 0,
  radius: 2,
  speed: 10,
  turnRate: 6,
  health: 100,
  weapons: [],
  wreckFeature: WRECK,
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

const UNITS: UnitTypeStats[] = [
  unit({ weapons: [W.beam] }),
  unit({ radius: 3, health: 300, weapons: [W.shell] }),
  unit({ radius: 1.5, health: 50, speed: 15, wreckFeature: -1 }),
  unit({
    mobile: false,
    movementClass: -1,
    speed: 0,
    turnRate: 0,
    radius: 6,
    footprint: { x: 2, z: 2 },
  }),
  unit({ weapons: [W.mortar] }),
  unit({
    builds: [T.bunker],
    buildRate: 1,
    buildRange: 10,
    economy: { salvagePerSec: 0, powerPerSec: 0, storageSalvage: 1000, storagePower: 1000 },
  }),
  unit({ health: 10, weapons: [W.beam] }),
];

/** A flat 1 km map. Slots 0 and 2 are allies (team 0); slot 1 is the enemy. */
function match(initialUnits: MatchSetup["initialUnits"]): MatchSetup {
  const players = [0, 1, 2].map((slot) => ({
    slot,
    team: slot === 1 ? 1 : 0,
    factionId: "test",
    color: "#ffffff",
    startingResources: { salvage: 1000, power: 1000 },
  }));
  return {
    seed: 3,
    terrain: generateTerrain({ seed: 1, cells: 128, cellSize: 8, amplitude: 0, wavelength: 100 }),
    players,
    ruleset: {
      movementClasses: [{ maxSlope: 0.6 }],
      units: UNITS,
      features: [{ radius: 3, salvage: 50 }],
      weapons: WEAPONS,
    },
    initialUnits,
  };
}

/** Entity id of an initial unit (slot `i`, generation 1). */
const id = (i: number): number => (1 << 20) | i;

function run(sim: Simulation, ticks: number, commands: PlayerCommand[] = []): void {
  sim.step(commands);
  for (let t = 1; t < ticks; t++) sim.step([]);
}

const hp = (sim: Simulation, i: number): number => sim.state.health[i] ?? 0;
const alive = (sim: Simulation, i: number): boolean =>
  sim.state.alive[i] === 1 && sim.state.kind[i] === EntityKind.unit;

/** Slots of live features. */
function features(sim: Simulation): number[] {
  const w = sim.state;
  const out: number[] = [];
  for (let i = 0; i < w.highWater; i++) {
    if (w.alive[i] === 1 && w.kind[i] === EntityKind.feature) out.push(i);
  }
  return out;
}

describe("weapons", () => {
  it("fire once per reload at a target in range", () => {
    const sim = new Simulation(
      match([
        { slot: 0, type: T.gunner, x: 300, z: 300 },
        { slot: 1, type: T.engineer, x: 330, z: 300 },
      ]),
    );
    run(sim, 1);
    expect(hp(sim, 1)).toBe(90);
    run(sim, 100); // 5 more seconds: 5 more shots
    expect(hp(sim, 1)).toBe(40);
  });

  it("do not fire at targets out of range, or at allies", () => {
    const sim = new Simulation(
      match([
        { slot: 0, type: T.gunner, x: 300, z: 300 },
        { slot: 1, type: T.scout, x: 300, z: 400 },
        { slot: 2, type: T.scout, x: 320, z: 300 },
      ]),
    );
    run(sim, 60);
    expect(hp(sim, 1)).toBe(50);
    expect(hp(sim, 2)).toBe(50);
  });

  it("prefer armed units, then other mobile units, then structures", () => {
    const sim = new Simulation(
      match([
        { slot: 0, type: T.gunner, x: 300, z: 300 },
        { slot: 1, type: T.bunker, x: 320, z: 320 },
        { slot: 1, type: T.scout, x: 300, z: 330 },
        { slot: 1, type: T.gunner, x: 340, z: 300 },
      ]),
    );
    run(sim, 1);
    expect(sim.weaponTarget(0, 0)).toBe(id(3));
    expect(hp(sim, 3)).toBe(90);
  });

  it("damage every hostile unit in the area and spare allies", () => {
    const sim = new Simulation(
      match([
        { slot: 0, type: T.mortar, x: 300, z: 300 },
        { slot: 1, type: T.scout, x: 400, z: 300 },
        { slot: 1, type: T.scout, x: 406, z: 300 },
        { slot: 2, type: T.scout, x: 403, z: 304 },
        { slot: 1, type: T.scout, x: 300, z: 420 },
      ]),
    );
    run(sim, 1);
    expect(sim.projectileCount).toBe(1);
    run(sim, 60); // flight: 100 m at 40 m/s
    expect(hp(sim, 1)).toBe(20);
    expect(hp(sim, 2)).toBe(20);
    expect(hp(sim, 3)).toBe(50);
    expect(hp(sim, 4)).toBe(50);
  });

  it("land projectiles where the target was, so a slow shell misses a unit that drives off", () => {
    const setup = match([
      { slot: 0, type: T.tank, x: 300, z: 300 },
      { slot: 1, type: T.scout, x: 380, z: 300 },
    ]);
    const still = new Simulation(setup);
    run(still, 90);
    expect(alive(still, 1)).toBe(false);

    const moving = new Simulation(setup);
    run(moving, 90, [{ t: "move", slot: 1, units: [id(1)], to: { x: 380, z: 900 } }]);
    expect(hp(moving, 1)).toBe(50);
  });

  it("let two units destroy each other in the same tick", () => {
    const sim = new Simulation(
      match([
        { slot: 0, type: T.glass, x: 300, z: 300 },
        { slot: 1, type: T.glass, x: 320, z: 300 },
      ]),
    );
    run(sim, 1, [
      { t: "attack", slot: 0, units: [id(0)], target: id(1) },
      { t: "attack", slot: 1, units: [id(1)], target: id(0) },
    ]);
    expect(alive(sim, 0)).toBe(false);
    expect(alive(sim, 1)).toBe(false);
    expect(sim.playerStats(0)).toEqual({ kills: 1, losses: 1 });
    expect(sim.playerStats(1)).toEqual({ kills: 1, losses: 1 });
  });
});

describe("attack orders", () => {
  it("chase the target into range, then end when it dies", () => {
    const sim = new Simulation(
      match([
        { slot: 0, type: T.gunner, x: 300, z: 300 },
        { slot: 1, type: T.scout, x: 500, z: 300 },
      ]),
    );
    run(sim, 1, [{ t: "attack", slot: 0, units: [id(0)], target: id(1) }]);
    expect(sim.orderCount(0)).toBe(1);
    run(sim, 600);
    expect(alive(sim, 1)).toBe(false);
    expect(sim.orderCount(0)).toBe(0);
    expect(sim.state.x[0]).toBeGreaterThan(400);
  });

  it("are ignored by unarmed units and against allies", () => {
    const sim = new Simulation(
      match([
        { slot: 0, type: T.scout, x: 300, z: 300 },
        { slot: 0, type: T.gunner, x: 310, z: 300 },
        { slot: 2, type: T.scout, x: 500, z: 300 },
        { slot: 1, type: T.scout, x: 300, z: 700 },
      ]),
    );
    run(sim, 1, [
      { t: "attack", slot: 0, units: [id(0)], target: id(3) },
      { t: "attack", slot: 0, units: [id(1)], target: id(2) },
    ]);
    expect(sim.orderCount(0)).toBe(0);
    expect(sim.orderCount(1)).toBe(0);
  });
});

describe("death", () => {
  it("frees the slot and a structure's cells, leaves a wreck and counts the kill", () => {
    const sim = new Simulation(
      match([
        { slot: 0, type: T.gunner, x: 300, z: 300 },
        { slot: 1, type: T.bunker, x: 336, z: 296 },
        { slot: 2, type: T.engineer, x: 380, z: 330 },
      ]),
    );
    run(sim, 300);
    expect(alive(sim, 1)).toBe(false);
    const wrecks = features(sim);
    expect(wrecks).toHaveLength(1);
    const wreck = wrecks[0]!;
    expect(sim.state.type[wreck]).toBe(WRECK);
    expect(sim.state.x[wreck]).toBe(336);
    expect(sim.state.progress[wreck]).toBe(1);
    expect(sim.playerStats(0)).toEqual({ kills: 1, losses: 0 });
    expect(sim.playerStats(1)).toEqual({ kills: 0, losses: 1 });

    // The cells are free again: an ally can build there.
    run(sim, 400, [
      { t: "build", slot: 2, units: [id(2)], unitType: T.bunker, at: { x: 336, z: 296 } },
    ]);
    const w = sim.state;
    let rebuilt = false;
    for (let i = 0; i < w.highWater; i++) {
      if (w.alive[i] === 1 && w.type[i] === T.bunker && w.kind[i] === EntityKind.unit) {
        rebuilt = w.x[i] === 336 && w.z[i] === 296;
      }
    }
    expect(rebuilt).toBe(true);
  });

  it("of a site under construction leaves a wreck worth what was built", () => {
    const sim = new Simulation(
      match([
        { slot: 0, type: T.engineer, x: 300, z: 300 },
        { slot: 1, type: T.gunner, x: 300, z: 600 },
      ]),
    );
    run(sim, 60, [
      { t: "build", slot: 0, units: [id(0)], unitType: T.bunker, at: { x: 320, z: 304 } },
    ]);
    run(sim, 1, [{ t: "stop", slot: 0, units: [id(0)] }]);
    const site = sim.state.highWater - 1;
    const built = sim.state.progress[site]!;
    expect(built).toBeGreaterThan(0);
    expect(built).toBeLessThan(1);
    // A site's health grows with its progress.
    expect(hp(sim, site)).toBeCloseTo(1 + built * 100, 6);
    run(sim, 600, [{ t: "attack", slot: 1, units: [id(1)], target: sim.state.idAt(site) }]);
    const wrecks = features(sim);
    expect(wrecks).toHaveLength(1);
    expect(sim.state.progress[wrecks[0]!]).toBe(built);
  });
});

describe("repair", () => {
  it("restores health at the build rate, for the same share of the cost", () => {
    const sim = new Simulation(
      match([
        { slot: 0, type: T.engineer, x: 300, z: 300 },
        { slot: 0, type: T.tank, x: 308, z: 300 },
      ]),
    );
    sim.state.health[1] = 100; // test set-up: a tank at a third of its health
    const before = sim.economy(0);
    run(sim, 1, [{ t: "assist", slot: 0, units: [id(0)], target: id(1) }]);
    run(sim, 100); // 5 s of 30 hp/s (300 hp over a 10 s build time)
    expect(hp(sim, 1)).toBeCloseTo(100 + 30 * 5.05, 6);
    run(sim, 100);
    expect(hp(sim, 1)).toBe(300);
    // Two thirds of the tank were rebuilt: two thirds of its cost.
    expect(before.salvage - sim.economy(0).salvage).toBeCloseTo((100 * 2) / 3, 6);
    expect(sim.orderCount(0)).toBe(0);
  });
});

describe("snapshots", () => {
  it("carry health fractions, projectiles in flight and the events since the last one", () => {
    const sim = new Simulation(
      match([
        { slot: 0, type: T.tank, x: 300, z: 300 },
        { slot: 1, type: T.gunner, x: 330, z: 300 },
      ]),
    );
    run(sim, 5); // the gunner (slot 1) first looks for a target on tick 4
    const s = createSnapshotBuffers(64);
    sim.writeSnapshot(s);
    expect(s.health[0]).toBeCloseTo(290 / 300, 6);
    expect(s.projectileCount).toBe(1);
    expect(s.projX[0]).toBeGreaterThan(300);
    expect(s.projX[0]).toBeLessThan(330);
    expect(s.events.filter((e) => e.t === "fire")).toHaveLength(2);
    sim.writeSnapshot(s);
    expect(s.events).toEqual([]);
  });
});

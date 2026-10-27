import { describe, expect, it } from "vitest";
import type { PlayerCommand } from "./commands";
import { EntityKind } from "./ecs/world";
import { buildNavGrid, cellAt } from "./navigation";
import { TEST_UNIT_TYPES } from "./scenario";
import { Simulation, TICK_RATE, type MatchSetup, type UnitTypeStats } from "./simulation";
import { createSnapshotBuffers } from "./snapshot";
import { generateTerrain } from "./terrain";

const base = TEST_UNIT_TYPES[0]!;
const structure = (over: Partial<UnitTypeStats>): UnitTypeStats => ({
  ...base,
  mobile: false,
  movementClass: -1,
  speed: 0,
  turnRate: 0,
  radius: 6,
  footprint: { x: 2, z: 2 },
  ...over,
});
const economy = (e: Partial<UnitTypeStats["economy"]>): UnitTypeStats["economy"] => ({
  salvagePerSec: 0,
  powerPerSec: 0,
  storageSalvage: 0,
  storagePower: 0,
  ...e,
});

/** Unit type ids of the test economy ruleset. */
const T = { commander: 0, extractor: 1, generator: 2, factory: 3, tank: 4, engineer: 5 };

const UNITS: UnitTypeStats[] = [
  {
    ...base,
    radius: 3,
    speed: 8,
    builds: [T.extractor, T.generator, T.factory],
    buildRate: 2,
    buildRange: 10,
    economy: economy({
      salvagePerSec: 1,
      powerPerSec: 10,
      storageSalvage: 1000,
      storagePower: 5000,
    }),
  },
  structure({
    placement: "deposit",
    cost: { salvage: 50, power: 500, buildTime: 10 },
    economy: economy({ salvagePerSec: 2 }),
  }),
  structure({
    cost: { salvage: 100, power: 0, buildTime: 10 },
    economy: economy({ powerPerSec: 20 }),
  }),
  structure({
    radius: 14,
    footprint: { x: 4, z: 4 },
    builds: [T.tank],
    buildRate: 1,
    cost: { salvage: 200, power: 1000, buildTime: 20 },
  }),
  { ...base, cost: { salvage: 50, power: 200, buildTime: 5 } },
  { ...base, builds: [T.extractor, T.generator], buildRate: 1, buildRange: 10 },
];

const DEPOSIT = { x: 400, z: 400 };

/** A flat 1 km map. Slot 0 has a commander at (300, 300) and an engineer next to it. */
function economyMatch(over: Partial<MatchSetup> = {}): MatchSetup {
  return {
    seed: 1,
    terrain: generateTerrain({ seed: 1, cells: 128, cellSize: 8, amplitude: 0, wavelength: 100 }),
    players: [
      {
        slot: 0,
        team: 0,
        factionId: "a",
        color: "#ffffff",
        startingResources: { salvage: 500, power: 2000 },
      },
      { slot: 1, team: 1, factionId: "b", color: "#000000" },
    ],
    ruleset: {
      movementClasses: [{ maxSlope: 0.6 }],
      units: UNITS,
      features: [{ radius: 2, salvage: 100 }],
    },
    initialUnits: [
      { slot: 0, type: T.commander, x: 300, z: 300 },
      { slot: 0, type: T.engineer, x: 310, z: 300 },
    ],
    deposits: [DEPOSIT],
    ...over,
  };
}

const id = (slot: number): number => (1 << 20) | slot;
const COMMANDER = id(0);
const ENGINEER = id(1);

function run(sim: Simulation, ticks: number, commands: PlayerCommand[] = []): void {
  sim.step(commands);
  for (let t = 1; t < ticks; t++) sim.step([]);
}

/** Slots of live units of `type`. */
function slotsOf(sim: Simulation, type: number, kind: number = EntityKind.unit): number[] {
  const w = sim.state;
  const out: number[] = [];
  for (let i = 0; i < w.highWater; i++) {
    if (w.alive[i] === 1 && w.kind[i] === kind && w.type[i] === type) out.push(i);
  }
  return out;
}

const build = (
  units: number[],
  unitType: number,
  at: { x: number; z: number },
  queue = false,
): PlayerCommand => ({ t: "build", slot: 0, units, unitType, at, queue });

describe("construction", () => {
  it("walks to the site, places it, builds it at the builder's rate and pays its cost", () => {
    const sim = new Simulation(economyMatch());
    run(sim, 1, [build([COMMANDER], T.generator, { x: 340, z: 300 })]);
    let placedAt = -1;
    for (let t = 0; t < 400; t++) {
      sim.step([]);
      const [g] = slotsOf(sim, T.generator);
      if (g !== undefined && placedAt < 0) placedAt = sim.tick;
      if (g !== undefined && sim.state.progress[g] === 1) break;
    }
    const [g] = slotsOf(sim, T.generator);
    expect(g).toBeDefined();
    expect(sim.state.progress[g!]).toBe(1);
    // 10 s of work at build rate 2: 5 s, i.e. 100 ticks (± one for placement).
    expect(sim.tick - placedAt).toBeGreaterThanOrEqual(99);
    expect(sim.tick - placedAt).toBeLessThanOrEqual(101);
    // Income 1 salvage/s over the whole run, minus the 100 the generator cost.
    expect(sim.economy(0).salvage).toBeCloseTo(500 + sim.tick / TICK_RATE - 100, 6);
    // The generator produces from the tick after it completes.
    run(sim, 1);
    expect(sim.economy(0).powerIncome).toBeCloseTo(30, 9);
    expect(sim.hasOrder(0)).toBe(false);
  });

  it("snaps structures to the grid and centres extractors on deposits", () => {
    const sim = new Simulation(economyMatch());
    run(sim, 1, [build([COMMANDER], T.generator, { x: 343, z: 297 })]);
    run(sim, 200);
    const [g] = slotsOf(sim, T.generator);
    expect([sim.state.x[g!], sim.state.z[g!]]).toEqual([344, 296]);

    run(sim, 1, [build([COMMANDER], T.extractor, { x: DEPOSIT.x + 15, z: DEPOSIT.z - 9 })]);
    run(sim, 400);
    const [x] = slotsOf(sim, T.extractor);
    expect([sim.state.x[x!], sim.state.z[x!]]).toEqual([DEPOSIT.x, DEPOSIT.z]);
    expect(sim.state.progress[x!]).toBe(1);
    expect(sim.economy(0).salvageIncome).toBeCloseTo(3, 9);
  });

  it("ignores extractors away from deposits and structures on top of deposits", () => {
    const sim = new Simulation(economyMatch());
    run(sim, 1, [build([COMMANDER], T.extractor, { x: 600, z: 600 })]);
    expect(sim.hasOrder(0)).toBe(false);
    // A generator over the deposit is ordered, but refused when the builder gets there.
    run(sim, 1, [build([COMMANDER], T.generator, DEPOSIT)]);
    expect(sim.hasOrder(0)).toBe(true);
    run(sim, 400);
    expect(slotsOf(sim, T.generator)).toEqual([]);
    expect(sim.hasOrder(0)).toBe(false);
  });

  it("lets several builders share one site: the second joins the first's structure", () => {
    const solo = new Simulation(economyMatch());
    const pair = new Simulation(economyMatch());
    const site = { x: 300, z: 340 };
    run(solo, 1, [build([ENGINEER], T.generator, site)]);
    run(pair, 1, [build([ENGINEER, COMMANDER], T.generator, site)]);
    /** Ticks from placement to completion. */
    const buildTicks = (sim: Simulation): number => {
      let placed = -1;
      for (let t = 0; t < 1000; t++) {
        sim.step([]);
        const [g] = slotsOf(sim, T.generator);
        if (g !== undefined && placed < 0) placed = sim.tick;
        if (g !== undefined && sim.state.progress[g] === 1) return sim.tick - placed;
      }
      return Infinity;
    };
    const soloTicks = buildTicks(solo);
    const pairTicks = buildTicks(pair);
    expect(slotsOf(pair, T.generator)).toHaveLength(1);
    expect(soloTicks).toBeCloseTo(200, -1);
    // Build rates 1 + 2 versus 1: about a third of the time (the second builder may arrive
    // a few ticks late).
    expect(pairTicks).toBeLessThan(soloTicks * 0.4);
  });

  it("assist puts build power into the target's construction", () => {
    const sim = new Simulation(economyMatch());
    run(sim, 1, [build([COMMANDER], T.generator, { x: 340, z: 300 })]);
    run(sim, 1, [{ t: "assist", slot: 0, units: [ENGINEER], target: COMMANDER }]);
    let fastest = 0;
    for (let t = 0; t < 400; t++) {
      const [g] = slotsOf(sim, T.generator);
      const before = g === undefined ? 0 : sim.state.progress[g]!;
      sim.step([]);
      if (g !== undefined) fastest = Math.max(fastest, sim.state.progress[g]! - before);
    }
    // Build rates 2 + 1 on a 10 s job: 0.3 per second, 0.015 per tick.
    expect(fastest).toBeCloseTo(0.015, 9);
    // The commander is idle afterwards; the engineer keeps guarding it.
    expect(sim.hasOrder(0)).toBe(false);
    expect(sim.hasOrder(1)).toBe(true);
  });

  it("queues orders with queue: true and runs them in order", () => {
    const sim = new Simulation(economyMatch());
    run(sim, 1, [
      build([COMMANDER], T.generator, { x: 340, z: 300 }),
      build([COMMANDER], T.generator, { x: 340, z: 340 }, true),
      build([COMMANDER], T.extractor, DEPOSIT, true),
    ]);
    expect(sim.orderCount(0)).toBe(3);
    run(sim, 1200);
    expect(slotsOf(sim, T.generator)).toHaveLength(2);
    expect(slotsOf(sim, T.extractor)).toHaveLength(1);
    expect(sim.hasOrder(0)).toBe(false);
  });

  it("blocks pathing through structures: units route around them", () => {
    const setup = economyMatch({
      initialUnits: [
        { slot: 0, type: T.factory, x: 512, z: 512 },
        { slot: 0, type: T.tank, x: 512, z: 440 },
      ],
    });
    const sim = new Simulation(setup);
    const grid = buildNavGrid(setup.terrain, 0.6);
    run(sim, 1, [{ t: "move", slot: 0, units: [id(1)], to: { x: 512, z: 590 } }]);
    for (let t = 0; t < 600 && sim.hasOrder(1); t++) {
      sim.step([]);
      const x = sim.state.x[1]!;
      const z = sim.state.z[1]!;
      const inside = x > 496 && x < 528 && z > 496 && z < 528;
      expect(inside, `tick ${sim.tick} at ${x}, ${z}`).toBe(false);
      expect(grid.passable[cellAt(grid, x, z)]).toBe(1);
    }
    expect(Math.hypot(sim.state.x[1]! - 512, sim.state.z[1]! - 590)).toBeLessThan(6);
  });

  it("lets a unit caught under a new structure walk out of it", () => {
    const sim = new Simulation(economyMatch());
    // The site covers the engineer standing at (310, 300).
    run(sim, 1, [build([COMMANDER], T.generator, { x: 312, z: 300 })]);
    run(sim, 60);
    expect(slotsOf(sim, T.generator)).toHaveLength(1);
    run(sim, 1, [{ t: "move", slot: 0, units: [ENGINEER], to: { x: 400, z: 250 } }]);
    run(sim, 300);
    expect(Math.hypot(sim.state.x[1]! - 400, sim.state.z[1]! - 250)).toBeLessThan(6);
  });
});

describe("economy", () => {
  it("slows every build by the same factor when a player stalls", () => {
    const setup = economyMatch();
    setup.players[0]!.startingResources = { salvage: 0, power: 2000 };
    const sim = new Simulation(setup);
    run(sim, 1, [
      build([COMMANDER], T.generator, { x: 300, z: 340 }),
      build([ENGINEER], T.generator, { x: 300, z: 260 }),
    ]);
    run(sim, 200);
    const [a, b] = slotsOf(sim, T.generator);
    const e = sim.economy(0);
    // Demand: (2 + 1) × 100 salvage / 10 s = 30/s against 1/s of income.
    expect(e.salvageDemand).toBeCloseTo(30, 6);
    expect(e.efficiency).toBeCloseTo(1 / 30, 6);
    expect(e.salvageSpent).toBeCloseTo(1, 6);
    expect(e.salvage).toBeCloseTo(0, 9);
    const pa = sim.state.progress[a!]!;
    const pb = sim.state.progress[b!]!;
    run(sim, 20);
    // Each job keeps its share: 2:1 build rates give 2:1 progress, both slowed by 1/30.
    const [slow, fast] = [sim.state.progress[a!]! - pa, sim.state.progress[b!]! - pb].sort(
      (x, y) => x - y,
    );
    expect(fast).toBeCloseTo((2 / 10) * (1 / 30), 6);
    expect(slow).toBeCloseTo((1 / 10) * (1 / 30), 6);
  });

  it("caps storage: income beyond capacity is lost", () => {
    const setup = economyMatch();
    setup.players[0]!.startingResources = { salvage: 5000, power: 0 };
    const sim = new Simulation(setup);
    run(sim, 1);
    expect(sim.economy(0).salvage).toBe(1000);
    expect(sim.economy(0).salvageCapacity).toBe(1000);
    expect(sim.economy(0).power).toBeCloseTo(10 / TICK_RATE, 9);
    expect(sim.economy(1).salvage).toBe(0);
  });

  it("reclaims features for salvage, with the player's reclaim multiplier", () => {
    const setup = economyMatch({
      features: [{ type: 0, x: 330, z: 300 }],
      initialUnits: [{ slot: 0, type: T.engineer, x: 300, z: 300 }],
    });
    setup.players[0]!.startingResources = { salvage: 0, power: 0 };
    setup.players[0]!.reclaimMultiplier = 1.5;
    // No storage on the engineer: give it some.
    setup.ruleset = {
      ...setup.ruleset,
      units: UNITS.map((u, i) =>
        i === T.engineer ? { ...u, economy: economy({ storageSalvage: 500 }) } : u,
      ),
    };
    const sim = new Simulation(setup);
    const feature = (1 << 20) | 1;
    run(sim, 1, [{ t: "reclaim", slot: 0, units: [id(0)], target: feature }]);
    run(sim, 600);
    expect(slotsOf(sim, 0, EntityKind.feature)).toEqual([]);
    expect(sim.economy(0).salvage).toBeCloseTo(150, 6);
    expect(sim.hasOrder(0)).toBe(false);
  });

  it("dismantles own structures for their salvage cost and frees their cells", () => {
    const setup = economyMatch({
      initialUnits: [
        { slot: 0, type: T.engineer, x: 300, z: 300 },
        { slot: 0, type: T.generator, x: 320, z: 320 },
      ],
    });
    setup.players[0]!.startingResources = { salvage: 0, power: 0 };
    setup.ruleset = {
      ...setup.ruleset,
      units: UNITS.map((u, i) =>
        i === T.engineer ? { ...u, economy: economy({ storageSalvage: 500 }) } : u,
      ),
    };
    const sim = new Simulation(setup);
    run(sim, 1, [{ t: "reclaim", slot: 0, units: [id(0)], target: id(1) }]);
    run(sim, 300);
    expect(slotsOf(sim, T.generator)).toEqual([]);
    expect(sim.economy(0).salvage).toBeCloseTo(100, 6);
    // The cells are free again: a new generator fits in the same place.
    run(sim, 1, [{ ...build([id(0)], T.generator, { x: 320, z: 320 }), slot: 0 }]);
    run(sim, 100);
    expect(slotsOf(sim, T.generator)).toHaveLength(1);
  });
});

describe("factories", () => {
  // The commander far away provides storage.
  const factoryMatch = (): MatchSetup =>
    economyMatch({
      initialUnits: [
        { slot: 0, type: T.factory, x: 512, z: 512 },
        { slot: 0, type: T.commander, x: 100, z: 100 },
      ],
    });
  const FACTORY = id(0);

  it("produces queued units, rolls them out the front and sends them to the rally point", () => {
    const sim = new Simulation(factoryMatch());
    run(sim, 1, [
      { t: "produce", slot: 0, units: [FACTORY], unitType: T.tank, count: 2 },
      { t: "rally", slot: 0, units: [FACTORY], to: { x: 512, z: 700 } },
    ]);
    expect(sim.productionQueue(0)).toEqual([T.tank, T.tank]);
    const snap = createSnapshotBuffers(64);
    run(sim, 50);
    sim.writeSnapshot(snap);
    expect(snap.production).toHaveLength(1);
    expect(snap.production[0]?.id).toBe(FACTORY);
    expect(snap.production[0]?.queue).toEqual([T.tank, T.tank]);
    expect(snap.production[0]?.progress).toBeCloseTo(0.51, 6);
    run(sim, 160);
    expect(slotsOf(sim, T.tank)).toHaveLength(2);
    expect(sim.productionQueue(0)).toEqual([]);
    run(sim, 400);
    for (const t of slotsOf(sim, T.tank)) {
      expect(Math.hypot(sim.state.x[t]! - 512, sim.state.z[t]! - 700)).toBeLessThan(12);
    }
    // Two tanks cost 100 salvage; the commander earned 1 salvage/s meanwhile.
    expect(sim.economy(0).salvage).toBeCloseTo(500 - 100 + sim.tick / TICK_RATE, 6);
  });

  it("removes units from the end of the queue with a negative count, and stop clears it", () => {
    const sim = new Simulation(factoryMatch());
    run(sim, 1, [{ t: "produce", slot: 0, units: [FACTORY], unitType: T.tank, count: 5 }]);
    run(sim, 1, [{ t: "produce", slot: 0, units: [FACTORY], unitType: T.tank, count: -2 }]);
    expect(sim.productionQueue(0)).toHaveLength(3);
    run(sim, 1, [{ t: "stop", slot: 0, units: [FACTORY] }]);
    expect(sim.productionQueue(0)).toEqual([]);
  });

  it("rejects commands a unit cannot carry out", () => {
    const sim = new Simulation(economyMatch());
    const before = sim.stateHash();
    sim.step([
      // Mobile units are not built by mobile builders, nor structures by factories.
      build([COMMANDER], T.tank, { x: 340, z: 300 }),
      { t: "produce", slot: 0, units: [COMMANDER], unitType: T.tank, count: 1 },
      // Another player's units, and a malformed type and count.
      { ...build([COMMANDER], T.generator, { x: 340, z: 300 }), slot: 1 },
      build([COMMANDER], 99, { x: 340, z: 300 }),
      { t: "produce", slot: 0, units: [COMMANDER], unitType: T.tank, count: 1.5 },
      { t: "reclaim", slot: 0, units: [COMMANDER], target: ENGINEER },
      { t: "assist", slot: 0, units: [COMMANDER], target: COMMANDER },
    ]);
    expect(sim.hasOrder(0)).toBe(false);
    expect(sim.hasOrder(1)).toBe(false);
    expect(sim.stateHash()).not.toBe(before); // only the clock and income moved
  });
});

describe("economy determinism", () => {
  it("gives identical hashes for the same commands", () => {
    const commands: PlayerCommand[] = [
      build([COMMANDER], T.factory, { x: 360, z: 360 }),
      build([COMMANDER], T.extractor, DEPOSIT, true),
      { t: "assist", slot: 0, units: [ENGINEER], target: COMMANDER },
    ];
    const hashes = (): number[] => {
      const sim = new Simulation(economyMatch());
      const out: number[] = [];
      sim.step(commands);
      for (let t = 0; t < 1500; t++) {
        sim.step([]);
        if (t % 100 === 0) out.push(sim.stateHash());
      }
      return out;
    };
    const a = hashes();
    expect(hashes()).toEqual(a);
    expect(new Set(a).size).toBe(a.length);
  });
});

import { describe, expect, it } from "vitest";
import { buildNavGrid, cellAt } from "./navigation";
import { createTestMatch, scriptedCommands } from "./scenario";
import { Simulation } from "./simulation";
import { createSnapshotBuffers } from "./snapshot";

function run(sim: Simulation, setup: ReturnType<typeof createTestMatch>, ticks: number): number[] {
  const hashes: number[] = [];
  for (let t = 0; t < ticks; t++) {
    sim.step(scriptedCommands(setup, sim.tick));
    if (t % 20 === 0) hashes.push(sim.stateHash());
  }
  return hashes;
}

describe("Simulation", () => {
  it("is deterministic: same setup and commands give identical hashes", () => {
    const setup = createTestMatch(300, 7, 3);
    const a = run(new Simulation(setup), setup, 200);
    const b = run(new Simulation(setup), setup, 200);
    expect(a).toEqual(b);
    expect(new Set(a).size).toBeGreaterThan(5);
  });

  it("different seeds give different states", () => {
    const s1 = createTestMatch(50, 1);
    const s2 = createTestMatch(50, 2);
    expect(run(new Simulation(s1), s1, 40)).not.toEqual(run(new Simulation(s2), s2, 40));
  });

  it("moves owned units and ignores commands for units the player does not own", () => {
    const setup = createTestMatch(4, 3, 2);
    const sim = new Simulation(setup);
    const mine = (1 << 20) | 0; // slot 0
    const theirs = (1 << 20) | 1; // slot 1
    const x0 = sim.state.x[0]!;
    const x1 = sim.state.x[1]!;
    sim.step([{ t: "move", slot: 0, units: [mine, theirs], to: { x: 10, z: 10 } }]);
    sim.step([]);
    expect(sim.hasOrder(0)).toBe(true);
    expect(sim.hasOrder(1)).toBe(false);
    expect(sim.state.x[0]).not.toBe(x0);
    expect(sim.state.x[1]).toBe(x1);
  });

  it("rejects non-finite targets and unknown slots", () => {
    const setup = createTestMatch(2, 3, 2);
    const sim = new Simulation(setup);
    const before = sim.stateHash();
    sim.step([
      { t: "move", slot: 0, units: [(1 << 20) | 0], to: { x: NaN, z: 0 } },
      { t: "move", slot: 9, units: [(1 << 20) | 0], to: { x: 1, z: 1 } },
    ]);
    expect(sim.hasOrder(0)).toBe(false);
    expect(sim.stateHash()).not.toBe(before); // only the tick counter changed
  });

  it("units arrive at their target and stop", () => {
    const setup = createTestMatch(1, 3, 1);
    const sim = new Simulation(setup);
    sim.step([{ t: "move", slot: 0, units: [(1 << 20) | 0], to: { x: 500, z: 500 } }]);
    for (let i = 0; i < 2000 && sim.hasOrder(0); i++) sim.step([]);
    expect(sim.hasOrder(0)).toBe(false);
    expect(Math.abs(sim.state.x[0]! - 500)).toBeLessThan(6);
    expect(Math.abs(sim.state.z[0]! - 500)).toBeLessThan(6);
  });

  it("writes a snapshot with previous and current positions", () => {
    const setup = createTestMatch(10, 5);
    const sim = new Simulation(setup);
    sim.step(scriptedCommands(setup, 0));
    sim.step([]);
    const snap = createSnapshotBuffers(16);
    sim.writeSnapshot(snap);
    expect(snap.count).toBe(10);
    expect(snap.tick).toBe(2);
    expect(snap.ids[0]).toBe((1 << 20) | 0);
    expect(snap.prevX[0]).not.toBe(snap.x[0]);
  });
});

describe("Simulation movement", () => {
  const ids = (n: number) => Array.from({ length: n }, (_, i) => (1 << 20) | i);

  it("separates stacked units", () => {
    const setup = createTestMatch(2, 11, 1);
    setup.initialUnits.forEach((u) => {
      u.x = 500;
      u.z = 500;
    });
    const sim = new Simulation(setup);
    for (let i = 0; i < 30; i++) sim.step([]);
    const d = Math.hypot(sim.state.x[0]! - sim.state.x[1]!, sim.state.z[0]! - sim.state.z[1]!);
    expect(d).toBeGreaterThan(4);
  });

  it("moves 500 units across the hills without entering blocked cells", () => {
    const setup = createTestMatch(500, 5, 1);
    const sim = new Simulation(setup);
    const grid = buildNavGrid(setup.terrain, setup.movementClasses[0]!.maxSlope);
    sim.step([{ t: "move", slot: 0, units: ids(500), to: { x: 1700, z: 1700 } }]);
    for (let t = 0; t < 3600; t++) {
      sim.step([]);
      if (t % 400 === 0) {
        for (let i = 0; i < 500; i++) {
          expect(grid.passable[cellAt(grid, sim.state.x[i]!, sim.state.z[i]!)]).toBe(1);
        }
      }
    }
    // Most of the army should have reached the target area (rest are stuck behind others).
    let near = 0;
    for (let i = 0; i < 500; i++) {
      if (Math.hypot(sim.state.x[i]! - 1700, sim.state.z[i]! - 1700) < 120) near++;
    }
    expect(near).toBeGreaterThan(250);
  });
});

import { describe, expect, it } from "vitest";
import {
  UNREACHABLE,
  cellAt,
  computeFlowCosts,
  flowDirection,
  hasLineOfSight,
  nearestPassable,
  type FlowField,
  type NavGrid,
} from "./navigation";

/** 10×10 open grid with a wall down column 5, except a gap at row 8. */
function walledGrid(): NavGrid {
  const g: NavGrid = { cols: 10, rows: 10, cellSize: 1, passable: new Uint8Array(100).fill(1) };
  for (let r = 0; r < 10; r++) if (r !== 8) g.passable[r * 10 + 5] = 0;
  return g;
}

const fieldFor = (g: NavGrid, goal: number): FlowField => ({
  movementClass: 0,
  goalCell: goal,
  goalX: (goal % g.cols) + 0.5,
  goalZ: Math.floor(goal / g.cols) + 0.5,
  version: 0,
  cost: computeFlowCosts(g, goal),
});

describe("navigation", () => {
  it("computes costs with 10/14 steps and marks walls unreachable-free", () => {
    const g = walledGrid();
    const cost = computeFlowCosts(g, 0);
    expect(cost[0]).toBe(0);
    expect(cost[1]).toBe(10);
    expect(cost[11]).toBe(14);
    expect(cost[5]).toBe(UNREACHABLE); // wall cell
  });

  it("routes around the wall through the gap", () => {
    const g = walledGrid();
    const field = fieldFor(g, 0 * 10 + 1); // left of the wall, top
    let x = 9.5;
    let z = 0.5; // right of the wall, top
    let crossedAtRow = -1;
    for (let i = 0; i < 200; i++) {
      const d = flowDirection(g, field, x, z)!;
      const len = Math.hypot(d.dx, d.dz);
      if (len < 0.01) break;
      const px = x;
      x += (d.dx / len) * 0.4;
      z += (d.dz / len) * 0.4;
      expect(g.passable[cellAt(g, x, z)]).toBe(1);
      if (px >= 5 && x < 5) crossedAtRow = Math.floor(z);
      if (Math.hypot(x - 1.5, z - 0.5) < 0.6) break;
    }
    expect(crossedAtRow).toBe(8);
  });

  it("does not cut corners", () => {
    const g: NavGrid = { cols: 3, rows: 3, cellSize: 1, passable: new Uint8Array(9).fill(1) };
    g.passable[1] = 0; // (1,0)
    g.passable[3] = 0; // (0,1): blocks the diagonal between (0,0) and (1,1)
    const cost = computeFlowCosts(g, 4);
    expect(cost[0]).toBe(UNREACHABLE);
  });

  it("finds the nearest passable cell and handles line of sight", () => {
    const g = walledGrid();
    expect(nearestPassable(g, 5)).not.toBe(5);
    expect(g.passable[nearestPassable(g, 5)]).toBe(1);
    expect(hasLineOfSight(g, 0.5, 0.5, 4.5, 0.5)).toBe(true);
    expect(hasLineOfSight(g, 0.5, 0.5, 9.5, 0.5)).toBe(false);
    expect(hasLineOfSight(g, 0.5, 8.5, 9.5, 8.5)).toBe(true);
  });
});

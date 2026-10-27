import { describe, expect, it } from "vitest";
import { Selection, nearestUnit, unitsInRect } from "./selection";

const screen = new Float32Array([10, 10, 50, 50, 90, 20, NaN, NaN, 52, 48]);

describe("unitsInRect", () => {
  it("finds units inside a rectangle given in any corner order", () => {
    expect(unitsInRect(screen, 5, { x0: 0, y0: 0, x1: 60, y1: 60 })).toEqual([0, 1, 4]);
    expect(unitsInRect(screen, 5, { x0: 60, y0: 60, x1: 0, y1: 0 })).toEqual([0, 1, 4]);
  });
  it("ignores units behind the camera", () => {
    expect(unitsInRect(screen, 5, { x0: -1e6, y0: -1e6, x1: 1e6, y1: 1e6 })).not.toContain(3);
  });
});

describe("nearestUnit", () => {
  it("picks the closest unit within range", () => {
    expect(nearestUnit(screen, 5, 51, 49, 20)).toBe(1);
    expect(nearestUnit(screen, 5, 300, 300, 20)).toBe(-1);
  });
});

describe("Selection", () => {
  it("replaces and adds", () => {
    const s = new Selection();
    s.set([1, 2]);
    s.add([2, 3]);
    expect([...s.ids]).toEqual([1, 2, 3]);
    s.clear();
    expect(s.ids.size).toBe(0);
  });

  it("stores and recalls control groups, dropping dead units", () => {
    const s = new Selection();
    s.set([1, 2, 3]);
    s.assignGroup(1);
    s.set([9]);
    expect(s.recallGroup(1, (id) => id !== 2)).toEqual([1, 3]);
    expect([...s.ids]).toEqual([1, 3]);
    expect(s.recallGroup(5, () => true)).toEqual([]);
    expect(s.ids.size).toBe(0);
  });

  it("clears a group when assigned an empty selection", () => {
    const s = new Selection();
    s.set([1]);
    s.assignGroup(2);
    s.clear();
    s.assignGroup(2);
    expect(s.recallGroup(2, () => true)).toEqual([]);
  });
});

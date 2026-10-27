import { describe, expect, it } from "vitest";
import { StateHasher } from "../math/hash";
import { World } from "./world";

const at = (x: number) => ({ type: 0, owner: 0, x, z: 0 });

describe("World", () => {
  it("never issues id 0 and resolves live ids", () => {
    const w = new World(8);
    const a = w.spawn(at(1));
    expect(a).not.toBe(0);
    expect(w.resolve(a)).toBe(0);
    expect(w.x[0]).toBe(1);
  });

  it("invalidates stale ids after slot reuse", () => {
    const w = new World(8);
    const a = w.spawn(at(1));
    expect(w.despawn(a)).toBe(true);
    expect(w.despawn(a)).toBe(false);
    const b = w.spawn(at(2));
    expect(w.resolve(a)).toBe(-1);
    expect(w.resolve(b)).toBe(0);
    expect(b).not.toBe(a);
  });

  it("rejects malformed ids", () => {
    const w = new World(4);
    w.spawn(at(0));
    for (const bad of [0, -1, 1.5, NaN, Infinity, 2 ** 40]) expect(w.resolve(bad)).toBe(-1);
  });

  it("throws when full", () => {
    const w = new World(2);
    w.spawn(at(0));
    w.spawn(at(0));
    expect(() => w.spawn(at(0))).toThrow("full");
  });

  it("hashes identically for identical histories and differently otherwise", () => {
    const build = (x: number) => {
      const w = new World(8);
      w.spawn(at(1));
      w.spawn(at(x));
      const h = new StateHasher(0);
      w.hashInto(h);
      return h.digest();
    };
    expect(build(2)).toBe(build(2));
    expect(build(2)).not.toBe(build(3));
  });
});

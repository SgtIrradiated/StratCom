import { describe, expect, it } from "vitest";
import { Prng } from "./math/prng";
import { SpatialGrid } from "./spatialGrid";

/** `n` live entities scattered over a `size` × `size` square, with every 7th slot dead. */
function scatter(n: number, size: number) {
  const prng = new Prng(7);
  const x = new Float64Array(n);
  const z = new Float64Array(n);
  const alive = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    x[i] = prng.nextFloat() * size;
    z[i] = prng.nextFloat() * size;
    alive[i] = i % 7 === 0 ? 0 : 1;
  }
  return { x, z, alive };
}

describe("SpatialGrid.forEachNear", () => {
  it("visits every live entity within the radius exactly once, for any radius", () => {
    const n = 2000;
    const size = 1000;
    const { x, z, alive } = scatter(n, size);
    const grid = new SpatialGrid(size, size, 64);
    grid.rebuild(n, alive, x, z, new Int32Array(n));
    for (const [qx, qz, r] of [
      [500, 500, 10],
      [500, 500, 300],
      [0, 0, 120],
      [990, 20, 520],
      [250, 750, 2000],
    ] as const) {
      const seen = new Map<number, number>();
      grid.forEachNear(qx, qz, r, (j) => seen.set(j, (seen.get(j) ?? 0) + 1));
      for (const count of seen.values()) expect(count).toBe(1);
      for (let i = 0; i < n; i++) {
        const dx = (x[i] ?? 0) - qx;
        const dz = (z[i] ?? 0) - qz;
        const inside = alive[i] === 1 && dx * dx + dz * dz <= r * r;
        if (inside) expect(seen.has(i)).toBe(true);
        if (alive[i] === 0) expect(seen.has(i)).toBe(false);
      }
    }
  });

  it("visits in the same order every time", () => {
    const n = 500;
    const { x, z, alive } = scatter(n, 400);
    const grid = new SpatialGrid(400, 400, 32);
    grid.rebuild(n, alive, x, z, new Int32Array(n));
    const run = (): number[] => {
      const out: number[] = [];
      grid.forEachNear(200, 180, 150, (j) => out.push(j));
      return out;
    };
    expect(run()).toEqual(run());
  });
});

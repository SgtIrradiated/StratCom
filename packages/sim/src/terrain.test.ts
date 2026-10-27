import { describe, expect, it } from "vitest";
import { generateTerrain, raycastTerrain, sampleHeight, terrainWidth } from "./terrain";

const params = { seed: 3, cells: 64, cellSize: 8, amplitude: 50, wavelength: 200 };

describe("terrain", () => {
  it("is deterministic and seed-dependent", () => {
    const a = generateTerrain(params);
    expect(generateTerrain(params).heights).toEqual(a.heights);
    expect(generateTerrain({ ...params, seed: 4 }).heights).not.toEqual(a.heights);
    expect(terrainWidth(a)).toBe(512);
  });

  it("stays within the amplitude and interpolates between vertices", () => {
    const t = generateTerrain(params);
    for (const h of t.heights) {
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThanOrEqual(50);
    }
    expect(sampleHeight(t, 0, 0)).toBe(t.heights[0]);
    const mid = sampleHeight(t, 4, 0);
    expect(mid).toBeCloseTo(((t.heights[0] ?? 0) + (t.heights[1] ?? 0)) / 2, 5);
  });

  it("clamps out-of-range samples", () => {
    const t = generateTerrain(params);
    expect(sampleHeight(t, -50, -50)).toBe(sampleHeight(t, 0, 0));
  });

  it("raycasts onto the ground", () => {
    const t = generateTerrain(params);
    const hit = raycastTerrain(t, [256, 300, 400], [0, -1, -1], 2000);
    expect(hit).toBeDefined();
    expect(Math.abs((hit?.y ?? 0) - sampleHeight(t, hit?.x ?? 0, hit?.z ?? 0))).toBeLessThan(0.05);
    expect(raycastTerrain(t, [256, 300, 256], [0, 1, 0], 2000)).toBeUndefined();
  });

  it("flattens plateaus and leaves terrain beyond the shoulder untouched", () => {
    const flat = generateTerrain({ ...params, plateaus: [{ x: 200, z: 240, radius: 40 }] });
    const plain = generateTerrain(params);
    const centre = sampleHeight(flat, 200, 240);
    for (const [x, z] of [
      [170, 240],
      [200, 210],
      [224, 256],
    ] as const) {
      expect(sampleHeight(flat, x, z)).toBeCloseTo(centre, 4);
    }
    expect(sampleHeight(flat, 0, 0)).toBe(sampleHeight(plain, 0, 0));
    expect(sampleHeight(flat, 500, 500)).toBe(sampleHeight(plain, 500, 500));
  });
});

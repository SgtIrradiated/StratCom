import { describe, expect, it } from "vitest";
import { RAW_FEATURES } from "../features";
import { MAPS, getMap, validateMaps } from "./index";

describe("map registry", () => {
  it("ships maps with at least two start positions each", () => {
    expect(MAPS.length).toBeGreaterThanOrEqual(2);
    for (const m of MAPS) expect(m.startPositions.length).toBeGreaterThanOrEqual(2);
  });

  it("applies the default plateau radius", () => {
    expect(getMap("ashfall_basin").plateauRadius).toBe(70);
    expect(() => getMap("nope")).toThrow(/Unknown map/);
  });

  it("scatters only known features and defaults the start deposits", () => {
    const known = new Set(RAW_FEATURES.map((f) => f.id));
    for (const m of MAPS) {
      for (const d of m.debris) expect(known, m.id).toContain(d.feature);
    }
    expect(getMap("ashfall_basin").startDeposits).toBe(4);
  });

  it("rejects start positions off the map and duplicate ids", () => {
    const m = getMap("glassed_flats");
    expect(() =>
      validateMaps([{ ...m, startPositions: [{ x: 1.5, z: 0.5 }, m.startPositions[0]] }]),
    ).toThrow(/Invalid map at index 0/);
    expect(() => validateMaps([m, m])).toThrow(/Duplicate map id/);
  });
});

import { describe, expect, it } from "vitest";
import { PI, atan, atan2, cos, sin, wrapAngle } from "./trig";

describe("trig", () => {
  it("matches Math.sin/cos within 1e-9 over a wide range", () => {
    for (let x = -50; x <= 50; x += 0.0137) {
      expect(Math.abs(sin(x) - Math.sin(x))).toBeLessThan(1e-9);
      expect(Math.abs(cos(x) - Math.cos(x))).toBeLessThan(1e-9);
    }
  });

  it("matches Math.atan and Math.atan2 within 1e-9", () => {
    for (let z = -40; z <= 40; z += 0.0371) {
      expect(Math.abs(atan(z) - Math.atan(z))).toBeLessThan(1e-9);
    }
    for (let y = -5; y <= 5; y += 0.31) {
      for (let x = -5; x <= 5; x += 0.29) {
        expect(Math.abs(atan2(y, x) - Math.atan2(y, x))).toBeLessThan(1e-9);
      }
    }
  });

  it("handles axis cases", () => {
    expect(atan2(0, 0)).toBe(0);
    expect(atan2(1, 0)).toBeCloseTo(PI / 2, 12);
    expect(atan2(-1, 0)).toBeCloseTo(-PI / 2, 12);
    expect(atan2(0, -1)).toBeCloseTo(PI, 12);
  });

  it("wraps angles into (-π, π]", () => {
    expect(wrapAngle(3 * PI)).toBeCloseTo(PI, 12);
    expect(wrapAngle(-PI)).toBeCloseTo(PI, 12);
    expect(wrapAngle(0.5)).toBe(0.5);
  });

  it("pins exact bit patterns (changing them breaks replays and cross-engine hashes)", () => {
    expect(sin(1)).toBe(0.8414709848086585);
    expect(cos(2)).toBe(-0.4161468365471424);
    expect(atan2(1, 2)).toBe(0.4636476090005862);
  });
});

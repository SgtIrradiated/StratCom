import { describe, expect, it } from "vitest";
import { parseBenchCount } from "./stats";

describe("parseBenchCount", () => {
  it("parses positive integers and caps them", () => {
    expect(parseBenchCount("?bench=2000")).toBe(2000);
    expect(parseBenchCount("?bench=99999999")).toBe(20_000);
  });
  it("ignores absent or invalid values", () => {
    expect(parseBenchCount("")).toBeUndefined();
    expect(parseBenchCount("?bench=abc")).toBeUndefined();
    expect(parseBenchCount("?bench=0")).toBeUndefined();
    expect(parseBenchCount("?bench=-5")).toBeUndefined();
  });
});

import { describe, expect, it } from "vitest";
import { AssertionError, assert, assertNever } from "./assert";

describe("assert", () => {
  it("passes on truthy conditions", () => {
    expect(() => {
      assert(1);
    }).not.toThrow();
  });

  it("throws AssertionError with the given message", () => {
    expect(() => {
      assert(false, "boom");
    }).toThrow(new AssertionError("boom"));
  });
});

describe("assertNever", () => {
  it("throws and includes the offending value", () => {
    expect(() => assertNever("x" as never)).toThrow(/"x"/);
  });
});

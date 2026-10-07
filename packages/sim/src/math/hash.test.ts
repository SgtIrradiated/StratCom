import { describe, expect, it } from "vitest";
import { StateHasher } from "./hash";

// Expected values come from the reference MurmurHash3_x86_32 C implementation.
describe("StateHasher (MurmurHash3_x86_32)", () => {
  it("matches published vectors for empty input", () => {
    expect(new StateHasher(0).digest()).toBe(0);
    expect(new StateHasher(1).digest()).toBe(0x514e28b7);
  });

  it('matches the published vector for "test"', () => {
    // "test" as one little-endian word: 't'=0x74 'e'=0x65 's'=0x73 't'=0x74
    expect(new StateHasher(0).u32(0x74736574).digest()).toBe(0xba6bd213);
  });

  it("matches the reference for a u32 sequence", () => {
    expect(new StateHasher(7).u32Array(Uint32Array.of(1, 2, 0xffffffff)).digest()).toBe(0xe20a4b87);
  });

  it("matches the reference for f64 bit patterns", () => {
    expect(new StateHasher(0).f64Array([1.5, -0.1]).digest()).toBe(0xee501f82);
  });

  it("distinguishes 0 from -0 (bit-exact state comparison)", () => {
    expect(new StateHasher().f64(0).digest()).not.toBe(new StateHasher().f64(-0).digest());
  });

  it("is order sensitive", () => {
    expect(new StateHasher().u32(1).u32(2).digest()).not.toBe(
      new StateHasher().u32(2).u32(1).digest(),
    );
  });
});

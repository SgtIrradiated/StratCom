import { describe, expect, it } from "vitest";
import { Prng } from "./prng";

// Reference vectors produced by the C reference implementations of splitmix32 and
// xoshiro128** (Blackman & Vigna), compiled with gcc. If these fail, the generator
// no longer matches the published algorithm and every saved replay would desync.
const REFERENCE: Record<number, { state: number[]; out: number[] }> = {
  0: {
    state: [1684164658, 3653269916, 2939563536, 2141751570],
    out: [1789933344, 44971166, 2521387044, 3848737593, 1138324114, 749234105],
  },
  1: {
    state: [1580013426, 350525680, 3524174333, 3011703609],
    out: [393288148, 2174103013, 3814759091, 2092745082, 1865176206, 2179171167],
  },
  42: {
    state: [551831576, 144025891, 322543647, 3034809370],
    out: [660444221, 3652823732, 77672526, 910233633, 2297337756, 3786072677],
  },
  0xdeadbeef: {
    state: [46217145, 304148291, 1711218402, 2692075039],
    out: [3842467093, 879304004, 3694663928, 2788030634, 934155191, 702880729],
  },
};

describe("Prng (xoshiro128**)", () => {
  for (const [seed, ref] of Object.entries(REFERENCE)) {
    it(`matches the C reference for seed ${seed}`, () => {
      const rng = new Prng(Number(seed));
      expect(rng.getState()).toEqual(ref.state);
      expect(Array.from({ length: ref.out.length }, () => rng.nextU32())).toEqual(ref.out);
    });
  }

  it("treats seeds as uint32 (negative and wrapped seeds are equivalent)", () => {
    expect(new Prng(-1).nextU32()).toBe(new Prng(0xffffffff).nextU32());
  });

  it("restores state exactly", () => {
    const a = new Prng(7);
    a.nextU32();
    const saved = a.getState();
    const expected = [a.nextU32(), a.nextU32(), a.nextU32()];

    const b = new Prng(999);
    b.setState(saved);
    expect([b.nextU32(), b.nextU32(), b.nextU32()]).toEqual(expected);
  });

  it("nextFloat stays in [0, 1)", () => {
    const rng = new Prng(3);
    for (let i = 0; i < 10_000; i++) {
      const x = rng.nextFloat();
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });

  it("nextInt covers the full range uniformly enough", () => {
    const rng = new Prng(11);
    const counts = new Array<number>(6).fill(0);
    const draws = 60_000;
    for (let i = 0; i < draws; i++) counts[rng.nextInt(6)]!++;
    for (const c of counts) expect(Math.abs(c - draws / 6)).toBeLessThan(draws / 6 / 20);
  });

  it("nextRange is inclusive on both ends", () => {
    const rng = new Prng(5);
    const seen = new Set<number>();
    for (let i = 0; i < 1000; i++) seen.add(rng.nextRange(-2, 2));
    expect([...seen].sort((a, b) => a - b)).toEqual([-2, -1, 0, 1, 2]);
  });

  it("rejects invalid bounds", () => {
    const rng = new Prng(1);
    expect(() => rng.nextInt(0)).toThrow(RangeError);
    expect(() => rng.nextInt(1.5)).toThrow(RangeError);
  });
});

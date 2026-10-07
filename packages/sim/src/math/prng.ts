/**
 * Deterministic pseudo-random number generator for the simulation (ADR-0002).
 *
 * Algorithm: xoshiro128** 1.1 (Blackman & Vigna), seeded through splitmix32.
 * Uses only 32-bit integer operations (`Math.imul`, shifts, xor) so results are
 * bit-identical in every JavaScript engine. Its state is four uint32 words and is
 * part of the hashed simulation state.
 *
 * Never use `Math.random()` in the simulation; use an instance of this class
 * owned by the world instead.
 */
export class Prng {
  private s0: number;
  private s1: number;
  private s2: number;
  private s3: number;

  /** @param seed Any 32-bit integer; the match seed agreed in the lobby. */
  constructor(seed: number) {
    let sm = seed >>> 0;
    const splitmix32 = (): number => {
      sm = (sm + 0x9e3779b9) >>> 0;
      let z = sm;
      z = Math.imul(z ^ (z >>> 16), 0x21f0aaad);
      z = Math.imul(z ^ (z >>> 15), 0x735a2d97);
      return (z ^ (z >>> 15)) >>> 0;
    };
    this.s0 = splitmix32();
    this.s1 = splitmix32();
    this.s2 = splitmix32();
    this.s3 = splitmix32();
  }

  /** Next raw value, uniformly distributed in [0, 2^32). */
  nextU32(): number {
    const result = Math.imul(rotl(Math.imul(this.s1, 5), 7), 9) >>> 0;
    const t = this.s1 << 9;
    this.s2 ^= this.s0;
    this.s3 ^= this.s1;
    this.s1 ^= this.s2;
    this.s0 ^= this.s3;
    this.s2 ^= t;
    this.s3 = rotl(this.s3, 11);
    return result;
  }

  /** Uniform float in [0, 1). Exactly representable, so it is deterministic. */
  nextFloat(): number {
    return this.nextU32() / 0x1_0000_0000;
  }

  /**
   * Uniform integer in [0, maxExclusive), without modulo bias.
   * @param maxExclusive Integer in [1, 2^32].
   */
  nextInt(maxExclusive: number): number {
    if (!Number.isInteger(maxExclusive) || maxExclusive < 1 || maxExclusive > 0x1_0000_0000) {
      throw new RangeError(
        `nextInt: maxExclusive must be an integer in [1, 2^32], got ${maxExclusive}`,
      );
    }
    // Reject the top partial bucket so every result is equally likely.
    const limit = 0x1_0000_0000 - (0x1_0000_0000 % maxExclusive);
    let x = this.nextU32();
    while (x >= limit) x = this.nextU32();
    return x % maxExclusive;
  }

  /** Uniform integer in [min, max] (both inclusive). */
  nextRange(min: number, max: number): number {
    return min + this.nextInt(max - min + 1);
  }

  /** Snapshot of the internal state, for save games, hashing and desync dumps. */
  getState(): [number, number, number, number] {
    return [this.s0 >>> 0, this.s1 >>> 0, this.s2 >>> 0, this.s3 >>> 0];
  }

  /** Restores a state previously returned by {@link getState}. */
  setState(state: readonly [number, number, number, number]): void {
    [this.s0, this.s1, this.s2, this.s3] = state;
  }
}

function rotl(x: number, k: number): number {
  return (x << k) | (x >>> (32 - k));
}

/**
 * Incremental 32-bit state hasher used for desync detection (ADR-0002).
 *
 * Produces exactly MurmurHash3_x86_32 of the little-endian byte stream fed to it, so a
 * hash can be reproduced by any external tool. Input is consumed in 4-byte words; there
 * is no byte-level API on purpose, because simulation state is stored in typed arrays.
 *
 * @example
 * const h = new StateHasher(tick);
 * h.u32(entityCount).f64Array(positions);
 * peerHashes.send(h.digest());
 */
export class StateHasher {
  private h: number;
  private byteLength = 0;
  private readonly scratch = new DataView(new ArrayBuffer(8));

  constructor(seed = 0) {
    this.h = seed >>> 0;
  }

  /** Mixes one unsigned 32-bit word. Values are truncated to 32 bits. */
  u32(value: number): this {
    let k = Math.imul(value, 0xcc9e2d51);
    k = (k << 15) | (k >>> 17);
    k = Math.imul(k, 0x1b873593);
    let h = this.h ^ k;
    h = (h << 13) | (h >>> 19);
    this.h = (Math.imul(h, 5) + 0xe6546b64) >>> 0;
    this.byteLength += 4;
    return this;
  }

  /** Mixes the exact IEEE-754 bit pattern of a double (little-endian). */
  f64(value: number): this {
    this.scratch.setFloat64(0, value, true);
    return this.u32(this.scratch.getUint32(0, true)).u32(this.scratch.getUint32(4, true));
  }

  /** Mixes every element of a 32-bit integer array. */
  u32Array(values: ArrayLike<number>): this {
    for (let i = 0; i < values.length; i++) this.u32(values[i] ?? 0);
    return this;
  }

  /** Mixes every element of a float array by exact bit pattern. */
  f64Array(values: ArrayLike<number>): this {
    for (let i = 0; i < values.length; i++) this.f64(values[i] ?? 0);
    return this;
  }

  /** Final hash as an unsigned 32-bit integer. Does not reset the hasher. */
  digest(): number {
    let h = (this.h ^ this.byteLength) >>> 0;
    h ^= h >>> 16;
    h = Math.imul(h, 0x85ebca6b);
    h ^= h >>> 13;
    h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16;
    return h >>> 0;
  }
}

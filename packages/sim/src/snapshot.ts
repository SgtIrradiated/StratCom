/**
 * Render snapshot: a compact, transferable copy of everything the renderer needs. Arrays
 * are capacity-sized and reused; only the first `count` entries are valid. Entries appear in
 * ascending entity-slot order.
 *
 * The renderer interpolates between `prevX/prevZ` (position at the start of the tick) and
 * `x/z` (position at its end), so one snapshot is enough to draw smoothly.
 */
export interface SnapshotBuffers {
  /** Simulation tick this snapshot was taken after. */
  tick: number;
  /** Number of valid entries. */
  count: number;
  ids: Uint32Array;
  types: Uint16Array;
  owners: Uint8Array;
  prevX: Float32Array;
  prevZ: Float32Array;
  x: Float32Array;
  z: Float32Array;
  heading: Float32Array;
}

/** Allocates snapshot buffers able to hold `capacity` entities. */
export function createSnapshotBuffers(capacity: number): SnapshotBuffers {
  return {
    tick: 0,
    count: 0,
    ids: new Uint32Array(capacity),
    types: new Uint16Array(capacity),
    owners: new Uint8Array(capacity),
    prevX: new Float32Array(capacity),
    prevZ: new Float32Array(capacity),
    x: new Float32Array(capacity),
    z: new Float32Array(capacity),
    heading: new Float32Array(capacity),
  };
}

/** The `ArrayBuffer`s backing a snapshot, for use as a `postMessage` transfer list. */
export function snapshotTransferList(s: SnapshotBuffers): ArrayBuffer[] {
  return [s.ids, s.types, s.owners, s.prevX, s.prevZ, s.x, s.z, s.heading].map(
    (a) => a.buffer as ArrayBuffer,
  );
}

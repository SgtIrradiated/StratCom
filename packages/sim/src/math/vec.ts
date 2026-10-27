/** Distance between (`ax`, `az`) and (`bx`, `bz`). Uses `Math.sqrt`, which is exact. */
export function distance(ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax;
  const dz = bz - az;
  return Math.sqrt(dx * dx + dz * dz);
}

/** Squared distance; prefer this for comparisons. */
export function distanceSq(ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax;
  const dz = bz - az;
  return dx * dx + dz * dz;
}

/** Clamps `v` into [`lo`, `hi`]. */
export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

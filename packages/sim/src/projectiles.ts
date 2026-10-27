import type { StateHasher } from "./math/hash";

/** Projectiles in flight at once. When the pool is full, a shot lands at once instead. */
export const PROJECTILE_CAPACITY = 8192;

/**
 * Projectiles in flight, as a fixed-capacity structure-of-arrays pool with a LIFO free list
 * (so slot allocation is deterministic). Projectiles are not World entities: rapid fire would
 * otherwise churn entity ids and generations, and fill the entity capacity.
 *
 * A projectile flies in a straight line on the ground plane from where it was fired to where
 * its target was, taking `duration` seconds. Heights (arcs) are for the renderer only.
 */
export class ProjectilePool {
  /** One past the highest slot ever used. */
  highWater = 0;
  count = 0;
  readonly alive: Uint8Array;
  readonly weapon: Uint16Array;
  /** Player slot that fired it. */
  readonly owner: Uint8Array;
  /** Entity id of the unit it was fired at. */
  readonly target: Uint32Array;
  readonly fromX: Float64Array;
  readonly fromZ: Float64Array;
  readonly toX: Float64Array;
  readonly toZ: Float64Array;
  /** Seconds of flight in total, and so far. */
  readonly duration: Float64Array;
  readonly elapsed: Float64Array;
  private readonly freeList: number[] = [];

  constructor(readonly capacity: number) {
    this.alive = new Uint8Array(capacity);
    this.weapon = new Uint16Array(capacity);
    this.owner = new Uint8Array(capacity);
    this.target = new Uint32Array(capacity);
    this.fromX = new Float64Array(capacity);
    this.fromZ = new Float64Array(capacity);
    this.toX = new Float64Array(capacity);
    this.toZ = new Float64Array(capacity);
    this.duration = new Float64Array(capacity);
    this.elapsed = new Float64Array(capacity);
  }

  /** True when no slot is free. */
  get full(): boolean {
    return this.count >= this.capacity;
  }

  /** Adds a projectile. The caller checks {@link full} first. */
  add(
    weapon: number,
    owner: number,
    target: number,
    fromX: number,
    fromZ: number,
    toX: number,
    toZ: number,
    duration: number,
  ): void {
    const i = this.freeList.pop() ?? this.highWater++;
    this.alive[i] = 1;
    this.weapon[i] = weapon;
    this.owner[i] = owner;
    this.target[i] = target;
    this.fromX[i] = fromX;
    this.fromZ[i] = fromZ;
    this.toX[i] = toX;
    this.toZ[i] = toZ;
    this.duration[i] = duration;
    this.elapsed[i] = 0;
    this.count++;
  }

  /** Frees slot `i`. */
  remove(i: number): void {
    this.alive[i] = 0;
    this.freeList.push(i);
    this.count--;
  }

  /** Fraction of the flight done, in [0, 1]. */
  progress(i: number): number {
    const d = this.duration[i] ?? 0;
    return d > 0 ? Math.min((this.elapsed[i] ?? 0) / d, 1) : 1;
  }

  /** Ground position after `elapsed` seconds of flight. */
  positionAt(i: number, elapsed: number): { x: number; z: number } {
    const d = this.duration[i] ?? 0;
    const f = d > 0 ? Math.min(elapsed / d, 1) : 1;
    const fx = this.fromX[i] ?? 0;
    const fz = this.fromZ[i] ?? 0;
    return { x: fx + ((this.toX[i] ?? 0) - fx) * f, z: fz + ((this.toZ[i] ?? 0) - fz) * f };
  }

  /** Mixes every projectile into `h`, in slot order. */
  hashInto(h: StateHasher): void {
    h.u32(this.highWater).u32(this.count);
    for (const slot of this.freeList) h.u32(slot);
    for (let i = 0; i < this.highWater; i++) {
      if (this.alive[i] === 0) continue;
      h.u32(i)
        .u32(this.weapon[i] ?? 0)
        .u32(this.owner[i] ?? 0)
        .u32(this.target[i] ?? 0)
        .f64(this.fromX[i] ?? 0)
        .f64(this.fromZ[i] ?? 0)
        .f64(this.toX[i] ?? 0)
        .f64(this.toZ[i] ?? 0)
        .f64(this.duration[i] ?? 0)
        .f64(this.elapsed[i] ?? 0);
    }
  }
}

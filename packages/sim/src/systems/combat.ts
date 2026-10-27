import type { SimContext, SlotState } from "../context";
import { EntityKind } from "../ecs/world";
import type { StateHasher } from "../math/hash";
import { PROJECTILE_CAPACITY, ProjectilePool } from "../projectiles";
import { MAX_WEAPONS, TICK_RATE, type WeaponStats } from "../rules";
import { SpatialGrid } from "../spatialGrid";
import type { HealthSystem } from "./health";

/** Bucket size of the targeting grid, in metres. Ranges reach hundreds of metres. */
const TARGET_CELL = 64;
/** A unit without a valid target looks for one every this many ticks (staggered by slot). */
export const RETARGET_TICKS = 5;
/** A projectile hits its target if it lands within the target's radius plus this, in metres. */
const HIT_TOLERANCE = 1;

/** Target categories, in priority order (lower is shot first). */
const ARMED_UNIT = 0;
const MOBILE_UNIT = 1;
const STRUCTURE = 2;

/**
 * Targeting, weapons and projectiles (docs/PLAN.md §4.4 steps 5–6).
 *
 * Every complete armed unit aims each weapon separately. A weapon keeps its target while it
 * stays alive, hostile and in range; an attack order's target overrides it whenever in range.
 * Without a target, a weapon looks for one only every {@link RETARGET_TICKS} ticks
 * (staggered by slot, so the cost spreads evenly), and prefers armed units, then other mobile
 * units, then structures, then the nearest, then the lowest slot.
 *
 * Instant weapons damage on the spot. Others launch a projectile at the target's current
 * position; it damages what is there when it lands. All damage goes through the
 * {@link HealthSystem}, which applies it later in the tick.
 */
export class CombatSystem implements SlotState {
  readonly projectiles = new ProjectilePool(PROJECTILE_CAPACITY);
  /** Seconds until each weapon may fire again, `MAX_WEAPONS` per slot. */
  private readonly cooldown: Float64Array;
  /** Entity id each weapon is aimed at, or 0. */
  private readonly aim: Uint32Array;
  private readonly grid: SpatialGrid;
  /** 1 for live units, 0 otherwise: what the targeting grid holds. */
  private readonly targetable: Uint8Array;
  private readonly scratch: Int32Array;
  /** Largest unit radius in the ruleset, so range queries can include a target's size. */
  private readonly maxRadius: number;

  constructor(
    private readonly ctx: SimContext,
    private readonly health: HealthSystem,
  ) {
    const cap = ctx.capacity;
    this.cooldown = new Float64Array(cap * MAX_WEAPONS);
    this.aim = new Uint32Array(cap * MAX_WEAPONS);
    this.grid = new SpatialGrid(ctx.width, ctx.depth, TARGET_CELL);
    this.targetable = new Uint8Array(cap);
    this.scratch = new Int32Array(cap);
    this.maxRadius = ctx.rules.units.reduce((r, u) => Math.max(r, u.radius), 0);
    ctx.register(this);
  }

  // ---------------------------------------------------------------------------------------
  // SlotState

  reset(i: number): void {
    for (let k = 0; k < MAX_WEAPONS; k++) {
      this.cooldown[i * MAX_WEAPONS + k] = 0;
      this.aim[i * MAX_WEAPONS + k] = 0;
    }
  }

  hashSlot(i: number, h: StateHasher): void {
    const n = this.ctx.unitStats(i)?.weapons.length ?? 0;
    for (let k = 0; k < n; k++) {
      h.f64(this.cooldown[i * MAX_WEAPONS + k] ?? 0).u32(this.aim[i * MAX_WEAPONS + k] ?? 0);
    }
  }

  hashGlobal(h: StateHasher): void {
    this.projectiles.hashInto(h);
  }

  /** Entity id weapon `k` of slot `i` is aimed at, or 0. */
  aimOf(i: number, k: number): number {
    return this.aim[i * MAX_WEAPONS + k] ?? 0;
  }

  // ---------------------------------------------------------------------------------------
  // The combat step

  /** Lands projectiles that arrive this tick, then aims and fires every weapon. */
  run(): void {
    const ctx = this.ctx;
    const w = ctx.world;
    for (let i = 0; i < w.highWater; i++) {
      this.targetable[i] = w.alive[i] === 1 && w.kind[i] === EntityKind.unit ? 1 : 0;
    }
    this.grid.rebuild(w.highWater, this.targetable, w.x, w.z, this.scratch);
    this.flyProjectiles();

    const dt = 1 / TICK_RATE;
    const units = ctx.rules.units;
    const retarget = ctx.tick % RETARGET_TICKS;
    for (let i = 0; i < w.highWater; i++) {
      if (this.targetable[i] === 0 || (w.progress[i] ?? 0) < 1) continue;
      const st = units[w.type[i] ?? 0];
      if (!st || st.weapons.length === 0) continue;
      const forced = this.orderedTarget(i);
      const canLook = (i + retarget) % RETARGET_TICKS === 0;
      for (let k = 0; k < st.weapons.length; k++) {
        const wi = st.weapons[k] ?? 0;
        const weapon = ctx.rules.weapons[wi];
        if (!weapon) continue;
        const s = i * MAX_WEAPONS + k;
        let t = -1;
        if (forced >= 0 && this.inRange(i, forced, weapon.range)) t = forced;
        else {
          const current = w.resolve(this.aim[s] ?? 0);
          if (current >= 0 && this.isEnemy(i, current) && this.inRange(i, current, weapon.range)) {
            t = current;
          } else if (canLook) {
            t = this.acquire(i, weapon.range);
          }
        }
        this.aim[s] = t >= 0 ? w.idAt(t) : 0;
        let cd = (this.cooldown[s] ?? 0) - dt;
        if (t >= 0 && cd <= 0) {
          this.fire(i, wi, weapon, t);
          cd += weapon.reload;
        }
        this.cooldown[s] = cd < 0 ? 0 : cd;
      }
    }
  }

  /** The live hostile unit unit `i`'s attack order names, or -1. */
  private orderedTarget(i: number): number {
    const order = this.ctx.orders[i]?.[0];
    if (order?.kind !== "attack") return -1;
    const t = this.ctx.world.resolve(order.target);
    return t >= 0 && this.isEnemy(i, t) ? t : -1;
  }

  /** True if `t` is a live unit hostile to unit `i`'s owner. */
  private isEnemy(i: number, t: number): boolean {
    const w = this.ctx.world;
    return (
      this.targetable[t] === 1 &&
      w.alive[t] === 1 &&
      this.ctx.hostile(w.owner[i] ?? 0, w.owner[t] ?? 0)
    );
  }

  /** True if unit `t`'s edge is within `range` of unit `i`'s centre. */
  private inRange(i: number, t: number, range: number): boolean {
    const w = this.ctx.world;
    const dx = (w.x[t] ?? 0) - (w.x[i] ?? 0);
    const dz = (w.z[t] ?? 0) - (w.z[i] ?? 0);
    const reach = range + (this.ctx.unitStats(t)?.radius ?? 0);
    return dx * dx + dz * dz <= reach * reach;
  }

  /** The best target for a weapon of `range` on unit `i`, or -1. */
  private acquire(i: number, range: number): number {
    const ctx = this.ctx;
    const w = ctx.world;
    const units = ctx.rules.units;
    const x = w.x[i] ?? 0;
    const z = w.z[i] ?? 0;
    let best = -1;
    let bestCategory = 0;
    let bestD2 = 0;
    this.grid.forEachNear(x, z, range + this.maxRadius, (j) => {
      if (j === i || !this.isEnemy(i, j)) return;
      const st = units[w.type[j] ?? 0];
      if (!st) return;
      const dx = (w.x[j] ?? 0) - x;
      const dz = (w.z[j] ?? 0) - z;
      const d2 = dx * dx + dz * dz;
      const reach = range + st.radius;
      if (d2 > reach * reach) return;
      const category = !st.mobile ? STRUCTURE : st.weapons.length > 0 ? ARMED_UNIT : MOBILE_UNIT;
      // Lexicographic (category, distance, slot): a total order, whatever the visit order.
      if (
        best < 0 ||
        category < bestCategory ||
        (category === bestCategory && (d2 < bestD2 || (d2 === bestD2 && j < best)))
      ) {
        best = j;
        bestCategory = category;
        bestD2 = d2;
      }
    });
    return best;
  }

  /** Fires weapon `wi` of unit `i` at unit `t`. */
  private fire(i: number, wi: number, weapon: WeaponStats, t: number): void {
    const ctx = this.ctx;
    const w = ctx.world;
    const owner = w.owner[i] ?? 0;
    const x = w.x[i] ?? 0;
    const z = w.z[i] ?? 0;
    const tx = w.x[t] ?? 0;
    const tz = w.z[t] ?? 0;
    ctx.emit({ t: "fire", weapon: wi, owner, x, z, tx, tz });
    const target = w.idAt(t);
    if (weapon.projectileSpeed <= 0 || this.projectiles.full) {
      this.impact(wi, owner, target, tx, tz);
      return;
    }
    const dx = tx - x;
    const dz = tz - z;
    const duration = Math.sqrt(dx * dx + dz * dz) / weapon.projectileSpeed;
    this.projectiles.add(wi, owner, target, x, z, tx, tz, duration);
  }

  /** Advances every projectile one tick and lands those that arrive. */
  private flyProjectiles(): void {
    const p = this.projectiles;
    const dt = 1 / TICK_RATE;
    for (let k = 0; k < p.highWater; k++) {
      if (p.alive[k] === 0) continue;
      const elapsed = (p.elapsed[k] ?? 0) + dt;
      p.elapsed[k] = elapsed;
      if (elapsed < (p.duration[k] ?? 0)) continue;
      this.impact(
        p.weapon[k] ?? 0,
        p.owner[k] ?? 0,
        p.target[k] ?? 0,
        p.toX[k] ?? 0,
        p.toZ[k] ?? 0,
      );
      p.remove(k);
    }
  }

  /**
   * A shot of weapon `wi`, fired by player `owner` at entity `target`, lands at (`x`, `z`).
   * Area weapons damage every hostile unit whose edge is inside the area; others damage
   * their target if it is still there. Allies are never damaged.
   */
  private impact(wi: number, owner: number, target: number, x: number, z: number): void {
    const ctx = this.ctx;
    const w = ctx.world;
    const weapon = ctx.rules.weapons[wi];
    if (!weapon) return;
    const units = ctx.rules.units;
    const within = (j: number, r: number): boolean => {
      const dx = (w.x[j] ?? 0) - x;
      const dz = (w.z[j] ?? 0) - z;
      const reach = r + (units[w.type[j] ?? 0]?.radius ?? 0);
      return dx * dx + dz * dz <= reach * reach;
    };
    if (weapon.areaRadius > 0) {
      this.grid.forEachNear(x, z, weapon.areaRadius + this.maxRadius, (j) => {
        if (this.targetable[j] === 0 || w.alive[j] === 0) return;
        if (!ctx.hostile(owner, w.owner[j] ?? 0) || !within(j, weapon.areaRadius)) return;
        this.health.damage(j, weapon.damage, owner);
      });
      return;
    }
    const t = w.resolve(target);
    if (t >= 0 && w.kind[t] === EntityKind.unit && within(t, HIT_TOLERANCE)) {
      this.health.damage(t, weapon.damage, owner);
    }
  }
}

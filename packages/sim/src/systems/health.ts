import type { SimContext, SlotState } from "../context";
import { EntityKind, NEUTRAL_OWNER } from "../ecs/world";
import { MAX_PLAYERS } from "../economy";
import type { StateHasher } from "../math/hash";

/** Per-player combat record, as returned by {@link HealthSystem.playerStats}. */
export interface PlayerCombatStats {
  /** Hostile units and structures this player destroyed. */
  kills: number;
  /** Units and structures this player lost, by any cause of damage. */
  losses: number;
}

/**
 * Damage and death (docs/PLAN.md §4.4 step 9). Weapons queue damage with {@link damage}
 * during the tick; {@link run}, late in the tick, applies it in ascending slot order and
 * destroys every unit at or below 0 hp: its slot is freed (and a structure's cells), and it
 * leaves its wreck feature, worth as much as it was built.
 *
 * Applying damage in one place, after every weapon has fired, means the order in which
 * units shoot within a tick never matters: two units can kill each other in the same tick.
 */
export class HealthSystem implements SlotState {
  /** Damage queued this tick per slot. Always zero between ticks. */
  private readonly pending: Float64Array;
  /** Player slot that dealt the last damage this tick, per slot. */
  private readonly source: Uint8Array;
  /** Slots with queued damage, in the order they were first hit. */
  private readonly hit: number[] = [];
  /** Kills then losses, two entries per player slot. */
  private readonly record = new Uint32Array(MAX_PLAYERS * 2);

  constructor(private readonly ctx: SimContext) {
    this.pending = new Float64Array(ctx.capacity);
    this.source = new Uint8Array(ctx.capacity).fill(NEUTRAL_OWNER);
    ctx.register(this);
  }

  // SlotState. Pending damage never survives a tick, so there is nothing per slot to hash.
  reset(i: number): void {
    this.pending[i] = 0;
    this.source[i] = NEUTRAL_OWNER;
  }

  hashSlot(): void {
    // Nothing persists per slot between ticks.
  }

  hashGlobal(h: StateHasher): void {
    for (const p of this.ctx.setup.players) {
      h.u32(this.record[p.slot * 2] ?? 0).u32(this.record[p.slot * 2 + 1] ?? 0);
    }
  }

  /** Kills and losses of player `slot` so far. */
  playerStats(slot: number): PlayerCombatStats {
    return { kills: this.record[slot * 2] ?? 0, losses: this.record[slot * 2 + 1] ?? 0 };
  }

  /** Queues `amount` damage to unit slot `t`, dealt by player `sourceSlot`. */
  damage(t: number, amount: number, sourceSlot: number): void {
    if (amount <= 0 || this.ctx.world.kind[t] !== EntityKind.unit) return;
    if (this.pending[t] === 0) this.hit.push(t);
    this.pending[t] = (this.pending[t] ?? 0) + amount;
    this.source[t] = sourceSlot;
  }

  /** Applies this tick's damage and destroys every unit left at or below 0 hp. */
  run(): void {
    const ctx = this.ctx;
    const w = ctx.world;
    if (this.hit.length === 0) return;
    const hit = this.hit.sort((a, b) => a - b);
    for (const i of hit) {
      const dmg = this.pending[i] ?? 0;
      const source = this.source[i] ?? NEUTRAL_OWNER;
      this.pending[i] = 0;
      this.source[i] = NEUTRAL_OWNER;
      // Freed this tick (reclaimed, or its slot reused): its damage went with it.
      if (dmg === 0 || w.alive[i] === 0 || w.kind[i] !== EntityKind.unit) continue;
      const hp = (w.health[i] ?? 0) - dmg;
      w.health[i] = hp;
      if (hp <= 0) this.destroy(i, source);
    }
    hit.length = 0;
  }

  /** Destroys unit slot `i`: records the kill, frees the slot and leaves its wreck. */
  destroy(i: number, source: number): void {
    const ctx = this.ctx;
    const w = ctx.world;
    const owner = w.owner[i] ?? 0;
    const type = w.type[i] ?? 0;
    const x = w.x[i] ?? 0;
    const z = w.z[i] ?? 0;
    const heading = w.heading[i] ?? 0;
    const built = w.progress[i] ?? 0;
    this.record[owner * 2 + 1] = (this.record[owner * 2 + 1] ?? 0) + 1;
    if (ctx.hostile(source, owner)) this.record[source * 2] = (this.record[source * 2] ?? 0) + 1;
    ctx.remove(i);
    ctx.emit({ t: "death", type, owner, x, z });
    const wreck = ctx.rules.units[type]?.wreckFeature ?? -1;
    if (wreck >= 0 && ctx.rules.features[wreck] && w.liveCount < w.capacity) {
      w.spawn({
        kind: EntityKind.feature,
        type: wreck,
        owner: NEUTRAL_OWNER,
        x,
        z,
        heading,
        progress: built,
      });
    }
  }
}

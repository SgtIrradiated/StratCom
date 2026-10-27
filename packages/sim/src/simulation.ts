import { assert } from "@stratcom/shared";
import type { PlayerCommand } from "./commands";
import { SimContext } from "./context";
import { EntityKind, NEUTRAL_OWNER, type World } from "./ecs/world";
import { MAX_PLAYERS, readEconomy, type PlayerEconomy } from "./economy";
import { StateHasher } from "./math/hash";
import { TICK_RATE, type MatchSetup } from "./rules";
import type { SnapshotBuffers } from "./snapshot";
import { CombatSystem } from "./systems/combat";
import { CommandSystem } from "./systems/commands";
import { HealthSystem, type PlayerCombatStats } from "./systems/health";
import { VictorySystem, type MatchStatus } from "./systems/victory";
import { MovementSystem } from "./systems/movement";
import { SeparationSystem } from "./systems/separation";
import { WorkSystem } from "./systems/work";

export {
  TICK_MS,
  TICK_RATE,
  setupCapacity,
  MAX_WEAPONS,
  type FeatureTypeStats,
  type InitialFeature,
  type InitialUnit,
  type MatchRules,
  type MatchSetup,
  type MovementClassDef,
  type PlayerSetup,
  type SimRuleset,
  type UnitTypeStats,
  type WeaponStats,
} from "./rules";

/**
 * The deterministic game simulation. A pure function of `(MatchSetup, command stream)`
 * (ADR-0002): feed two instances the same setup and the same commands per tick and their
 * {@link stateHash} values are always equal.
 *
 * Each tick runs the systems in `systems/` in a fixed order (docs/PLAN.md §4.4): commands,
 * movement (orders and flow fields), separation, combat (projectiles, targeting, weapons),
 * construction, repair, reclaim and the economy (ADR-0010), then damage and death, then
 * defeat and victory. Shared state lives in a {@link SimContext}.
 */
export class Simulation {
  private readonly ctx: SimContext;
  private readonly commands: CommandSystem;
  private readonly movement: MovementSystem;
  private readonly separation: SeparationSystem;
  private readonly work: WorkSystem;
  private readonly health: HealthSystem;
  private readonly combat: CombatSystem;
  private readonly victory: VictorySystem;

  constructor(setup: MatchSetup) {
    const slots = new Set(setup.players.map((p) => p.slot));
    assert(slots.size === setup.players.length, "duplicate player slots");
    for (const p of setup.players) {
      assert(
        Number.isInteger(p.slot) && p.slot >= 0 && p.slot < MAX_PLAYERS,
        `player slot out of range: ${p.slot}`,
      );
    }

    const ctx = new SimContext(setup);
    this.ctx = ctx;
    // Registration order with the context fixes the state-hash order: orders, work, health,
    // combat, victory.
    this.work = new WorkSystem(ctx);
    this.health = new HealthSystem(ctx);
    this.combat = new CombatSystem(ctx, this.health);
    this.victory = new VictorySystem(ctx, this.health);
    this.commands = new CommandSystem(ctx, this.work);
    this.movement = new MovementSystem(ctx, (order) => this.work.workFocus(order));
    this.separation = new SeparationSystem(ctx);

    const w = ctx.world;
    for (const u of setup.initialUnits) {
      assert(slots.has(u.slot), `initial unit for unknown slot ${u.slot}`);
      assert(setup.ruleset.units[u.type] !== undefined, `unknown unit type ${u.type}`);
      const i = ctx.spawnUnit({
        type: u.type,
        owner: u.slot,
        x: u.x,
        z: u.z,
        heading: u.heading ?? 0,
      });
      if (setup.ruleset.units[u.type]?.mobile === false) ctx.markFootprint(i, true);
    }
    for (const f of setup.features ?? []) {
      assert(setup.ruleset.features[f.type] !== undefined, `unknown feature type ${f.type}`);
      w.spawn({
        kind: EntityKind.feature,
        type: f.type,
        owner: NEUTRAL_OWNER,
        x: f.x,
        z: f.z,
        heading: f.heading ?? 0,
      });
    }
  }

  /** Number of ticks simulated so far. */
  get tick(): number {
    return this.ctx.tick;
  }

  /** Number of live entities. */
  get entityCount(): number {
    return this.ctx.world.liveCount;
  }

  /** True if the unit in slot `i` currently has an order. */
  hasOrder(i: number): boolean {
    return (this.ctx.orders[i]?.length ?? 0) > 0;
  }

  /** Number of orders queued for the unit in slot `i`. */
  orderCount(i: number): number {
    return this.ctx.orders[i]?.length ?? 0;
  }

  /** The production queue of the factory in slot `i` (head first). */
  productionQueue(i: number): readonly number[] {
    return this.work.productionQueue(i);
  }

  /** One player's economy after the latest tick. */
  economy(slot: number): PlayerEconomy {
    return readEconomy(this.work.econ, slot);
  }

  /** Every player's standing, and whether (and by whom) the match has been won. */
  matchStatus(): MatchStatus {
    return this.victory.status();
  }

  /** Kills and losses of player `slot` so far. */
  playerStats(slot: number): PlayerCombatStats {
    return this.health.playerStats(slot);
  }

  /** Entity id weapon `k` of the unit in slot `i` is aimed at, or 0. */
  weaponTarget(i: number, k: number): number {
    return this.combat.aimOf(i, k);
  }

  /** Number of projectiles in flight. */
  get projectileCount(): number {
    return this.combat.projectiles.count;
  }

  /** Read access to the world for tests and tools. Do not mutate it from outside. */
  get state(): World {
    return this.ctx.world;
  }

  /** Advances exactly one tick, applying `commands` first, in the order given. */
  step(commands: readonly PlayerCommand[]): void {
    this.commands.run(commands);
    this.movement.run();
    this.separation.run();
    this.combat.run();
    this.work.run();
    this.health.run();
    this.victory.run();
    this.ctx.tick++;
  }

  /** 32-bit hash of the full simulation state. */
  stateHash(): number {
    const ctx = this.ctx;
    const h = new StateHasher(ctx.tick);
    ctx.world.hashInto(h);
    ctx.hashInto(h);
    for (const word of ctx.prng.getState()) h.u32(word);
    return h.digest();
  }

  /**
   * Copies the render state into `out`. `out` must have capacity for every live entity.
   * Moves the events since the previous snapshot into `out.events`.
   */
  writeSnapshot(out: SnapshotBuffers): void {
    const w = this.ctx.world;
    const units = this.ctx.rules.units;
    assert(out.ids.length >= w.liveCount, "snapshot buffers too small");
    let n = 0;
    out.production = [];
    for (let i = 0; i < w.highWater; i++) {
      if (w.alive[i] === 0) continue;
      out.ids[n] = w.idAt(i);
      out.kinds[n] = w.kind[i] ?? 0;
      out.types[n] = w.type[i] ?? 0;
      out.owners[n] = w.owner[i] ?? 0;
      out.prevX[n] = w.prevX[i] ?? 0;
      out.prevZ[n] = w.prevZ[i] ?? 0;
      out.x[n] = w.x[i] ?? 0;
      out.z[n] = w.z[i] ?? 0;
      out.heading[n] = w.heading[i] ?? 0;
      out.progress[n] = w.progress[i] ?? 0;
      const max = w.kind[i] === EntityKind.unit ? (units[w.type[i] ?? 0]?.health ?? 0) : 0;
      out.health[n] = max > 0 ? (w.health[i] ?? 0) / max : 0;
      const queue = this.work.productionQueue(i);
      if (queue.length > 0) {
        out.production.push({
          id: w.idAt(i),
          queue: [...queue],
          progress: this.work.productionProgress(i),
        });
      }
      n++;
    }
    out.count = n;
    out.tick = this.ctx.tick;
    out.economy.set(this.work.econ);

    const p = this.combat.projectiles;
    const dt = 1 / TICK_RATE;
    let m = 0;
    for (let k = 0; k < p.highWater && m < out.projX.length; k++) {
      if (p.alive[k] === 0) continue;
      const elapsed = p.elapsed[k] ?? 0;
      const now = p.positionAt(k, elapsed);
      const before = p.positionAt(k, Math.max(elapsed - dt, 0));
      out.projPrevX[m] = before.x;
      out.projPrevZ[m] = before.z;
      out.projX[m] = now.x;
      out.projZ[m] = now.z;
      out.projT[m] = p.progress(k);
      out.projWeapon[m] = p.weapon[k] ?? 0;
      m++;
    }
    out.projectileCount = m;
    out.match = this.victory.status();
    out.events = this.ctx.events;
    this.ctx.events = [];
  }
}

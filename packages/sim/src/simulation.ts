import { assert } from "@stratcom/shared";
import type { PlayerCommand } from "./commands";
import { SimContext } from "./context";
import { EntityKind, NEUTRAL_OWNER, type World } from "./ecs/world";
import { MAX_PLAYERS, readEconomy, type PlayerEconomy } from "./economy";
import { StateHasher } from "./math/hash";
import type { MatchSetup } from "./rules";
import type { SnapshotBuffers } from "./snapshot";
import { CommandSystem } from "./systems/commands";
import { MovementSystem } from "./systems/movement";
import { SeparationSystem } from "./systems/separation";
import { WorkSystem } from "./systems/work";

export {
  TICK_MS,
  TICK_RATE,
  setupCapacity,
  type FeatureTypeStats,
  type InitialFeature,
  type InitialUnit,
  type MatchSetup,
  type MovementClassDef,
  type PlayerSetup,
  type SimRuleset,
  type UnitTypeStats,
} from "./rules";

/**
 * The deterministic game simulation. A pure function of `(MatchSetup, command stream)`
 * (ADR-0002): feed two instances the same setup and the same commands per tick and their
 * {@link stateHash} values are always equal.
 *
 * Each tick runs the systems in `systems/` in a fixed order (docs/PLAN.md §4.4): commands,
 * movement (orders and flow fields), separation, then construction, reclaim and the economy
 * (ADR-0010). Shared state lives in a {@link SimContext}.
 */
export class Simulation {
  private readonly ctx: SimContext;
  private readonly commands: CommandSystem;
  private readonly movement: MovementSystem;
  private readonly separation: SeparationSystem;
  private readonly work: WorkSystem;

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
    // Registration order with the context fixes the state-hash order: orders, then work.
    this.work = new WorkSystem(ctx);
    this.commands = new CommandSystem(ctx, this.work);
    this.movement = new MovementSystem(ctx, (order) => this.work.workFocus(order));
    this.separation = new SeparationSystem(ctx);

    const w = ctx.world;
    for (const u of setup.initialUnits) {
      assert(slots.has(u.slot), `initial unit for unknown slot ${u.slot}`);
      assert(setup.ruleset.units[u.type] !== undefined, `unknown unit type ${u.type}`);
      const id = w.spawn({ type: u.type, owner: u.slot, x: u.x, z: u.z, heading: u.heading ?? 0 });
      const i = w.resolve(id);
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

  /** Read access to the world for tests and tools. Do not mutate it from outside. */
  get state(): World {
    return this.ctx.world;
  }

  /** Advances exactly one tick, applying `commands` first, in the order given. */
  step(commands: readonly PlayerCommand[]): void {
    this.commands.run(commands);
    this.movement.run();
    this.separation.run();
    this.work.run();
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

  /** Copies the render state into `out`. `out` must have capacity for every live entity. */
  writeSnapshot(out: SnapshotBuffers): void {
    const w = this.ctx.world;
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
  }
}

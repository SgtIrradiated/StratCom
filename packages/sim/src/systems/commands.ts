import type { PlayerCommand } from "../commands";
import type { SimContext } from "../context";
import { EntityKind } from "../ecs/world";
import type { FlowField } from "../navigation";
import type { Order } from "../orders";
import { snapSite, toFacing } from "../placement";
import { MAX_PRODUCTION_QUEUE, type WorkSystem } from "./work";

/**
 * Command ingest (docs/PLAN.md §4.4 step 1). Every command is validated against the issuing
 * slot's ownership and the ruleset; anything malformed or not allowed is a no-op, so a
 * hostile peer cannot change another player's state.
 */
export class CommandSystem {
  constructor(
    private readonly ctx: SimContext,
    private readonly work: WorkSystem,
  ) {}

  /** Applies this tick's commands in the order given. */
  run(commands: readonly PlayerCommand[]): void {
    const ctx = this.ctx;
    for (const cmd of commands) {
      if (!ctx.hasPlayer(cmd.slot)) continue;
      if (!Array.isArray(cmd.units)) continue;
      switch (cmd.t) {
        case "move":
          this.move(cmd);
          break;
        case "stop":
          for (const i of ctx.owned(cmd.slot, cmd.units, () => true)) {
            ctx.orders[i] = [];
            if (!ctx.isMobile(i)) this.work.clearProduction(i);
          }
          break;
        case "build":
          this.build(cmd);
          break;
        case "reclaim":
        case "assist":
          this.workOrder(cmd);
          break;
        case "attack":
          this.attack(cmd);
          break;
        case "produce":
          this.produce(cmd);
          break;
        case "rally":
          this.rally(cmd);
          break;
      }
    }
  }

  private move(cmd: Extract<PlayerCommand, { t: "move" }>): void {
    const ctx = this.ctx;
    const w = ctx.world;
    const target = ctx.clampToMap(cmd.to);
    if (!target) return;
    const owned = new Set<number>();
    for (const id of cmd.units) {
      const i = w.resolve(id);
      if (i >= 0 && w.owner[i] === cmd.slot && ctx.isMobile(i)) owned.add(i);
    }
    // One flow field per movement class, shared by every unit of that class.
    const slots = [...owned].sort((a, b) => a - b);
    const perClass = new Map<number, FlowField | undefined>();
    for (const i of slots) {
      const mc = ctx.unitStats(i)?.movementClass ?? 0;
      if (!perClass.has(mc)) perClass.set(mc, ctx.nav.makeField(mc, target.x, target.z));
      const field = perClass.get(mc);
      const order: Order | undefined = field
        ? { kind: "move", field, groupSize: slots.length }
        : undefined;
      ctx.giveOrder(i, order, cmd.queue === true);
    }
  }

  private build(cmd: Extract<PlayerCommand, { t: "build" }>): void {
    const ctx = this.ctx;
    const stats = ctx.rules.units[cmd.unitType];
    const at = ctx.clampToMap(cmd.at);
    if (!stats || stats.mobile || !at || !Number.isInteger(cmd.unitType)) return;
    const facing = toFacing(cmd.facing);
    const site = snapSite(ctx.terrain, stats, facing, at.x, at.z, ctx.deposits);
    if (!site) return;
    const builders = ctx.owned(cmd.slot, cmd.units, (i) => {
      const s = ctx.unitStats(i);
      return s !== undefined && s.mobile && s.buildRate > 0 && s.builds.includes(cmd.unitType);
    });
    for (const i of builders) {
      ctx.giveOrder(
        i,
        { kind: "build", type: cmd.unitType, x: site.x, z: site.z, facing, target: 0 },
        cmd.queue === true,
      );
    }
  }

  private workOrder(cmd: Extract<PlayerCommand, { t: "reclaim" | "assist" }>): void {
    const ctx = this.ctx;
    const w = ctx.world;
    const t = w.resolve(cmd.target);
    if (t < 0) return;
    const isFeature = w.kind[t] === EntityKind.feature;
    const own = !isFeature && w.owner[t] === cmd.slot;
    if (cmd.t === "reclaim" ? !isFeature && !(own && !ctx.isMobile(t)) : !own) return;
    const builders = ctx.owned(cmd.slot, cmd.units, (i) => {
      const s = ctx.unitStats(i);
      return i !== t && s !== undefined && s.mobile && s.buildRate > 0;
    });
    for (const i of builders) {
      ctx.giveOrder(i, { kind: cmd.t, target: w.idAt(t) }, cmd.queue === true);
    }
  }

  private attack(cmd: Extract<PlayerCommand, { t: "attack" }>): void {
    const ctx = this.ctx;
    const w = ctx.world;
    const t = w.resolve(cmd.target);
    if (t < 0 || w.kind[t] !== EntityKind.unit || !ctx.hostile(cmd.slot, w.owner[t] ?? 0)) return;
    const shooters = ctx.owned(cmd.slot, cmd.units, (i) => {
      return (ctx.unitStats(i)?.weapons.length ?? 0) > 0;
    });
    for (const i of shooters) {
      ctx.giveOrder(i, { kind: "attack", target: w.idAt(t) }, cmd.queue === true);
    }
  }

  private produce(cmd: Extract<PlayerCommand, { t: "produce" }>): void {
    const ctx = this.ctx;
    const type = cmd.unitType;
    const count = cmd.count;
    if (!Number.isInteger(count) || count === 0 || Math.abs(count) > MAX_PRODUCTION_QUEUE) return;
    if (ctx.rules.units[type]?.mobile !== true) return;
    const factories = ctx.owned(cmd.slot, cmd.units, (i) => {
      const s = ctx.unitStats(i);
      return s !== undefined && !s.mobile && s.buildRate > 0 && s.builds.includes(type);
    });
    for (const i of factories) this.work.changeQueue(i, type, count);
  }

  private rally(cmd: Extract<PlayerCommand, { t: "rally" }>): void {
    const ctx = this.ctx;
    const to = ctx.clampToMap(cmd.to);
    if (!to) return;
    const factories = ctx.owned(cmd.slot, cmd.units, (i) => {
      const s = ctx.unitStats(i);
      return s !== undefined && !s.mobile && s.buildRate > 0;
    });
    for (const i of factories) this.work.setRally(i, to.x, to.z);
  }
}

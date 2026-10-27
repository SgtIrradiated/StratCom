import type { Focus, SimContext, SlotState } from "../context";
import { EntityKind } from "../ecs/world";
import { ECON_STRIDE, Econ, MAX_PLAYERS, stallFactor } from "../economy";
import type { StateHasher } from "../math/hash";
import { cos, sin } from "../math/trig";
import { cellAt, nearestPassable } from "../navigation";
import type { BuildOrder, WorkOrder } from "../orders";
import { distanceToFootprint, facingHeading, placementProblem, type Footprint } from "../placement";
import { TICK_RATE, type UnitTypeStats } from "../rules";

/** Salvage per second reclaimed from features by one unit of build rate. */
const FEATURE_RECLAIM_PER_SEC = 10;
/** Own structures are dismantled this many times faster than they are built. */
const DISMANTLE_SPEED = 2;
/** Longest production queue a factory accepts. */
export const MAX_PRODUCTION_QUEUE = 100;
/** Metres a new unit drives out of its factory when no rally point is set. */
const EXIT_DISTANCE = 12;
/** Progress this close to 1 counts as finished, absorbing float rounding. */
const DONE = 1 - 1e-9;

/**
 * Construction, factories, repair, reclaim and the flow economy (ADR-0010). Builders place
 * sites and put build power into jobs, factories produce, reclaimers strip targets, then each
 * player's income, storage and stall factor are settled. Every job of a player gets the same
 * stall factor, so a shortfall slows all of their construction proportionally.
 *
 * A job is keyed by entity slot: the slot itself for building it (or what its factory
 * produces), and slot + capacity for repairing it. Repair restores health at the rate it
 * would be built, for the same share of its cost.
 *
 * Owns the factory production queues, rally points and the per-player economy.
 */
export class WorkSystem implements SlotState {
  /** Factory production queue per entity slot. */
  private readonly queues: number[][];
  /** Progress of the head of each factory's queue. */
  private readonly jobProgress: Float64Array;
  private readonly hasRally: Uint8Array;
  private readonly rallyX: Float64Array;
  private readonly rallyZ: Float64Array;
  /** Per-player economy, `ECON_STRIDE` figures per slot (see `Econ`). */
  readonly econ = new Float64Array(MAX_PLAYERS * ECON_STRIDE);
  private readonly reclaimMultiplier = new Float64Array(MAX_PLAYERS).fill(1);
  private readonly isPlayer = new Uint8Array(MAX_PLAYERS);
  /** Per-tick scratch for {@link run}: two entries (salvage, power) per player slot. */
  private readonly income = new Float64Array(MAX_PLAYERS * 2);
  private readonly capacity = new Float64Array(MAX_PLAYERS * 2);
  private readonly demand = new Float64Array(MAX_PLAYERS * 2);
  private readonly spent = new Float64Array(MAX_PLAYERS * 2);
  private readonly stall = new Float64Array(MAX_PLAYERS);
  private readonly jobRate: Float64Array;
  private readonly jobStep: Float64Array;

  constructor(private readonly ctx: SimContext) {
    const capacity = ctx.capacity;
    this.queues = Array.from({ length: capacity }, () => []);
    this.jobProgress = new Float64Array(capacity);
    this.hasRally = new Uint8Array(capacity);
    this.rallyX = new Float64Array(capacity);
    this.rallyZ = new Float64Array(capacity);
    this.jobRate = new Float64Array(capacity * 2);
    this.jobStep = new Float64Array(capacity * 2);
    for (const p of ctx.setup.players) {
      this.isPlayer[p.slot] = 1;
      const o = p.slot * ECON_STRIDE;
      this.econ[o + Econ.salvage] = p.startingResources?.salvage ?? 0;
      this.econ[o + Econ.power] = p.startingResources?.power ?? 0;
      this.econ[o + Econ.efficiency] = 1;
      this.reclaimMultiplier[p.slot] = p.reclaimMultiplier ?? 1;
    }
    ctx.register(this);
  }

  // ---------------------------------------------------------------------------------------
  // SlotState

  reset(i: number): void {
    this.clearProduction(i);
    this.hasRally[i] = 0;
    this.rallyX[i] = 0;
    this.rallyZ[i] = 0;
  }

  hashSlot(i: number, h: StateHasher): void {
    const queue = this.queues[i] ?? [];
    h.u32(queue.length);
    for (const t of queue) h.u32(t);
    h.f64(this.jobProgress[i] ?? 0).u32(this.hasRally[i] ?? 0);
    if (this.hasRally[i] === 1) h.f64(this.rallyX[i] ?? 0).f64(this.rallyZ[i] ?? 0);
  }

  hashGlobal(h: StateHasher): void {
    for (const p of this.ctx.setup.players) {
      for (let k = 0; k < ECON_STRIDE; k++) h.f64(this.econ[p.slot * ECON_STRIDE + k] ?? 0);
    }
  }

  // ---------------------------------------------------------------------------------------
  // Factories

  /** The production queue of the factory in slot `i` (head first). */
  productionQueue(i: number): readonly number[] {
    return this.queues[i] ?? [];
  }

  /** Progress of the head of factory `i`'s queue. */
  productionProgress(i: number): number {
    return this.jobProgress[i] ?? 0;
  }

  /** Empties factory `i`'s production queue. */
  clearProduction(i: number): void {
    this.queues[i] = [];
    this.jobProgress[i] = 0;
  }

  /**
   * Appends `count` units of `type` to factory `i`'s queue, or removes that many from the end
   * when `count` is negative.
   */
  changeQueue(i: number, type: number, count: number): void {
    const queue = this.queues[i] ?? [];
    if (count > 0) {
      for (let k = 0; k < count && queue.length < MAX_PRODUCTION_QUEUE; k++) queue.push(type);
    } else {
      let remove = -count;
      for (let k = queue.length - 1; k >= 0 && remove > 0; k--) {
        if (queue[k] !== type) continue;
        queue.splice(k, 1);
        remove--;
        // Cancelling the unit in production discards its progress (and what it cost).
        if (k === 0) this.jobProgress[i] = 0;
      }
    }
    this.queues[i] = queue;
  }

  /** Sends factory `i`'s finished units to (`x`, `z`). */
  setRally(i: number, x: number, z: number): void {
    this.hasRally[i] = 1;
    this.rallyX[i] = x;
    this.rallyZ[i] = z;
  }

  // ---------------------------------------------------------------------------------------
  // The work step

  /** Runs one tick of construction, production, reclaim and the economy. */
  run(): void {
    const ctx = this.ctx;
    const w = ctx.world;
    const units = ctx.rules.units;
    const dt = 1 / TICK_RATE;
    const econ = this.econ;
    const { income, capacity, demand, spent, stall: factor } = this;
    income.fill(0);
    capacity.fill(0);
    demand.fill(0);
    spent.fill(0);
    const jobs: number[] = [];
    const reclaimers: number[] = [];
    const addWork = (job: number, rate: number): void => {
      if (this.jobRate[job] === 0) jobs.push(job);
      this.jobRate[job] = (this.jobRate[job] ?? 0) + rate;
    };

    // 1. Income, storage and build power from every complete unit.
    const end = w.highWater;
    for (let i = 0; i < end; i++) {
      if (w.alive[i] === 0 || w.kind[i] !== EntityKind.unit || (w.progress[i] ?? 0) < 1) continue;
      const st = units[w.type[i] ?? 0];
      if (!st) continue;
      const p = w.owner[i] ?? 0;
      income[p * 2] = (income[p * 2] ?? 0) + st.economy.salvagePerSec * dt;
      income[p * 2 + 1] = (income[p * 2 + 1] ?? 0) + st.economy.powerPerSec * dt;
      capacity[p * 2] = (capacity[p * 2] ?? 0) + st.economy.storageSalvage;
      capacity[p * 2 + 1] = (capacity[p * 2 + 1] ?? 0) + st.economy.storagePower;
      if (st.buildRate <= 0) continue;
      if (!st.mobile) {
        if ((this.queues[i]?.length ?? 0) > 0) addWork(i, st.buildRate);
        continue;
      }
      const queue = ctx.orders[i];
      if (!queue || queue.length === 0) continue;
      const order = queue[0];
      if (!order || order.kind === "move" || order.kind === "attack") continue;
      const job = this.workJob(i, order, st);
      if (job === "reclaim") reclaimers.push(i);
      else if (job >= 0) addWork(job, st.buildRate);
    }

    // 2. Reclaim: salvage counts as income, so it can pay for this tick's builds.
    for (const r of reclaimers) {
      const order = ctx.orders[r]?.[0];
      const t = order?.kind === "reclaim" ? w.resolve(order.target) : -1;
      if (t < 0) continue; // already reclaimed by someone earlier this tick
      const rate = units[w.type[r] ?? 0]?.buildRate ?? 0;
      const p = w.owner[r] ?? 0;
      let gained: number;
      if (w.kind[t] === EntityKind.feature) {
        const value = ctx.rules.features[w.type[t] ?? 0]?.salvage ?? 0;
        const take = Math.min(rate * FEATURE_RECLAIM_PER_SEC * dt, (w.progress[t] ?? 0) * value);
        w.progress[t] = value > 0 ? (w.progress[t] ?? 0) - take / value : 0;
        gained = take * (this.reclaimMultiplier[p] ?? 1);
      } else {
        const cost = units[w.type[t] ?? 0]?.cost;
        if (!cost) continue;
        const dp = Math.min((rate * DISMANTLE_SPEED * dt) / cost.buildTime, w.progress[t] ?? 0);
        w.progress[t] = (w.progress[t] ?? 0) - dp;
        // Health falls with what is left of it.
        const max = units[w.type[t] ?? 0]?.health ?? 0;
        w.health[t] = Math.min(w.health[t] ?? 0, (w.progress[t] ?? 0) * max);
        gained = dp * cost.salvage;
      }
      income[p * 2] = (income[p * 2] ?? 0) + gained;
      if ((w.progress[t] ?? 0) <= 1e-9) ctx.remove(t);
    }

    // 3. Demand: what every job would draw this tick at full speed.
    for (const j of jobs) {
      const rate = this.jobRate[j] ?? 0;
      const slot = this.jobSlot(j);
      const cost = w.alive[slot] === 1 ? this.jobCost(j) : undefined;
      if (!cost) {
        this.jobStep[j] = 0;
        continue;
      }
      const done = this.jobDone(j);
      const step = Math.max(Math.min((rate * dt) / cost.buildTime, 1 - done), 0);
      this.jobStep[j] = step;
      const p = w.owner[slot] ?? 0;
      demand[p * 2] = (demand[p * 2] ?? 0) + step * cost.salvage;
      demand[p * 2 + 1] = (demand[p * 2 + 1] ?? 0) + step * cost.power;
    }

    // 4. One stall factor per player; then progress and spending.
    for (let p = 0; p < MAX_PLAYERS; p++) {
      const o = p * ECON_STRIDE;
      factor[p] = Math.min(
        stallFactor(econ[o + Econ.salvage] ?? 0, income[p * 2] ?? 0, demand[p * 2] ?? 0),
        stallFactor(econ[o + Econ.power] ?? 0, income[p * 2 + 1] ?? 0, demand[p * 2 + 1] ?? 0),
      );
    }
    for (const j of jobs) {
      const step = this.jobStep[j] ?? 0;
      this.jobRate[j] = 0;
      this.jobStep[j] = 0;
      const cost = step > 0 ? this.jobCost(j) : undefined;
      if (!cost) continue;
      const slot = this.jobSlot(j);
      const p = w.owner[slot] ?? 0;
      const s = step * (factor[p] ?? 0);
      spent[p * 2] = (spent[p * 2] ?? 0) + s * cost.salvage;
      spent[p * 2 + 1] = (spent[p * 2 + 1] ?? 0) + s * cost.power;
      const max = units[w.type[slot] ?? 0]?.health ?? 0;
      if (j !== slot) {
        this.heal(slot, s * max, max);
      } else if ((w.progress[j] ?? 0) < 1) {
        const next = (w.progress[j] ?? 0) + s;
        w.progress[j] = next >= DONE ? 1 : next;
        // A site gains health as it is built; damage it took while building stays.
        this.heal(j, s * max, max);
      } else {
        const next = (this.jobProgress[j] ?? 0) + s;
        this.jobProgress[j] = next >= DONE ? 1 : next;
      }
    }
    // Factories whose current unit is done roll it out (retrying while the world is full).
    for (let i = 0; i < end; i++) {
      if (w.alive[i] === 1 && (this.queues[i]?.length ?? 0) > 0 && this.jobProgress[i] === 1) {
        this.rollOut(i);
      }
    }

    // 5. Settle storage and publish the per-second figures.
    for (let p = 0; p < MAX_PLAYERS; p++) {
      if (this.isPlayer[p] === 0) continue;
      const o = p * ECON_STRIDE;
      for (let r = 0; r < 2; r++) {
        const stored = (econ[o + r] ?? 0) + (income[p * 2 + r] ?? 0) - (spent[p * 2 + r] ?? 0);
        const cap = capacity[p * 2 + r] ?? 0;
        econ[o + r] = stored > cap ? cap : stored < 0 ? 0 : stored;
        econ[o + Econ.salvageCapacity + r] = cap;
        econ[o + Econ.salvageIncome + r] = (income[p * 2 + r] ?? 0) * TICK_RATE;
        econ[o + Econ.salvageSpent + r] = (spent[p * 2 + r] ?? 0) * TICK_RATE;
        econ[o + Econ.salvageDemand + r] = (demand[p * 2 + r] ?? 0) * TICK_RATE;
      }
      econ[o + Econ.efficiency] = factor[p] ?? 1;
    }
  }

  /**
   * Resolves builder `i`'s work order for this tick: the job slot to put build power into,
   * `"reclaim"`, or -1 for nothing (out of range, waiting, or the order just ended).
   */
  private workJob(i: number, order: WorkOrder, st: UnitTypeStats): number | "reclaim" {
    const ctx = this.ctx;
    const w = ctx.world;
    const t = w.resolve(order.target);
    if (order.kind === "build") {
      if (t < 0) {
        // Placed before, and since removed: the order is over.
        if (order.target !== 0) return ctx.finishOrder(i);
        const site = ctx.siteOf(order);
        if (
          distanceToFootprint(ctx.terrain, site, w.x[i] ?? 0, w.z[i] ?? 0) - st.radius >
          st.buildRange
        ) {
          return -1;
        }
        const placed = this.placeOrAdopt(order, site, w.owner[i] ?? 0);
        if (placed < 0) return ctx.finishOrder(i);
        order.target = w.idAt(placed);
        return placed;
      }
      if ((w.progress[t] ?? 0) >= 1) return ctx.finishOrder(i);
      return ctx.gapTo(i, ctx.focusOf(t)) <= st.buildRange ? t : -1;
    }
    if (t < 0) return ctx.finishOrder(i);
    if (order.kind === "reclaim") {
      return ctx.gapTo(i, ctx.focusOf(t)) <= st.buildRange ? "reclaim" : -1;
    }
    const job = this.jobOf(t);
    if (job < 0) {
      // Nothing to help with. Builders and factories may start again, so keep guarding them.
      return (ctx.unitStats(t)?.buildRate ?? 0) > 0 ? -1 : ctx.finishOrder(i);
    }
    return ctx.gapTo(i, ctx.focusOf(this.jobSlot(job))) <= st.buildRange ? job : -1;
  }

  /**
   * The job that assisting `t` puts build power into, or -1: finishing it, repairing it,
   * then whatever it is building or producing.
   */
  private jobOf(t: number): number {
    const ctx = this.ctx;
    const w = ctx.world;
    if (w.kind[t] !== EntityKind.unit) return -1;
    if ((w.progress[t] ?? 0) < 1) return t;
    const st = ctx.unitStats(t);
    if (!st) return -1;
    if ((w.health[t] ?? 0) < st.health) return t + ctx.capacity;
    if (!st.mobile) return (this.queues[t]?.length ?? 0) > 0 ? t : -1;
    const order = ctx.orders[t]?.[0];
    if (order?.kind !== "build") return -1;
    const b = w.resolve(order.target);
    return b >= 0 && (w.progress[b] ?? 0) < 1 ? b : -1;
  }

  /** Where a work order is going: its target, or the site of a build not yet placed. */
  workFocus(order: WorkOrder): Focus | undefined {
    const ctx = this.ctx;
    const t = ctx.world.resolve(order.target);
    if (order.kind === "build") {
      if (t >= 0) return ctx.focusOf(t);
      if (order.target !== 0) return undefined;
      const site = ctx.siteOf(order);
      return { x: site.x, z: site.z, radius: 0, footprint: site };
    }
    if (t < 0) return undefined;
    if (order.kind === "assist") {
      const job = this.jobOf(t);
      return ctx.focusOf(job >= 0 ? this.jobSlot(job) : t);
    }
    return ctx.focusOf(t);
  }

  /** The entity slot job `j` works on. */
  private jobSlot(j: number): number {
    return j >= this.ctx.capacity ? j - this.ctx.capacity : j;
  }

  /** Cost of job `j`: its own construction or repair, or its factory's current unit. */
  private jobCost(j: number): UnitTypeStats["cost"] | undefined {
    const w = this.ctx.world;
    const slot = this.jobSlot(j);
    const own = slot !== j || (w.progress[j] ?? 0) < 1;
    const type = own ? (w.type[slot] ?? 0) : this.queues[j]?.[0];
    return type === undefined ? undefined : this.ctx.rules.units[type]?.cost;
  }

  /** How far job `j` has come, in [0, 1]: health for repair, otherwise build progress. */
  private jobDone(j: number): number {
    const w = this.ctx.world;
    const slot = this.jobSlot(j);
    if (slot !== j) {
      const max = this.ctx.rules.units[w.type[slot] ?? 0]?.health ?? 0;
      return max > 0 ? (w.health[slot] ?? 0) / max : 1;
    }
    return (w.progress[j] ?? 0) < 1 ? (w.progress[j] ?? 0) : (this.jobProgress[j] ?? 0);
  }

  /** Adds `amount` health to slot `i`, up to `max`. */
  private heal(i: number, amount: number, max: number): void {
    const w = this.ctx.world;
    const next = (w.health[i] ?? 0) + amount;
    w.health[i] = next >= max * DONE ? max : next;
  }

  /** Places a new site for `order`, or adopts an identical unfinished one already there. */
  private placeOrAdopt(order: BuildOrder, site: Footprint, owner: number): number {
    const ctx = this.ctx;
    const w = ctx.world;
    const stats = ctx.rules.units[order.type];
    if (!stats) return -1;
    const problem = placementProblem(
      ctx.terrain,
      stats,
      site,
      ctx.deposits,
      (cell) => ctx.nav.occupied[cell] !== 0,
    );
    if (problem === "occupied") {
      // Several builders given the same order: the first one places, the rest join in.
      const other = ctx.nav.structureAt(site.col, site.row);
      const same =
        other >= 0 &&
        w.owner[other] === owner &&
        w.type[other] === order.type &&
        (w.progress[other] ?? 0) < 1 &&
        w.x[other] === site.x &&
        w.z[other] === site.z;
      return same ? other : -1;
    }
    if (problem !== undefined || w.liveCount >= w.capacity) return -1;
    const i = ctx.spawnUnit({
      type: order.type,
      owner,
      x: site.x,
      z: site.z,
      heading: facingHeading(order.facing),
      progress: 0,
    });
    ctx.markFootprint(i, true);
    return i;
  }

  /** Spawns the finished unit at the front of factory `f` and sends it on its way. */
  private rollOut(f: number): void {
    const ctx = this.ctx;
    const w = ctx.world;
    const type = this.queues[f]?.[0];
    const st = type === undefined ? undefined : ctx.rules.units[type];
    if (type === undefined || !st) return;
    if (w.liveCount >= w.capacity) return; // stays finished; retried next tick
    const fp = ctx.footprintOf(f);
    const h = w.heading[f] ?? 0;
    const fx = sin(h);
    const fz = cos(h);
    const cs = ctx.terrain.cellSize;
    const half = ((Math.abs(fx) > 0.5 ? fp.cols : fp.rows) * cs) / 2;
    const out = half + st.radius + 1;
    let sx = (w.x[f] ?? 0) + fx * out;
    let sz = (w.z[f] ?? 0) + fz * out;
    const grid = ctx.nav.grids[st.movementClass];
    if (grid) {
      const cell = cellAt(grid, sx, sz);
      const open = nearestPassable(grid, cell);
      if (open >= 0 && open !== cell) {
        sx = ((open % grid.cols) + 0.5) * grid.cellSize;
        sz = (Math.floor(open / grid.cols) + 0.5) * grid.cellSize;
      }
    }
    const u = ctx.spawnUnit({ type, owner: w.owner[f] ?? 0, x: sx, z: sz, heading: h });
    this.queues[f]?.shift();
    this.jobProgress[f] = 0;
    const rally = this.hasRally[f] === 1;
    const field = ctx.nav.makeField(
      st.movementClass,
      rally ? (this.rallyX[f] ?? 0) : sx + fx * EXIT_DISTANCE,
      rally ? (this.rallyZ[f] ?? 0) : sz + fz * EXIT_DISTANCE,
    );
    if (field) ctx.orders[u] = [{ kind: "move", field, groupSize: 1 }];
  }
}

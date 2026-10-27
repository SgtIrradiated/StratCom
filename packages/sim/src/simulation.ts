import { assert } from "@stratcom/shared";
import { EntityKind, NEUTRAL_OWNER, World } from "./ecs/world";
import type { Facing, PlayerCommand, Vec2 } from "./commands";
import { ECON_STRIDE, Econ, MAX_PLAYERS, readEconomy, stallFactor } from "./economy";
import type { PlayerEconomy } from "./economy";
import { Prng } from "./math/prng";
import { StateHasher } from "./math/hash";
import { atan2, cos, sin, wrapAngle } from "./math/trig";
import {
  buildNavGrid,
  cellAt,
  computeFlowCosts,
  flowDirection,
  hasLineOfSight,
  nearestPassable,
  type FlowField,
  type NavGrid,
} from "./navigation";
import {
  distanceToFootprint,
  facingHeading,
  footprintAt,
  headingFacing,
  placementProblem,
  snapSite,
  toFacing,
  type Footprint,
} from "./placement";
import { SpatialGrid } from "./spatialGrid";
import { terrainDepth, terrainWidth, type Terrain } from "./terrain";
import type { SnapshotBuffers } from "./snapshot";

/** Fixed simulation rate in ticks per second (ADR-0007). */
export const TICK_RATE = 20;

/** Duration of one simulation tick in milliseconds. */
export const TICK_MS = 1000 / TICK_RATE;

/** Terrain a class of units can cross. Each class gets its own navigation grid. */
export interface MovementClassDef {
  /** Steepest passable slope, as rise over run. */
  maxSlope: number;
}

/** What the simulation needs to know about one unit type. */
export interface UnitTypeStats {
  /** False for structures: they never move and are not pushed by separation. */
  mobile: boolean;
  /** Index into `SimRuleset.movementClasses`; ignored (conventionally -1) when immobile. */
  movementClass: number;
  /** Collision radius in metres, used for separation. */
  radius: number;
  /** Top speed in metres per second. */
  speed: number;
  /** Maximum turn rate in radians per second. */
  turnRate: number;
  /** Total salvage and power drawn while it is built, and seconds to build at build rate 1. */
  cost: { readonly salvage: number; readonly power: number; readonly buildTime: number };
  /** Structures: footprint in terrain cells at facing 0. Zero for mobile units. */
  footprint: { readonly x: number; readonly z: number };
  /** Structures: `deposit` means it must be centred on a salvage deposit. */
  placement: "ground" | "deposit";
  /** Unit type ids it can build: structures for mobile builders, units for factories. */
  builds: readonly number[];
  /** Build power; 0 if it cannot build. Also scales reclaim speed. */
  buildRate: number;
  /** Mobile builders: reach in metres, edge to edge. */
  buildRange: number;
  /** Production and storage while complete. Rates per second. */
  economy: {
    readonly salvagePerSec: number;
    readonly powerPerSec: number;
    readonly storageSalvage: number;
    readonly storagePower: number;
  };
}

/** What the simulation needs to know about one feature type (debris, wrecks). */
export interface FeatureTypeStats {
  /** Reach radius in metres. */
  radius: number;
  /** Salvage recovered by reclaiming it completely. */
  salvage: number;
}

/**
 * The rules the simulation runs on, indexed by numeric id. `CompiledRuleset` from
 * `@stratcom/data` satisfies this; tests and benchmarks can pass a minimal literal.
 */
export interface SimRuleset {
  movementClasses: readonly MovementClassDef[];
  units: readonly UnitTypeStats[];
  features: readonly FeatureTypeStats[];
}

/** One player slot. Slots and teams are N-wide; nothing assumes two players. */
export interface PlayerSetup {
  /** 0 … `MAX_PLAYERS - 1`. */
  slot: number;
  team: number;
  factionId: string;
  /** CSS hex colour, e.g. "#c0392b". */
  color: string;
  /** Stored resources at tick 0 (clamped to storage on the first tick). Defaults to none. */
  startingResources?: { salvage: number; power: number };
  /** Multiplier on salvage from reclaiming features. Defaults to 1. */
  reclaimMultiplier?: number;
}

/** A unit present at tick 0. */
export interface InitialUnit {
  slot: number;
  /** Unit type id: an index into `SimRuleset.units`. */
  type: number;
  x: number;
  z: number;
  heading?: number;
}

/** A neutral feature present at tick 0. */
export interface InitialFeature {
  /** Feature type id: an index into `SimRuleset.features`. */
  type: number;
  x: number;
  z: number;
  heading?: number;
}

/** Everything that defines a match besides the command stream. */
export interface MatchSetup {
  seed: number;
  /** Ground heightmap; also defines the map extent in metres. */
  terrain: Terrain;
  players: readonly PlayerSetup[];
  ruleset: SimRuleset;
  initialUnits: readonly InitialUnit[];
  /** Neutral debris. Spawned after the units, so unit entity ids come first. */
  features?: readonly InitialFeature[];
  /** Salvage deposits in metres, on cell corners. Extractors must sit on one. */
  deposits?: readonly Vec2[];
  /** Entity capacity; defaults to the initial unit and feature count plus 4096. */
  capacity?: number;
}

/** Default entity capacity for a setup. */
export function setupCapacity(setup: MatchSetup): number {
  return setup.capacity ?? setup.initialUnits.length + (setup.features?.length ?? 0) + 4096;
}

/** A queued order. Work orders (build, reclaim, assist) hold entity ids, never slots. */
type Order =
  | { kind: "move"; field: FlowField; groupSize: number }
  | {
      kind: "build";
      type: number;
      x: number;
      z: number;
      facing: Facing;
      /** The structure once placed (or adopted); 0 before. */
      target: number;
      field?: FlowField | undefined;
      fieldCell?: number;
    }
  | {
      kind: "reclaim" | "assist";
      target: number;
      field?: FlowField | undefined;
      fieldCell?: number;
    };

type WorkOrder = Exclude<Order, { kind: "move" }>;

/** Spatial-hash bucket size; must be at least the largest pair radius sum. */
const SEPARATION_CELL = 16;
/** Fraction of an overlap resolved per tick. */
const SEPARATION_STIFFNESS = 0.5;
/** Beyond this many cells a unit follows the flow field instead of testing line of sight. */
const LINE_OF_SIGHT_CELLS = 40;
/** Salvage per second reclaimed from features by one unit of build rate. */
const FEATURE_RECLAIM_PER_SEC = 10;
/** Own structures are dismantled this many times faster than they are built. */
const DISMANTLE_SPEED = 2;
/** Longest production queue a factory accepts. */
const MAX_PRODUCTION_QUEUE = 100;
/** Most work-order flow fields kept for reuse. */
const FIELD_CACHE_LIMIT = 32;
/** Metres a new unit drives out of its factory when no rally point is set. */
const EXIT_DISTANCE = 12;
/** Progress this close to 1 counts as finished, absorbing float rounding. */
const DONE = 1 - 1e-9;

/**
 * The deterministic game simulation. A pure function of `(MatchSetup, command stream)`
 * (ADR-0002): feed two instances the same setup and the same commands per tick and their
 * {@link stateHash} values are always equal.
 *
 * Tick order (docs/PLAN.md §4.4): commands, movement (orders and flow fields), separation,
 * then construction, reclaim and the economy (ADR-0010).
 */
export class Simulation {
  private readonly world: World;
  private readonly prng: Prng;
  private currentTick = 0;
  private readonly navGrids: readonly NavGrid[];
  /** Terrain-only passability per movement class, to restore cells structures free up. */
  private readonly baseNav: readonly Uint8Array[];
  /** Bumped whenever a structure changes the grids; stale flow fields are recomputed. */
  private navVersion = 0;
  /** Structure slot + 1 per terrain cell, 0 where free. Indexed like the nav grids. */
  private readonly occupied: Int32Array;
  private readonly fieldCache = new Map<number, FlowField>();
  private readonly spatial: SpatialGrid;
  private readonly deposits: readonly Vec2[];
  /** Order queue per entity slot. */
  private readonly orders: Order[][];
  /** Factory production queue per entity slot. */
  private readonly queues: number[][];
  /** Progress of the head of each factory's queue. */
  private readonly jobProgress: Float64Array;
  private readonly hasRally: Uint8Array;
  private readonly rallyX: Float64Array;
  private readonly rallyZ: Float64Array;
  /** Per-player economy, `ECON_STRIDE` figures per slot (see `Econ`). */
  private readonly econ = new Float64Array(MAX_PLAYERS * ECON_STRIDE);
  private readonly reclaimMultiplier = new Float64Array(MAX_PLAYERS).fill(1);
  private readonly isPlayer = new Uint8Array(MAX_PLAYERS);
  /** Per-tick scratch for {@link work}: two entries (salvage, power) per player slot. */
  private readonly income = new Float64Array(MAX_PLAYERS * 2);
  private readonly capacity = new Float64Array(MAX_PLAYERS * 2);
  private readonly demand = new Float64Array(MAX_PLAYERS * 2);
  private readonly spent = new Float64Array(MAX_PLAYERS * 2);
  private readonly stall = new Float64Array(MAX_PLAYERS);
  private readonly jobRate: Float64Array;
  private readonly jobStep: Float64Array;
  private readonly bucketScratch: Int32Array;
  private readonly sepX: Float64Array;
  private readonly sepZ: Float64Array;

  constructor(private readonly setup: MatchSetup) {
    const capacity = setupCapacity(setup);
    this.world = new World(capacity);
    this.prng = new Prng(setup.seed);
    this.navGrids = setup.ruleset.movementClasses.map((m) =>
      buildNavGrid(setup.terrain, m.maxSlope),
    );
    this.baseNav = this.navGrids.map((g) => g.passable.slice());
    this.occupied = new Int32Array((setup.terrain.cols - 1) * (setup.terrain.rows - 1));
    this.spatial = new SpatialGrid(
      terrainWidth(setup.terrain),
      terrainDepth(setup.terrain),
      SEPARATION_CELL,
    );
    this.deposits = setup.deposits ?? [];
    this.orders = Array.from({ length: capacity }, () => []);
    this.queues = Array.from({ length: capacity }, () => []);
    this.jobProgress = new Float64Array(capacity);
    this.hasRally = new Uint8Array(capacity);
    this.rallyX = new Float64Array(capacity);
    this.rallyZ = new Float64Array(capacity);
    this.jobRate = new Float64Array(capacity);
    this.jobStep = new Float64Array(capacity);
    this.bucketScratch = new Int32Array(capacity);
    this.sepX = new Float64Array(capacity);
    this.sepZ = new Float64Array(capacity);

    const slots = new Set(setup.players.map((p) => p.slot));
    assert(slots.size === setup.players.length, "duplicate player slots");
    for (const p of setup.players) {
      assert(
        Number.isInteger(p.slot) && p.slot >= 0 && p.slot < MAX_PLAYERS,
        `player slot out of range: ${p.slot}`,
      );
      this.isPlayer[p.slot] = 1;
      const o = p.slot * ECON_STRIDE;
      this.econ[o + Econ.salvage] = p.startingResources?.salvage ?? 0;
      this.econ[o + Econ.power] = p.startingResources?.power ?? 0;
      this.econ[o + Econ.efficiency] = 1;
      this.reclaimMultiplier[p.slot] = p.reclaimMultiplier ?? 1;
    }
    for (const u of setup.initialUnits) {
      assert(slots.has(u.slot), `initial unit for unknown slot ${u.slot}`);
      assert(setup.ruleset.units[u.type] !== undefined, `unknown unit type ${u.type}`);
      const id = this.world.spawn({
        type: u.type,
        owner: u.slot,
        x: u.x,
        z: u.z,
        heading: u.heading ?? 0,
      });
      const i = this.world.resolve(id);
      if (setup.ruleset.units[u.type]?.mobile === false) this.markFootprint(i, true);
    }
    for (const f of setup.features ?? []) {
      assert(setup.ruleset.features[f.type] !== undefined, `unknown feature type ${f.type}`);
      this.world.spawn({
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
    return this.currentTick;
  }

  /** Number of live entities. */
  get entityCount(): number {
    return this.world.liveCount;
  }

  /** True if the unit in slot `i` currently has an order. */
  hasOrder(i: number): boolean {
    return (this.orders[i]?.length ?? 0) > 0;
  }

  /** Number of orders queued for the unit in slot `i`. */
  orderCount(i: number): number {
    return this.orders[i]?.length ?? 0;
  }

  /** The production queue of the factory in slot `i` (head first). */
  productionQueue(i: number): readonly number[] {
    return this.queues[i] ?? [];
  }

  /** One player's economy after the latest tick. */
  economy(slot: number): PlayerEconomy {
    return readEconomy(this.econ, slot);
  }

  /** Read access to the world for tests and tools. Do not mutate it from outside. */
  get state(): World {
    return this.world;
  }

  /** Advances exactly one tick, applying `commands` first, in the order given. */
  step(commands: readonly PlayerCommand[]): void {
    this.ingestCommands(commands);
    this.movement();
    this.separation();
    this.work();
    this.currentTick++;
  }

  /** 32-bit hash of the full simulation state. */
  stateHash(): number {
    const h = new StateHasher(this.currentTick);
    const w = this.world;
    w.hashInto(h);
    for (let i = 0; i < w.highWater; i++) {
      if (w.alive[i] === 0) continue;
      const orders = this.orders[i] ?? [];
      h.u32(orders.length);
      for (const o of orders) {
        if (o.kind === "move")
          h.u32(1)
            .u32(o.field.goalCell + 1)
            .u32(o.groupSize);
        else if (o.kind === "build") {
          h.u32(2).u32(o.type).f64(o.x).f64(o.z).u32(o.facing).u32(o.target);
        } else h.u32(o.kind === "reclaim" ? 3 : 4).u32(o.target);
      }
      const queue = this.queues[i] ?? [];
      h.u32(queue.length);
      for (const t of queue) h.u32(t);
      h.f64(this.jobProgress[i] ?? 0).u32(this.hasRally[i] ?? 0);
      if (this.hasRally[i] === 1) h.f64(this.rallyX[i] ?? 0).f64(this.rallyZ[i] ?? 0);
    }
    for (const p of this.setup.players) {
      for (let k = 0; k < ECON_STRIDE; k++) h.f64(this.econ[p.slot * ECON_STRIDE + k] ?? 0);
    }
    for (const word of this.prng.getState()) h.u32(word);
    return h.digest();
  }

  /** Copies the render state into `out`. `out` must have capacity for every live entity. */
  writeSnapshot(out: SnapshotBuffers): void {
    const w = this.world;
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
      const queue = this.queues[i] ?? [];
      if (queue.length > 0) {
        out.production.push({
          id: w.idAt(i),
          queue: [...queue],
          progress: this.jobProgress[i] ?? 0,
        });
      }
      n++;
    }
    out.count = n;
    out.tick = this.currentTick;
    out.economy.set(this.econ);
  }

  // ---------------------------------------------------------------------------------------
  // Commands

  /** Step 1 of docs/PLAN.md §4.4: validate and apply this tick's commands. */
  private ingestCommands(commands: readonly PlayerCommand[]): void {
    for (const cmd of commands) {
      if (!this.setup.players.some((p) => p.slot === cmd.slot)) continue;
      if (!Array.isArray(cmd.units)) continue;
      switch (cmd.t) {
        case "move":
          this.commandMove(cmd);
          break;
        case "stop":
          for (const i of this.owned(cmd.slot, cmd.units, () => true)) {
            this.orders[i] = [];
            if (!this.isMobile(i)) this.clearProduction(i);
          }
          break;
        case "build":
          this.commandBuild(cmd);
          break;
        case "reclaim":
        case "assist":
          this.commandWork(cmd);
          break;
        case "produce":
          this.commandProduce(cmd);
          break;
        case "rally":
          this.commandRally(cmd);
          break;
      }
    }
  }

  private commandMove(cmd: Extract<PlayerCommand, { t: "move" }>): void {
    const w = this.world;
    const target = this.clampToMap(cmd.to);
    if (!target) return;
    const owned = new Set<number>();
    for (const id of cmd.units) {
      const i = w.resolve(id);
      if (i >= 0 && w.owner[i] === cmd.slot && this.isMobile(i)) owned.add(i);
    }
    // One flow field per movement class, shared by every unit of that class.
    const slots = [...owned].sort((a, b) => a - b);
    const perClass = new Map<number, FlowField | undefined>();
    for (const i of slots) {
      const mc = this.unitStats(i)?.movementClass ?? 0;
      if (!perClass.has(mc)) perClass.set(mc, this.makeField(mc, target.x, target.z));
      const field = perClass.get(mc);
      const order: Order | undefined = field
        ? { kind: "move", field, groupSize: slots.length }
        : undefined;
      this.giveOrder(i, order, cmd.queue === true);
    }
  }

  private commandBuild(cmd: Extract<PlayerCommand, { t: "build" }>): void {
    const stats = this.setup.ruleset.units[cmd.unitType];
    const at = this.clampToMap(cmd.at);
    if (!stats || stats.mobile || !at || !Number.isInteger(cmd.unitType)) return;
    const facing = toFacing(cmd.facing);
    const site = snapSite(this.setup.terrain, stats, facing, at.x, at.z, this.deposits);
    if (!site) return;
    const builders = this.owned(cmd.slot, cmd.units, (i) => {
      const s = this.unitStats(i);
      return s !== undefined && s.mobile && s.buildRate > 0 && s.builds.includes(cmd.unitType);
    });
    for (const i of builders) {
      this.giveOrder(
        i,
        { kind: "build", type: cmd.unitType, x: site.x, z: site.z, facing, target: 0 },
        cmd.queue === true,
      );
    }
  }

  private commandWork(cmd: Extract<PlayerCommand, { t: "reclaim" | "assist" }>): void {
    const w = this.world;
    const t = w.resolve(cmd.target);
    if (t < 0) return;
    const isFeature = w.kind[t] === EntityKind.feature;
    const own = !isFeature && w.owner[t] === cmd.slot;
    if (cmd.t === "reclaim" ? !isFeature && !(own && !this.isMobile(t)) : !own) return;
    const builders = this.owned(cmd.slot, cmd.units, (i) => {
      const s = this.unitStats(i);
      return i !== t && s !== undefined && s.mobile && s.buildRate > 0;
    });
    for (const i of builders) {
      this.giveOrder(i, { kind: cmd.t, target: w.idAt(t) }, cmd.queue === true);
    }
  }

  private commandProduce(cmd: Extract<PlayerCommand, { t: "produce" }>): void {
    const type = cmd.unitType;
    const count = cmd.count;
    if (!Number.isInteger(count) || count === 0 || Math.abs(count) > MAX_PRODUCTION_QUEUE) return;
    if (this.setup.ruleset.units[type]?.mobile !== true) return;
    const factories = this.owned(cmd.slot, cmd.units, (i) => {
      const s = this.unitStats(i);
      return s !== undefined && !s.mobile && s.buildRate > 0 && s.builds.includes(type);
    });
    for (const i of factories) {
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
  }

  private commandRally(cmd: Extract<PlayerCommand, { t: "rally" }>): void {
    const to = this.clampToMap(cmd.to);
    if (!to) return;
    const factories = this.owned(cmd.slot, cmd.units, (i) => {
      const s = this.unitStats(i);
      return s !== undefined && !s.mobile && s.buildRate > 0;
    });
    for (const i of factories) {
      this.hasRally[i] = 1;
      this.rallyX[i] = to.x;
      this.rallyZ[i] = to.z;
    }
  }

  /** Live, complete units of `slot` among `ids` that pass `filter`, in ascending slot order. */
  private owned(slot: number, ids: readonly number[], filter: (i: number) => boolean): number[] {
    const w = this.world;
    const out = new Set<number>();
    for (const id of ids) {
      const i = w.resolve(id);
      if (i < 0 || w.owner[i] !== slot || w.kind[i] !== EntityKind.unit) continue;
      if ((w.progress[i] ?? 0) < 1 || !filter(i)) continue;
      out.add(i);
    }
    return [...out].sort((a, b) => a - b);
  }

  private giveOrder(i: number, order: Order | undefined, queue: boolean): void {
    if (!queue) this.orders[i] = order ? [order] : [];
    else if (order) this.orders[i]?.push(order);
  }

  /** A command's point clamped to the map, or undefined if it is not a finite point. */
  private clampToMap(p: unknown): Vec2 | undefined {
    if (typeof p !== "object" || p === null) return undefined;
    const { x, z } = p as { x?: unknown; z?: unknown };
    if (typeof x !== "number" || typeof z !== "number") return undefined;
    if (!Number.isFinite(x) || !Number.isFinite(z)) return undefined;
    return {
      x: Math.min(Math.max(x, 0), terrainWidth(this.setup.terrain)),
      z: Math.min(Math.max(z, 0), terrainDepth(this.setup.terrain)),
    };
  }

  // ---------------------------------------------------------------------------------------
  // Movement

  private makeField(movementClass: number, x: number, z: number): FlowField | undefined {
    const grid = this.navGrids[movementClass];
    if (!grid) return undefined;
    const goalCell = nearestPassable(grid, cellAt(grid, x, z));
    if (goalCell < 0) return undefined;
    // If the requested point was blocked, aim at the centre of the nearest open cell.
    const open = goalCell === cellAt(grid, x, z);
    const gx = open ? x : ((goalCell % grid.cols) + 0.5) * grid.cellSize;
    const gz = open ? z : (Math.floor(goalCell / grid.cols) + 0.5) * grid.cellSize;
    return {
      movementClass,
      goalCell,
      goalX: gx,
      goalZ: gz,
      cost: computeFlowCosts(grid, goalCell),
      version: this.navVersion,
    };
  }

  /** A shared field toward the open cell nearest (`x`, `z`), for work orders. */
  private workField(movementClass: number, cell: number): FlowField | undefined {
    const grid = this.navGrids[movementClass];
    if (!grid) return undefined;
    const key = movementClass * grid.cols * grid.rows + cell;
    const cached = this.fieldCache.get(key);
    if (cached) return cached;
    const goalCell = nearestPassable(grid, cell);
    if (goalCell < 0) return undefined;
    const field: FlowField = {
      movementClass,
      goalCell,
      goalX: ((goalCell % grid.cols) + 0.5) * grid.cellSize,
      goalZ: (Math.floor(goalCell / grid.cols) + 0.5) * grid.cellSize,
      cost: computeFlowCosts(grid, goalCell),
      version: this.navVersion,
    };
    // Map iteration follows insertion order, so eviction is deterministic (and the cache
    // only saves work: a cached field equals a freshly computed one).
    if (this.fieldCache.size >= FIELD_CACHE_LIMIT) {
      const oldest = this.fieldCache.keys().next();
      if (oldest.done !== true) this.fieldCache.delete(oldest.value);
    }
    this.fieldCache.set(key, field);
    return field;
  }

  /** Recomputes a field after structures changed its grid. */
  private refreshField(field: FlowField): void {
    if (field.version === this.navVersion) return;
    const grid = this.navGrids[field.movementClass];
    if (!grid) return;
    const goal = nearestPassable(grid, field.goalCell);
    if (goal >= 0 && goal !== field.goalCell) {
      field.goalCell = goal;
      field.goalX = ((goal % grid.cols) + 0.5) * grid.cellSize;
      field.goalZ = (Math.floor(goal / grid.cols) + 0.5) * grid.cellSize;
    }
    field.cost = computeFlowCosts(grid, field.goalCell);
    field.version = this.navVersion;
  }

  /** Steps 2–4: follow orders. Units stop in a disc whose size grows with the group. */
  private movement(): void {
    const w = this.world;
    for (let i = 0; i < w.highWater; i++) {
      if (w.alive[i] === 0) continue;
      w.prevX[i] = w.x[i] ?? 0;
      w.prevZ[i] = w.z[i] ?? 0;
      // Check the length first: reading past the end of an array is slow in V8.
      const queue = this.orders[i];
      if (!queue || queue.length === 0) continue;
      const order = queue[0];
      if (!order) continue;
      const stats = this.unitStats(i);
      if (!stats) continue;
      if (order.kind === "move") this.followMove(i, order, stats);
      else this.approach(i, order, stats);
    }
  }

  private followMove(
    i: number,
    order: Extract<Order, { kind: "move" }>,
    stats: UnitTypeStats,
  ): void {
    const w = this.world;
    const field = order.field;
    this.refreshField(field);
    const grid = this.navGrids[field.movementClass];
    if (!grid) return;
    const gx = field.goalX - (w.x[i] ?? 0);
    const gz = field.goalZ - (w.z[i] ?? 0);
    const goalDist = Math.sqrt(gx * gx + gz * gz);
    const stopRadius = stats.radius * (1 + 1.2 * Math.sqrt(order.groupSize));
    if (goalDist <= Math.max(stopRadius, 0.05)) {
      this.finishOrder(i);
      return;
    }
    if (!this.steer(i, stats, grid, field, goalDist)) this.finishOrder(i);
  }

  /** Walks a builder toward its work order's target until it is within build range. */
  private approach(i: number, order: WorkOrder, stats: UnitTypeStats): void {
    const w = this.world;
    const focus = this.workFocus(order);
    if (!focus) return; // the work step drops the order
    if (this.gapTo(i, focus) <= stats.buildRange) return;
    const grid = this.navGrids[stats.movementClass];
    if (!grid) return;
    const cell = cellAt(grid, focus.x, focus.z);
    if (!order.field || order.fieldCell !== cell) {
      order.field = this.workField(stats.movementClass, cell);
      order.fieldCell = cell;
    }
    const field = order.field;
    if (!field) {
      this.finishOrder(i);
      return;
    }
    this.refreshField(field);
    const gx = field.goalX - (w.x[i] ?? 0);
    const gz = field.goalZ - (w.z[i] ?? 0);
    const goalDist = Math.sqrt(gx * gx + gz * gz);
    // At the closest open cell and still out of reach: the target cannot be reached.
    if (goalDist <= 0.5 || !this.steer(i, stats, grid, field, goalDist)) this.finishOrder(i);
  }

  /**
   * Turns and moves unit `i` one tick along `field`. Returns false if there is no way to go.
   */
  private steer(
    i: number,
    stats: UnitTypeStats,
    grid: NavGrid,
    field: FlowField,
    goalDist: number,
  ): boolean {
    const w = this.world;
    const dt = 1 / TICK_RATE;
    const x = w.x[i] ?? 0;
    const z = w.z[i] ?? 0;
    let dx: number;
    let dz: number;
    if (
      goalDist < LINE_OF_SIGHT_CELLS * grid.cellSize &&
      hasLineOfSight(grid, x, z, field.goalX, field.goalZ)
    ) {
      dx = field.goalX - x;
      dz = field.goalZ - z;
    } else {
      const dir = flowDirection(grid, field, x, z) ?? this.escapeDirection(grid, x, z);
      if (!dir) return false;
      dx = dir.dx;
      dz = dir.dz;
    }
    const len = Math.sqrt(dx * dx + dz * dz);
    if (len === 0) return true;

    // Turn toward the desired direction at the unit's turn rate. Heading 0 faces +z, so
    // the angle of (dx, dz) is atan2(dx, dz).
    const diff = wrapAngle(atan2(dx, dz) - (w.heading[i] ?? 0));
    const maxTurn = stats.turnRate * dt;
    const turn = diff > maxTurn ? maxTurn : diff < -maxTurn ? -maxTurn : diff;
    w.heading[i] = wrapAngle((w.heading[i] ?? 0) + turn);

    // Full speed when facing the way we want to go, otherwise creep so tight turns work.
    const facing = turn === diff ? 1 : 0.35;
    const step = Math.min(stats.speed * dt * facing, goalDist);
    this.tryMove(i, x + (dx / len) * step, z + (dz / len) * step);
    return true;
  }

  /**
   * A unit caught inside a structure's footprint (it was placed on top of it) heads for the
   * nearest open cell. Undefined anywhere else.
   */
  private escapeDirection(
    grid: NavGrid,
    x: number,
    z: number,
  ): { dx: number; dz: number } | undefined {
    const cell = cellAt(grid, x, z);
    if (this.occupied[cell] === 0) return undefined;
    const open = nearestPassable(grid, cell);
    if (open < 0) return undefined;
    return {
      dx: ((open % grid.cols) + 0.5) * grid.cellSize - x,
      dz: (Math.floor(open / grid.cols) + 0.5) * grid.cellSize - z,
    };
  }

  /**
   * Step 4 (cont.): push overlapping units apart using the spatial hash. Two mobile units
   * each take half of the overlap; a mobile unit against a structure takes all of it, and
   * structures never move. Features take no part.
   */
  private separation(): void {
    const w = this.world;
    const types = this.setup.ruleset.units;
    this.spatial.rebuild(w.highWater, w.alive, w.x, w.z, this.bucketScratch);
    for (let i = 0; i < w.highWater; i++) {
      this.sepX[i] = 0;
      this.sepZ[i] = 0;
      if (w.alive[i] === 0 || w.kind[i] === EntityKind.feature) continue;
      const ti = types[w.type[i] ?? 0];
      if (ti?.mobile === false) continue;
      const ri = ti?.radius ?? 1;
      const xi = w.x[i] ?? 0;
      const zi = w.z[i] ?? 0;
      let px = 0;
      let pz = 0;
      this.spatial.forNeighbours(xi, zi, (j) => {
        if (j === i || w.kind[j] === EntityKind.feature) return;
        const tj = types[w.type[j] ?? 0];
        const reach = ri + (tj?.radius ?? 1);
        const dx = xi - (w.x[j] ?? 0);
        const dz = zi - (w.z[j] ?? 0);
        const d2 = dx * dx + dz * dz;
        if (d2 >= reach * reach) return;
        const share = tj?.mobile === false ? 1 : 0.5;
        if (d2 === 0) {
          // Exactly stacked: split along x, with opposite signs for the pair.
          px += (i < j ? 1 : -1) * reach * share;
          return;
        }
        const d = Math.sqrt(d2);
        const push = ((reach - d) * share) / d;
        px += dx * push;
        pz += dz * push;
      });
      this.sepX[i] = px * SEPARATION_STIFFNESS;
      this.sepZ[i] = pz * SEPARATION_STIFFNESS;
    }
    for (let i = 0; i < w.highWater; i++) {
      if (w.alive[i] === 0) continue;
      const sx = this.sepX[i] ?? 0;
      const sz = this.sepZ[i] ?? 0;
      if (sx !== 0 || sz !== 0) this.tryMove(i, (w.x[i] ?? 0) + sx, (w.z[i] ?? 0) + sz);
    }
  }

  /**
   * Moves a unit to (`nx`, `nz`) if that is on the map and passable, otherwise tries to slide
   * along one axis, otherwise stays put. A unit standing inside a structure's footprint may
   * move freely so it can get out.
   */
  private tryMove(i: number, nx: number, nz: number): void {
    const w = this.world;
    const mc = this.unitStats(i)?.movementClass ?? 0;
    const grid = this.navGrids[mc];
    if (!grid) return;
    const maxX = terrainWidth(this.setup.terrain);
    const maxZ = terrainDepth(this.setup.terrain);
    const x = w.x[i] ?? 0;
    const z = w.z[i] ?? 0;
    const cx = Math.min(Math.max(nx, 0), maxX);
    const cz = Math.min(Math.max(nz, 0), maxZ);
    const open = (px: number, pz: number): boolean => grid.passable[cellAt(grid, px, pz)] === 1;
    if (open(cx, cz) || this.occupied[cellAt(grid, x, z)] !== 0) {
      w.x[i] = cx;
      w.z[i] = cz;
    } else if (open(cx, z)) {
      w.x[i] = cx;
    } else if (open(x, cz)) {
      w.z[i] = cz;
    }
  }

  // ---------------------------------------------------------------------------------------
  // Construction, reclaim and economy (ADR-0010)

  /**
   * Steps 7–8: builders place sites and put build power into jobs, factories produce,
   * reclaimers strip targets, then each player's income, storage and stall factor are
   * settled. Every job of a player gets the same stall factor, so a shortfall slows all of
   * their construction proportionally.
   */
  private work(): void {
    const w = this.world;
    const units = this.setup.ruleset.units;
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
      const queue = this.orders[i];
      if (!queue || queue.length === 0) continue;
      const order = queue[0];
      if (!order || order.kind === "move") continue;
      const job = this.workJob(i, order, st);
      if (job === "reclaim") reclaimers.push(i);
      else if (job >= 0) addWork(job, st.buildRate);
    }

    // 2. Reclaim: salvage counts as income, so it can pay for this tick's builds.
    for (const r of reclaimers) {
      const order = this.orders[r]?.[0];
      const t = order?.kind === "reclaim" ? w.resolve(order.target) : -1;
      if (t < 0) continue; // already reclaimed by someone earlier this tick
      const rate = units[w.type[r] ?? 0]?.buildRate ?? 0;
      const p = w.owner[r] ?? 0;
      let gained: number;
      if (w.kind[t] === EntityKind.feature) {
        const value = this.setup.ruleset.features[w.type[t] ?? 0]?.salvage ?? 0;
        const take = Math.min(rate * FEATURE_RECLAIM_PER_SEC * dt, (w.progress[t] ?? 0) * value);
        w.progress[t] = value > 0 ? (w.progress[t] ?? 0) - take / value : 0;
        gained = take * (this.reclaimMultiplier[p] ?? 1);
      } else {
        const cost = units[w.type[t] ?? 0]?.cost;
        if (!cost) continue;
        const dp = Math.min((rate * DISMANTLE_SPEED * dt) / cost.buildTime, w.progress[t] ?? 0);
        w.progress[t] = (w.progress[t] ?? 0) - dp;
        gained = dp * cost.salvage;
      }
      income[p * 2] = (income[p * 2] ?? 0) + gained;
      if ((w.progress[t] ?? 0) <= 1e-9) this.remove(t);
    }

    // 3. Demand: what every job would draw this tick at full speed.
    for (const j of jobs) {
      const rate = this.jobRate[j] ?? 0;
      const cost = w.alive[j] === 1 ? this.jobCost(j) : undefined;
      if (!cost) {
        this.jobStep[j] = 0;
        continue;
      }
      const done = (w.progress[j] ?? 0) < 1 ? (w.progress[j] ?? 0) : (this.jobProgress[j] ?? 0);
      const step = Math.max(Math.min((rate * dt) / cost.buildTime, 1 - done), 0);
      this.jobStep[j] = step;
      const p = w.owner[j] ?? 0;
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
      const p = w.owner[j] ?? 0;
      const s = step * (factor[p] ?? 0);
      spent[p * 2] = (spent[p * 2] ?? 0) + s * cost.salvage;
      spent[p * 2 + 1] = (spent[p * 2 + 1] ?? 0) + s * cost.power;
      if ((w.progress[j] ?? 0) < 1) {
        const next = (w.progress[j] ?? 0) + s;
        w.progress[j] = next >= DONE ? 1 : next;
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
    const w = this.world;
    const t = w.resolve(order.target);
    if (order.kind === "build") {
      if (t < 0) {
        // Placed before, and since removed: the order is over.
        if (order.target !== 0) return this.finishOrder(i);
        const site = this.siteOf(order);
        if (
          distanceToFootprint(this.setup.terrain, site, w.x[i] ?? 0, w.z[i] ?? 0) - st.radius >
          st.buildRange
        ) {
          return -1;
        }
        const placed = this.placeOrAdopt(order, site, w.owner[i] ?? 0);
        if (placed < 0) return this.finishOrder(i);
        order.target = w.idAt(placed);
        return placed;
      }
      if ((w.progress[t] ?? 0) >= 1) return this.finishOrder(i);
      return this.gapTo(i, this.focusOf(t)) <= st.buildRange ? t : -1;
    }
    if (t < 0) return this.finishOrder(i);
    if (order.kind === "reclaim") {
      return this.gapTo(i, this.focusOf(t)) <= st.buildRange ? "reclaim" : -1;
    }
    const job = this.jobOf(t);
    if (job < 0) {
      // Nothing to help with. Builders and factories may start again, so keep guarding them.
      return (this.unitStats(t)?.buildRate ?? 0) > 0 ? -1 : this.finishOrder(i);
    }
    return this.gapTo(i, this.focusOf(job)) <= st.buildRange ? job : -1;
  }

  /** The slot whose progress `t`'s build power currently goes into, or -1. */
  private jobOf(t: number): number {
    const w = this.world;
    if (w.kind[t] !== EntityKind.unit) return -1;
    if ((w.progress[t] ?? 0) < 1) return t;
    const st = this.unitStats(t);
    if (!st) return -1;
    if (!st.mobile) return (this.queues[t]?.length ?? 0) > 0 ? t : -1;
    const order = this.orders[t]?.[0];
    if (order?.kind !== "build") return -1;
    const b = w.resolve(order.target);
    return b >= 0 && (w.progress[b] ?? 0) < 1 ? b : -1;
  }

  /** Cost of job `j`: its own construction, or its factory's current unit. */
  private jobCost(j: number): UnitTypeStats["cost"] | undefined {
    const w = this.world;
    const type = (w.progress[j] ?? 0) < 1 ? (w.type[j] ?? 0) : this.queues[j]?.[0];
    return type === undefined ? undefined : this.setup.ruleset.units[type]?.cost;
  }

  /** Drops the current order and starts the next. Returns -1 for {@link workJob}. */
  private finishOrder(i: number): -1 {
    this.orders[i]?.shift();
    return -1;
  }

  /** Places a new site for `order`, or adopts an identical unfinished one already there. */
  private placeOrAdopt(
    order: Extract<Order, { kind: "build" }>,
    site: Footprint,
    owner: number,
  ): number {
    const w = this.world;
    const stats = this.setup.ruleset.units[order.type];
    if (!stats) return -1;
    const problem = placementProblem(
      this.setup.terrain,
      stats,
      site,
      this.deposits,
      (cell) => this.occupied[cell] !== 0,
    );
    if (problem === "occupied") {
      // Several builders given the same order: the first one places, the rest join in.
      const gridCols = this.setup.terrain.cols - 1;
      const other = (this.occupied[site.row * gridCols + site.col] ?? 0) - 1;
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
    const id = w.spawn({
      type: order.type,
      owner,
      x: site.x,
      z: site.z,
      heading: facingHeading(order.facing),
      progress: 0,
    });
    const i = w.resolve(id);
    this.resetSlot(i);
    this.markFootprint(i, true);
    return i;
  }

  /** Spawns the finished unit at the front of factory `f` and sends it on its way. */
  private rollOut(f: number): void {
    const w = this.world;
    const type = this.queues[f]?.[0];
    const st = type === undefined ? undefined : this.setup.ruleset.units[type];
    if (type === undefined || !st) return;
    if (w.liveCount >= w.capacity) return; // stays finished; retried next tick
    const fp = this.footprintOf(f);
    const h = w.heading[f] ?? 0;
    const fx = sin(h);
    const fz = cos(h);
    const cs = this.setup.terrain.cellSize;
    const half = ((Math.abs(fx) > 0.5 ? fp.cols : fp.rows) * cs) / 2;
    const out = half + st.radius + 1;
    let sx = (w.x[f] ?? 0) + fx * out;
    let sz = (w.z[f] ?? 0) + fz * out;
    const grid = this.navGrids[st.movementClass];
    if (grid) {
      const cell = cellAt(grid, sx, sz);
      const open = nearestPassable(grid, cell);
      if (open >= 0 && open !== cell) {
        sx = ((open % grid.cols) + 0.5) * grid.cellSize;
        sz = (Math.floor(open / grid.cols) + 0.5) * grid.cellSize;
      }
    }
    const id = w.spawn({ type, owner: w.owner[f] ?? 0, x: sx, z: sz, heading: h });
    const u = w.resolve(id);
    this.resetSlot(u);
    this.queues[f]?.shift();
    this.jobProgress[f] = 0;
    const rally = this.hasRally[f] === 1;
    const field = this.makeField(
      st.movementClass,
      rally ? (this.rallyX[f] ?? 0) : sx + fx * EXIT_DISTANCE,
      rally ? (this.rallyZ[f] ?? 0) : sz + fz * EXIT_DISTANCE,
    );
    if (field) this.orders[u] = [{ kind: "move", field, groupSize: 1 }];
  }

  /** Removes entity slot `i`, freeing a structure's cells. */
  private remove(i: number): void {
    const w = this.world;
    if (w.kind[i] === EntityKind.unit && this.unitStats(i)?.mobile === false) {
      this.markFootprint(i, false);
    }
    this.resetSlot(i);
    w.despawn(w.idAt(i));
  }

  /** Clears per-slot simulation state when a slot is (re)used or freed. */
  private resetSlot(i: number): void {
    this.orders[i] = [];
    this.clearProduction(i);
    this.hasRally[i] = 0;
    this.rallyX[i] = 0;
    this.rallyZ[i] = 0;
  }

  private clearProduction(i: number): void {
    this.queues[i] = [];
    this.jobProgress[i] = 0;
  }

  /** Marks (or frees) a structure's cells in the occupancy and navigation grids. */
  private markFootprint(i: number, occupy: boolean): void {
    const fp = this.footprintOf(i);
    const gridCols = this.setup.terrain.cols - 1;
    const gridRows = this.setup.terrain.rows - 1;
    for (let r = Math.max(fp.row, 0); r < Math.min(fp.row + fp.rows, gridRows); r++) {
      for (let c = Math.max(fp.col, 0); c < Math.min(fp.col + fp.cols, gridCols); c++) {
        const cell = r * gridCols + c;
        this.occupied[cell] = occupy ? i + 1 : 0;
        this.navGrids.forEach((g, k) => {
          g.passable[cell] = occupy ? 0 : (this.baseNav[k]?.[cell] ?? 0);
        });
      }
    }
    this.navVersion++;
    this.fieldCache.clear();
  }

  // ---------------------------------------------------------------------------------------
  // Geometry helpers

  private unitStats(i: number): UnitTypeStats | undefined {
    if (this.world.kind[i] !== EntityKind.unit) return undefined;
    return this.setup.ruleset.units[this.world.type[i] ?? 0];
  }

  private isMobile(i: number): boolean {
    return this.unitStats(i)?.mobile === true;
  }

  /** The cells structure slot `i` covers. */
  private footprintOf(i: number): Footprint {
    const w = this.world;
    const st = this.unitStats(i);
    return footprintAt(
      this.setup.terrain,
      st ?? { footprint: { x: 1, z: 1 }, placement: "ground" },
      headingFacing(w.heading[i] ?? 0),
      w.x[i] ?? 0,
      w.z[i] ?? 0,
    );
  }

  private siteOf(order: Extract<Order, { kind: "build" }>): Footprint {
    const st = this.setup.ruleset.units[order.type];
    return footprintAt(
      this.setup.terrain,
      st ?? { footprint: { x: 1, z: 1 }, placement: "ground" },
      order.facing,
      order.x,
      order.z,
    );
  }

  /** Where a work order is going: its target, or the site of a build not yet placed. */
  private workFocus(order: WorkOrder): Focus | undefined {
    const t = this.world.resolve(order.target);
    if (order.kind === "build") {
      if (t >= 0) return this.focusOf(t);
      if (order.target !== 0) return undefined;
      const site = this.siteOf(order);
      return { x: site.x, z: site.z, radius: 0, footprint: site };
    }
    if (t < 0) return undefined;
    if (order.kind === "assist") {
      const job = this.jobOf(t);
      return this.focusOf(job >= 0 ? job : t);
    }
    return this.focusOf(t);
  }

  private focusOf(t: number): Focus {
    const w = this.world;
    const x = w.x[t] ?? 0;
    const z = w.z[t] ?? 0;
    if (w.kind[t] === EntityKind.feature) {
      return { x, z, radius: this.setup.ruleset.features[w.type[t] ?? 0]?.radius ?? 0 };
    }
    const st = this.unitStats(t);
    if (st && !st.mobile) return { x, z, radius: 0, footprint: this.footprintOf(t) };
    return { x, z, radius: st?.radius ?? 0 };
  }

  /** Edge-to-edge distance from unit `i` to `focus`. */
  private gapTo(i: number, focus: Focus): number {
    const w = this.world;
    const x = w.x[i] ?? 0;
    const z = w.z[i] ?? 0;
    const ri = this.unitStats(i)?.radius ?? 0;
    if (focus.footprint) {
      return distanceToFootprint(this.setup.terrain, focus.footprint, x, z) - ri;
    }
    const dx = focus.x - x;
    const dz = focus.z - z;
    return Math.sqrt(dx * dx + dz * dz) - ri - focus.radius;
  }
}

/** A work target's position and shape. */
interface Focus {
  x: number;
  z: number;
  radius: number;
  footprint?: Footprint;
}

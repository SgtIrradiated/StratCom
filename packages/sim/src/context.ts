import type { Vec2 } from "./commands";
import { EntityKind, World } from "./ecs/world";
import type { StateHasher } from "./math/hash";
import { Prng } from "./math/prng";
import { NavState } from "./nav";
import { cellAt } from "./navigation";
import { hashOrders, type BuildOrder, type Order } from "./orders";
import { distanceToFootprint, footprintAt, headingFacing, type Footprint } from "./placement";
import { setupCapacity, type MatchSetup, type SimRuleset, type UnitTypeStats } from "./rules";
import { terrainDepth, terrainWidth, type Terrain } from "./terrain";

/**
 * Per-entity-slot state owned by a system. Register it with {@link SimContext.register} so
 * that it is cleared whenever a slot is reused or freed, and included in the state hash.
 * Forgetting either is a classic desync, so both go through this one interface.
 */
export interface SlotState {
  /** Clears the state of slot `i`. */
  reset(i: number): void;
  /** Mixes the state of live slot `i` into `h`. */
  hashSlot(i: number, h: StateHasher): void;
  /** Mixes state that is not per slot (per player, per match) into `h`, after every slot. */
  hashGlobal?(h: StateHasher): void;
}

/** A work target's position and shape. */
export interface Focus {
  x: number;
  z: number;
  radius: number;
  footprint?: Footprint;
}

/**
 * State and helpers shared by the simulation systems: the world, the setup, navigation, the
 * per-unit order queues and the slot lifecycle. Systems live in `systems/` and receive the
 * context; they keep their own state and register it here.
 */
export class SimContext implements SlotState {
  readonly world: World;
  readonly prng: Prng;
  readonly rules: SimRuleset;
  readonly terrain: Terrain;
  readonly nav: NavState;
  readonly deposits: readonly Vec2[];
  /** Map extent in metres. */
  readonly width: number;
  readonly depth: number;
  /** Order queue per entity slot. */
  readonly orders: Order[][];
  /** Ticks simulated so far. */
  tick = 0;
  private readonly slotStates: SlotState[] = [];

  constructor(readonly setup: MatchSetup) {
    const capacity = setupCapacity(setup);
    this.world = new World(capacity);
    this.prng = new Prng(setup.seed);
    this.rules = setup.ruleset;
    this.terrain = setup.terrain;
    this.nav = new NavState(setup.terrain, setup.ruleset.movementClasses);
    this.deposits = setup.deposits ?? [];
    this.width = terrainWidth(setup.terrain);
    this.depth = terrainDepth(setup.terrain);
    this.orders = Array.from({ length: capacity }, () => []);
    this.register(this);
  }

  /** Entity capacity of the world. */
  get capacity(): number {
    return this.world.capacity;
  }

  /** Adds per-slot state to the lifecycle. Hashing follows registration order. */
  register(state: SlotState): void {
    this.slotStates.push(state);
  }

  /** Mixes every registered state into `h`: each live slot in order, then the global parts. */
  hashInto(h: StateHasher): void {
    const w = this.world;
    for (let i = 0; i < w.highWater; i++) {
      if (w.alive[i] === 0) continue;
      for (const s of this.slotStates) s.hashSlot(i, h);
    }
    for (const s of this.slotStates) s.hashGlobal?.(h);
  }

  /** Clears every system's state for slot `i`, when the slot is (re)used or freed. */
  resetSlot(i: number): void {
    for (const s of this.slotStates) s.reset(i);
  }

  /** Removes entity slot `i`, freeing a structure's cells. */
  remove(i: number): void {
    const w = this.world;
    if (w.kind[i] === EntityKind.unit && this.unitStats(i)?.mobile === false) {
      this.markFootprint(i, false);
    }
    this.resetSlot(i);
    w.despawn(w.idAt(i));
  }

  /** Marks (or frees) structure slot `i`'s cells in the occupancy and navigation grids. */
  markFootprint(i: number, occupy: boolean): void {
    this.nav.markFootprint(this.footprintOf(i), i, occupy);
  }

  // SlotState: the order queues.
  reset(i: number): void {
    this.orders[i] = [];
  }

  hashSlot(i: number, h: StateHasher): void {
    hashOrders(h, this.orders[i] ?? []);
  }

  // ---------------------------------------------------------------------------------------
  // Orders

  /** Replaces unit `i`'s queue with `order` (or nothing), or appends it when `queue`. */
  giveOrder(i: number, order: Order | undefined, queue: boolean): void {
    if (!queue) this.orders[i] = order ? [order] : [];
    else if (order) this.orders[i]?.push(order);
  }

  /** Drops the current order and starts the next. Returns -1 for work-job lookups. */
  finishOrder(i: number): -1 {
    this.orders[i]?.shift();
    return -1;
  }

  /** True if player `slot` is in the match. */
  hasPlayer(slot: number): boolean {
    return this.setup.players.some((p) => p.slot === slot);
  }

  /** Live, complete units of `slot` among `ids` that pass `filter`, in ascending slot order. */
  owned(slot: number, ids: readonly number[], filter: (i: number) => boolean): number[] {
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

  /** A command's point clamped to the map, or undefined if it is not a finite point. */
  clampToMap(p: unknown): Vec2 | undefined {
    if (typeof p !== "object" || p === null) return undefined;
    const { x, z } = p as { x?: unknown; z?: unknown };
    if (typeof x !== "number" || typeof z !== "number") return undefined;
    if (!Number.isFinite(x) || !Number.isFinite(z)) return undefined;
    return {
      x: Math.min(Math.max(x, 0), this.width),
      z: Math.min(Math.max(z, 0), this.depth),
    };
  }

  // ---------------------------------------------------------------------------------------
  // Movement

  /**
   * Moves a unit to (`nx`, `nz`) if that is on the map and passable, otherwise tries to slide
   * along one axis, otherwise stays put. A unit standing inside a structure's footprint may
   * move freely so it can get out.
   */
  tryMove(i: number, nx: number, nz: number): void {
    const w = this.world;
    const mc = this.unitStats(i)?.movementClass ?? 0;
    const grid = this.nav.grids[mc];
    if (!grid) return;
    const x = w.x[i] ?? 0;
    const z = w.z[i] ?? 0;
    const cx = Math.min(Math.max(nx, 0), this.width);
    const cz = Math.min(Math.max(nz, 0), this.depth);
    const open = (px: number, pz: number): boolean => grid.passable[cellAt(grid, px, pz)] === 1;
    if (open(cx, cz) || this.nav.occupied[cellAt(grid, x, z)] !== 0) {
      w.x[i] = cx;
      w.z[i] = cz;
    } else if (open(cx, z)) {
      w.x[i] = cx;
    } else if (open(x, cz)) {
      w.z[i] = cz;
    }
  }

  // ---------------------------------------------------------------------------------------
  // Geometry

  /** Stats of the unit in slot `i`, or undefined for features. */
  unitStats(i: number): UnitTypeStats | undefined {
    if (this.world.kind[i] !== EntityKind.unit) return undefined;
    return this.rules.units[this.world.type[i] ?? 0];
  }

  /** True for a mobile unit (not a structure or feature). */
  isMobile(i: number): boolean {
    return this.unitStats(i)?.mobile === true;
  }

  /** The cells structure slot `i` covers. */
  footprintOf(i: number): Footprint {
    const w = this.world;
    const st = this.unitStats(i);
    return footprintAt(
      this.terrain,
      st ?? { footprint: { x: 1, z: 1 }, placement: "ground" },
      headingFacing(w.heading[i] ?? 0),
      w.x[i] ?? 0,
      w.z[i] ?? 0,
    );
  }

  /** The cells a build order's structure will cover. */
  siteOf(order: BuildOrder): Footprint {
    const st = this.rules.units[order.type];
    return footprintAt(
      this.terrain,
      st ?? { footprint: { x: 1, z: 1 }, placement: "ground" },
      order.facing,
      order.x,
      order.z,
    );
  }

  /** Position and shape of entity slot `t`, as a work or weapon target. */
  focusOf(t: number): Focus {
    const w = this.world;
    const x = w.x[t] ?? 0;
    const z = w.z[t] ?? 0;
    if (w.kind[t] === EntityKind.feature) {
      return { x, z, radius: this.rules.features[w.type[t] ?? 0]?.radius ?? 0 };
    }
    const st = this.unitStats(t);
    if (st && !st.mobile) return { x, z, radius: 0, footprint: this.footprintOf(t) };
    return { x, z, radius: st?.radius ?? 0 };
  }

  /** Edge-to-edge distance from unit `i` to `focus`. */
  gapTo(i: number, focus: Focus): number {
    const w = this.world;
    const x = w.x[i] ?? 0;
    const z = w.z[i] ?? 0;
    const ri = this.unitStats(i)?.radius ?? 0;
    if (focus.footprint) {
      return distanceToFootprint(this.terrain, focus.footprint, x, z) - ri;
    }
    const dx = focus.x - x;
    const dz = focus.z - z;
    return Math.sqrt(dx * dx + dz * dz) - ri - focus.radius;
  }
}

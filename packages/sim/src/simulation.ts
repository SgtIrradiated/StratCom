import { assert } from "@stratcom/shared";
import { World } from "./ecs/world";
import type { PlayerCommand } from "./commands";
import { Prng } from "./math/prng";
import { StateHasher } from "./math/hash";
import { atan2, wrapAngle } from "./math/trig";
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

/** Movement characteristics of one unit type (M1/M2 placeholder; replaced by `UnitDef` in M3). */
export interface UnitTypeStats {
  /** Index into `MatchSetup.movementClasses`. */
  movementClass: number;
  /** Collision radius in metres, used for separation. */
  radius: number;
  /** Top speed in metres per second. */
  speed: number;
  /** Maximum turn rate in radians per second. */
  turnRate: number;
}

/** One player slot. Slots and teams are N-wide; nothing assumes two players. */
export interface PlayerSetup {
  slot: number;
  team: number;
  factionId: string;
  /** CSS hex colour, e.g. "#c0392b". */
  color: string;
}

/** A unit present at tick 0. */
export interface InitialUnit {
  slot: number;
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
  movementClasses: readonly MovementClassDef[];
  unitTypes: readonly UnitTypeStats[];
  initialUnits: readonly InitialUnit[];
  /** Entity capacity; defaults to the initial unit count plus 4096. */
  capacity?: number;
}

/** Spatial-hash bucket size; must be at least the largest pair radius sum. */
const SEPARATION_CELL = 16;
/** Fraction of an overlap resolved per tick. */
const SEPARATION_STIFFNESS = 0.5;
/** Beyond this many cells a unit follows the flow field instead of testing line of sight. */
const LINE_OF_SIGHT_CELLS = 40;

/**
 * The deterministic game simulation. A pure function of `(MatchSetup, command stream)`
 * (ADR-0002): feed two instances the same setup and the same commands per tick and their
 * {@link stateHash} values are always equal.
 */
export class Simulation {
  private readonly world: World;
  private readonly prng: Prng;
  private currentTick = 0;
  private readonly navGrids: readonly NavGrid[];
  private readonly spatial: SpatialGrid;
  /** Active move order per slot; shared between all units given the same command. */
  private readonly fields: (FlowField | undefined)[];
  private readonly bucketScratch: Int32Array;
  private readonly sepX: Float64Array;
  private readonly sepZ: Float64Array;

  constructor(private readonly setup: MatchSetup) {
    const capacity = setup.capacity ?? setup.initialUnits.length + 4096;
    this.world = new World(capacity);
    this.prng = new Prng(setup.seed);
    this.navGrids = setup.movementClasses.map((m) => buildNavGrid(setup.terrain, m.maxSlope));
    this.spatial = new SpatialGrid(
      terrainWidth(setup.terrain),
      terrainDepth(setup.terrain),
      SEPARATION_CELL,
    );
    this.fields = new Array<FlowField | undefined>(capacity).fill(undefined);
    this.bucketScratch = new Int32Array(capacity);
    this.sepX = new Float64Array(capacity);
    this.sepZ = new Float64Array(capacity);
    const slots = new Set(setup.players.map((p) => p.slot));
    assert(slots.size === setup.players.length, "duplicate player slots");
    for (const u of setup.initialUnits) {
      assert(slots.has(u.slot), `initial unit for unknown slot ${u.slot}`);
      assert(setup.unitTypes[u.type] !== undefined, `unknown unit type ${u.type}`);
      this.world.spawn({ type: u.type, owner: u.slot, x: u.x, z: u.z, heading: u.heading ?? 0 });
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

  /** True if the unit in slot `i` currently has a move order. */
  hasOrder(i: number): boolean {
    return this.fields[i] !== undefined;
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
    this.currentTick++;
  }

  /** 32-bit hash of the full simulation state. */
  stateHash(): number {
    const h = new StateHasher(this.currentTick);
    this.world.hashInto(h);
    for (let i = 0; i < this.world.highWater; i++) {
      if (this.world.alive[i] === 0) continue;
      const f = this.fields[i];
      h.u32(f ? f.goalCell + 1 : 0).u32(f ? f.groupSize : 0);
    }
    for (const word of this.prng.getState()) h.u32(word);
    return h.digest();
  }

  /** Copies the render state into `out`. `out` must have capacity for every live entity. */
  writeSnapshot(out: SnapshotBuffers): void {
    const w = this.world;
    assert(out.ids.length >= w.liveCount, "snapshot buffers too small");
    let n = 0;
    for (let i = 0; i < w.highWater; i++) {
      if (w.alive[i] === 0) continue;
      out.ids[n] = w.idAt(i);
      out.types[n] = w.type[i] ?? 0;
      out.owners[n] = w.owner[i] ?? 0;
      out.prevX[n] = w.prevX[i] ?? 0;
      out.prevZ[n] = w.prevZ[i] ?? 0;
      out.x[n] = w.x[i] ?? 0;
      out.z[n] = w.z[i] ?? 0;
      out.heading[n] = w.heading[i] ?? 0;
      n++;
    }
    out.count = n;
    out.tick = this.currentTick;
  }

  /** Step 1 of docs/PLAN.md §4.4: validate and apply this tick's commands. */
  private ingestCommands(commands: readonly PlayerCommand[]): void {
    const w = this.world;
    const width = terrainWidth(this.setup.terrain);
    const depth = terrainDepth(this.setup.terrain);
    for (const cmd of commands) {
      if (!this.setup.players.some((p) => p.slot === cmd.slot)) continue;
      if (cmd.t === "move") {
        const { x, z } = cmd.to;
        if (!Number.isFinite(x) || !Number.isFinite(z)) continue;
        const tx = Math.min(Math.max(x, 0), width);
        const tz = Math.min(Math.max(z, 0), depth);
        const owned = new Set<number>();
        for (const id of cmd.units) {
          const i = w.resolve(id);
          if (i >= 0 && w.owner[i] === cmd.slot) owned.add(i);
        }
        // One flow field per movement class, shared by every unit of that class.
        const slots = [...owned].sort((a, b) => a - b);
        const perClass = new Map<number, FlowField | undefined>();
        for (const i of slots) {
          const mc = this.setup.unitTypes[w.type[i] ?? 0]?.movementClass ?? 0;
          if (!perClass.has(mc)) perClass.set(mc, this.makeField(mc, tx, tz, slots.length));
          this.fields[i] = perClass.get(mc);
        }
      } else {
        for (const id of cmd.units) {
          const i = w.resolve(id);
          if (i >= 0 && w.owner[i] === cmd.slot) this.fields[i] = undefined;
        }
      }
    }
  }

  private makeField(
    movementClass: number,
    x: number,
    z: number,
    groupSize: number,
  ): FlowField | undefined {
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
      groupSize,
      cost: computeFlowCosts(grid, goalCell),
    };
  }

  /** Steps 2–4: follow flow fields. Units stop in a disc whose size grows with the group. */
  private movement(): void {
    const w = this.world;
    const types = this.setup.unitTypes;
    const dt = 1 / TICK_RATE;
    for (let i = 0; i < w.highWater; i++) {
      if (w.alive[i] === 0) continue;
      w.prevX[i] = w.x[i] ?? 0;
      w.prevZ[i] = w.z[i] ?? 0;
      const field = this.fields[i];
      if (!field) continue;
      const stats = types[w.type[i] ?? 0];
      const grid = this.navGrids[field.movementClass];
      if (!stats || !grid) continue;

      const x = w.x[i] ?? 0;
      const z = w.z[i] ?? 0;
      const gx = field.goalX - x;
      const gz = field.goalZ - z;
      const goalDist = Math.sqrt(gx * gx + gz * gz);
      const stopRadius = stats.radius * (1 + 1.2 * Math.sqrt(field.groupSize));
      if (goalDist <= Math.max(stopRadius, 0.05)) {
        this.fields[i] = undefined;
        continue;
      }

      let dx: number;
      let dz: number;
      if (
        goalDist < LINE_OF_SIGHT_CELLS * grid.cellSize &&
        hasLineOfSight(grid, x, z, field.goalX, field.goalZ)
      ) {
        dx = gx;
        dz = gz;
      } else {
        const dir = flowDirection(grid, field, x, z);
        if (!dir) {
          this.fields[i] = undefined;
          continue;
        }
        dx = dir.dx;
        dz = dir.dz;
      }
      const len = Math.sqrt(dx * dx + dz * dz);
      if (len === 0) continue;

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
    }
  }

  /** Step 4 (cont.): push overlapping units apart using the spatial hash. */
  private separation(): void {
    const w = this.world;
    const types = this.setup.unitTypes;
    this.spatial.rebuild(w.highWater, w.alive, w.x, w.z, this.bucketScratch);
    for (let i = 0; i < w.highWater; i++) {
      this.sepX[i] = 0;
      this.sepZ[i] = 0;
      if (w.alive[i] === 0) continue;
      const ri = types[w.type[i] ?? 0]?.radius ?? 1;
      const xi = w.x[i] ?? 0;
      const zi = w.z[i] ?? 0;
      let px = 0;
      let pz = 0;
      this.spatial.forNeighbours(xi, zi, (j) => {
        if (j === i) return;
        const reach = ri + (types[w.type[j] ?? 0]?.radius ?? 1);
        const dx = xi - (w.x[j] ?? 0);
        const dz = zi - (w.z[j] ?? 0);
        const d2 = dx * dx + dz * dz;
        if (d2 >= reach * reach) return;
        if (d2 === 0) {
          // Exactly stacked: split along x, with opposite signs for the pair.
          px += (i < j ? 1 : -1) * reach * 0.5;
          return;
        }
        const d = Math.sqrt(d2);
        const push = ((reach - d) * 0.5) / d;
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
   * along one axis, otherwise stays put.
   */
  private tryMove(i: number, nx: number, nz: number): void {
    const w = this.world;
    const mc = this.setup.unitTypes[w.type[i] ?? 0]?.movementClass ?? 0;
    const grid = this.navGrids[mc];
    if (!grid) return;
    const maxX = terrainWidth(this.setup.terrain);
    const maxZ = terrainDepth(this.setup.terrain);
    const x = w.x[i] ?? 0;
    const z = w.z[i] ?? 0;
    const cx = Math.min(Math.max(nx, 0), maxX);
    const cz = Math.min(Math.max(nz, 0), maxZ);
    const open = (px: number, pz: number): boolean => grid.passable[cellAt(grid, px, pz)] === 1;
    if (open(cx, cz)) {
      w.x[i] = cx;
      w.z[i] = cz;
    } else if (open(cx, z)) {
      w.x[i] = cx;
    } else if (open(x, cz)) {
      w.z[i] = cz;
    }
  }
}

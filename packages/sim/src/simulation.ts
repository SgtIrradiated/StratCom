import { assert } from "@stratcom/shared";
import { World } from "./ecs/world";
import type { PlayerCommand } from "./commands";
import { Prng } from "./math/prng";
import { StateHasher } from "./math/hash";
import { atan2, wrapAngle } from "./math/trig";
import type { SnapshotBuffers } from "./snapshot";

/** Fixed simulation rate in ticks per second (ADR-0007). */
export const TICK_RATE = 20;

/** Duration of one simulation tick in milliseconds. */
export const TICK_MS = 1000 / TICK_RATE;

/** Movement characteristics of one unit type (M1 placeholder; replaced by `UnitDef` in M3). */
export interface UnitTypeStats {
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
  /** Map extent in metres: x in [0, width), z in [0, height). */
  map: { width: number; height: number };
  players: readonly PlayerSetup[];
  unitTypes: readonly UnitTypeStats[];
  initialUnits: readonly InitialUnit[];
  /** Entity capacity; defaults to the initial unit count plus 4096. */
  capacity?: number;
}

/** Distance at which a unit counts as having reached its target, in metres. */
const ARRIVE_EPSILON = 0.05;

/**
 * The deterministic game simulation. A pure function of `(MatchSetup, command stream)`
 * (ADR-0002): feed two instances the same setup and the same commands per tick and their
 * {@link stateHash} values are always equal.
 */
export class Simulation {
  private readonly world: World;
  private readonly prng: Prng;
  private currentTick = 0;

  constructor(private readonly setup: MatchSetup) {
    this.world = new World(setup.capacity ?? setup.initialUnits.length + 4096);
    this.prng = new Prng(setup.seed);
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

  /** Read access to the world for tests and tools. Do not mutate it from outside. */
  get state(): World {
    return this.world;
  }

  /** Advances exactly one tick, applying `commands` first, in the order given. */
  step(commands: readonly PlayerCommand[]): void {
    this.ingestCommands(commands);
    this.movement();
    this.currentTick++;
  }

  /** 32-bit hash of the full simulation state. */
  stateHash(): number {
    const h = new StateHasher(this.currentTick);
    this.world.hashInto(h);
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
    const { width, height } = this.setup.map;
    for (const cmd of commands) {
      if (!this.setup.players.some((p) => p.slot === cmd.slot)) continue;
      if (cmd.t === "move") {
        const { x, z } = cmd.to;
        if (!Number.isFinite(x) || !Number.isFinite(z)) continue;
        const tx = Math.min(Math.max(x, 0), width);
        const tz = Math.min(Math.max(z, 0), height);
        for (const id of cmd.units) {
          const i = w.resolve(id);
          if (i < 0 || w.owner[i] !== cmd.slot) continue;
          w.targetX[i] = tx;
          w.targetZ[i] = tz;
          w.hasTarget[i] = 1;
        }
      } else {
        for (const id of cmd.units) {
          const i = w.resolve(id);
          if (i >= 0 && w.owner[i] === cmd.slot) w.hasTarget[i] = 0;
        }
      }
    }
  }

  /** Step 4: steer toward targets. Separation and terrain arrive in M2. */
  private movement(): void {
    const w = this.world;
    const types = this.setup.unitTypes;
    const dt = 1 / TICK_RATE;
    for (let i = 0; i < w.highWater; i++) {
      if (w.alive[i] === 0) continue;
      w.prevX[i] = w.x[i] ?? 0;
      w.prevZ[i] = w.z[i] ?? 0;
      if (w.hasTarget[i] === 0) continue;
      const stats = types[w.type[i] ?? 0];
      if (!stats) continue;

      const dx = (w.targetX[i] ?? 0) - (w.x[i] ?? 0);
      const dz = (w.targetZ[i] ?? 0) - (w.z[i] ?? 0);
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist <= ARRIVE_EPSILON) {
        w.hasTarget[i] = 0;
        continue;
      }

      // Turn toward the target, limited by the turn rate; move along the new heading.
      // Heading 0 faces +z, so the angle of (dx, dz) is atan2(dx, dz).
      const desired = atan2(dx, dz);
      const diff = wrapAngle(desired - (w.heading[i] ?? 0));
      const maxTurn = stats.turnRate * dt;
      const turn = diff > maxTurn ? maxTurn : diff < -maxTurn ? -maxTurn : diff;
      w.heading[i] = wrapAngle((w.heading[i] ?? 0) + turn);

      const step = Math.min(stats.speed * dt, dist);
      // Move straight at the target when facing it; otherwise creep forward at reduced
      // speed so units don't orbit a target they can't turn fast enough to hit.
      const facing = turn === diff ? 1 : 0.35;
      const f = (step * facing) / dist;
      w.x[i] = (w.x[i] ?? 0) + dx * f;
      w.z[i] = (w.z[i] ?? 0) + dz * f;
      if (dist - step * facing <= ARRIVE_EPSILON) w.hasTarget[i] = 0;
    }
  }
}

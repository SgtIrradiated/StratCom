import type { Focus, SimContext } from "../context";
import { atan2, wrapAngle } from "../math/trig";
import { cellAt, flowDirection, hasLineOfSight, type FlowField, type NavGrid } from "../navigation";
import type { Order, WorkOrder } from "../orders";
import { TICK_RATE, type UnitTypeStats } from "../rules";

/** Beyond this many cells a unit follows the flow field instead of testing line of sight. */
const LINE_OF_SIGHT_CELLS = 40;

/**
 * Order following (docs/PLAN.md §4.4 steps 2–4). Move orders follow the flow field shared by
 * their command's group and stop in a disc whose size grows with the group; work orders walk
 * into reach of their target through a small cache of shared fields.
 */
export class MovementSystem {
  /**
   * @param workFocus Where a work order is heading (owned by the work system, because an
   *   assist follows whatever its target is building).
   */
  constructor(
    private readonly ctx: SimContext,
    private readonly workFocus: (order: WorkOrder) => Focus | undefined,
  ) {}

  /** Records each entity's start-of-tick position, then advances every unit's current order. */
  run(): void {
    const ctx = this.ctx;
    const w = ctx.world;
    for (let i = 0; i < w.highWater; i++) {
      if (w.alive[i] === 0) continue;
      w.prevX[i] = w.x[i] ?? 0;
      w.prevZ[i] = w.z[i] ?? 0;
      // Check the length first: reading past the end of an array is slow in V8.
      const queue = ctx.orders[i];
      if (!queue || queue.length === 0) continue;
      const order = queue[0];
      if (!order) continue;
      const stats = ctx.unitStats(i);
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
    const ctx = this.ctx;
    const w = ctx.world;
    const field = order.field;
    ctx.nav.refreshField(field);
    const grid = ctx.nav.grids[field.movementClass];
    if (!grid) return;
    const gx = field.goalX - (w.x[i] ?? 0);
    const gz = field.goalZ - (w.z[i] ?? 0);
    const goalDist = Math.sqrt(gx * gx + gz * gz);
    const stopRadius = stats.radius * (1 + 1.2 * Math.sqrt(order.groupSize));
    if (goalDist <= Math.max(stopRadius, 0.05)) {
      ctx.finishOrder(i);
      return;
    }
    if (!this.steer(i, stats, grid, field, goalDist)) ctx.finishOrder(i);
  }

  /** Walks a builder toward its work order's target until it is within build range. */
  private approach(i: number, order: WorkOrder, stats: UnitTypeStats): void {
    const ctx = this.ctx;
    const w = ctx.world;
    const focus = this.workFocus(order);
    if (!focus) return; // the work step drops the order
    if (ctx.gapTo(i, focus) <= stats.buildRange) return;
    const grid = ctx.nav.grids[stats.movementClass];
    if (!grid) return;
    const cell = cellAt(grid, focus.x, focus.z);
    if (!order.field || order.fieldCell !== cell) {
      order.field = ctx.nav.workField(stats.movementClass, cell);
      order.fieldCell = cell;
    }
    const field = order.field;
    if (!field) {
      ctx.finishOrder(i);
      return;
    }
    ctx.nav.refreshField(field);
    const gx = field.goalX - (w.x[i] ?? 0);
    const gz = field.goalZ - (w.z[i] ?? 0);
    const goalDist = Math.sqrt(gx * gx + gz * gz);
    // At the closest open cell and still out of reach: the target cannot be reached.
    if (goalDist <= 0.5 || !this.steer(i, stats, grid, field, goalDist)) ctx.finishOrder(i);
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
    const ctx = this.ctx;
    const w = ctx.world;
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
      const dir = flowDirection(grid, field, x, z) ?? ctx.nav.escapeDirection(grid, x, z);
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
    ctx.tryMove(i, x + (dx / len) * step, z + (dz / len) * step);
    return true;
  }
}

import type { Facing } from "./commands";
import type { StateHasher } from "./math/hash";
import type { FlowField } from "./navigation";

/** A queued order. Work orders (build, reclaim, assist) hold entity ids, never slots. */
export type Order =
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

/** An order that walks a builder into range of something and works on it. */
export type WorkOrder = Exclude<Order, { kind: "move" }>;

/** A build order. */
export type BuildOrder = Extract<Order, { kind: "build" }>;

/** Mixes one unit's order queue into `h`. Cached flow fields are derived and not hashed. */
export function hashOrders(h: StateHasher, orders: readonly Order[]): void {
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
}

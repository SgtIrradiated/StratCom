import type { Facing } from "./commands";
import type { StateHasher } from "./math/hash";
import type { FlowField } from "./navigation";

/**
 * A queued order. Orders that name a target (build, reclaim, assist, attack) hold entity
 * ids, never slots, so a target that dies or whose slot is reused simply stops resolving.
 */
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
    }
  | {
      kind: "attack";
      target: number;
      field?: FlowField | undefined;
      fieldCell?: number;
    };

/** An order that walks a unit into reach of a target: every order but move. */
export type TargetOrder = Exclude<Order, { kind: "move" }>;

/** An order that walks a builder into range of something and works on it. */
export type WorkOrder = Exclude<TargetOrder, { kind: "attack" }>;

/** An attack order: chase the target until it is in weapon range, then hold. */
export type AttackOrder = Extract<TargetOrder, { kind: "attack" }>;

/** A build order. */
export type BuildOrder = Extract<Order, { kind: "build" }>;

const TARGET_ORDER_CODE = { reclaim: 3, assist: 4, attack: 5 } as const;

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
    } else h.u32(TARGET_ORDER_CODE[o.kind]).u32(o.target);
  }
}

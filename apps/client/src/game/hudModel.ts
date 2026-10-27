import type { CompiledRuleset } from "@stratcom/data";
import { EntityKind, TICK_RATE, type SnapshotBuffers } from "@stratcom/sim";
import { selectionRoles } from "../input/orders";

/** One line of the selection panel: a unit type and how many of it are selected. */
export interface SelectionGroup {
  type: number;
  count: number;
}

/**
 * Groups the selected units by type, in ruleset order, skipping ids that are no longer in
 * the snapshot (dead or stale).
 */
export function summarizeSelection(
  snapshot: SnapshotBuffers,
  selected: ReadonlySet<number>,
): SelectionGroup[] {
  const counts = new Map<number, number>();
  if (selected.size > 0) {
    for (let i = 0; i < snapshot.count; i++) {
      if (!selected.has(snapshot.ids[i] ?? 0) || snapshot.kinds[i] !== EntityKind.unit) continue;
      const t = snapshot.types[i] ?? 0;
      counts.set(t, (counts.get(t) ?? 0) + 1);
    }
  }
  return [...counts].map(([type, count]) => ({ type, count })).sort((a, b) => a.type - b.type);
}

/** One button of the build panel. */
export interface BuildOption {
  type: number;
  /** `place`: builders construct it on the map. `produce`: factories queue it. */
  mode: "place" | "produce";
  /** Units of this type queued across the selected factories. */
  queued: number;
}

/**
 * The build panel for the current selection: structures the selected builders can place,
 * then units the selected factories can produce, each listed once in the order the first
 * selected unit lists them. Unfinished units contribute nothing.
 */
export function buildMenu(
  ruleset: CompiledRuleset,
  snapshot: SnapshotBuffers,
  selected: ReadonlySet<number>,
  localSlot: number,
): BuildOption[] {
  const roles = selectionRoles({ ruleset, localSlot, snapshot, selected });
  const typeOf = new Map<number, number>();
  for (let i = 0; i < snapshot.count; i++) typeOf.set(snapshot.ids[i] ?? 0, snapshot.types[i] ?? 0);
  const options: BuildOption[] = [];
  const seen = new Set<number>();
  const collect = (ids: readonly number[], mode: BuildOption["mode"]): void => {
    for (const id of ids) {
      for (const b of ruleset.units[typeOf.get(id) ?? -1]?.builds ?? []) {
        if (seen.has(b)) continue;
        seen.add(b);
        options.push({ type: b, mode, queued: 0 });
      }
    }
  };
  collect(roles.builders, "place");
  collect(roles.factories, "produce");
  const factories = new Set(roles.factories);
  for (const p of snapshot.production) {
    if (!factories.has(p.id)) continue;
    for (const t of p.queue) {
      const option = options.find((o) => o.type === t && o.mode === "produce");
      if (option) option.queued++;
    }
  }
  return options;
}

/** A resource amount for the HUD: whole units with thousands separators. */
export function formatAmount(n: number): string {
  return Math.floor(n).toLocaleString("en");
}

/** A per-second rate for the HUD with an explicit sign, e.g. `+3.5` or `-12`. */
export function formatRate(n: number): string {
  const rounded = Math.abs(n) >= 100 ? Math.round(n) : Math.round(n * 10) / 10;
  return `${rounded >= 0 ? "+" : "-"}${Math.abs(rounded).toLocaleString("en")}`;
}

/** A per-second spending figure, always shown as an outflow: `-18`, or `-0` when idle. */
export function formatSpending(n: number): string {
  return `-${formatRate(Math.abs(n)).slice(1)}`;
}

/** Match clock for a tick count: `mm:ss`, or `h:mm:ss` from one hour. */
export function formatClock(ticks: number): string {
  const total = Math.floor(ticks / TICK_RATE);
  const s = total % 60;
  const m = Math.floor(total / 60) % 60;
  const h = Math.floor(total / 3600);
  const pad = (n: number): string => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

/** Snapshot index of the first unit of `type` owned by `owner`, or -1 if there is none. */
export function findUnit(snapshot: SnapshotBuffers, owner: number, type: number): number {
  for (let i = 0; i < snapshot.count; i++) {
    if (snapshot.kinds[i] !== EntityKind.unit) continue;
    if (snapshot.owners[i] === owner && snapshot.types[i] === type) return i;
  }
  return -1;
}

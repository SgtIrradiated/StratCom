import type { CompiledRuleset } from "@stratcom/data";
import { TICK_RATE, type SnapshotBuffers } from "@stratcom/sim";

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
      if (!selected.has(snapshot.ids[i] ?? 0)) continue;
      const t = snapshot.types[i] ?? 0;
      counts.set(t, (counts.get(t) ?? 0) + 1);
    }
  }
  return [...counts].map(([type, count]) => ({ type, count })).sort((a, b) => a.type - b.type);
}

/**
 * Everything the selected types can build, deduplicated, in the order the first builder
 * lists them.
 */
export function buildOptions(
  ruleset: CompiledRuleset,
  groups: readonly SelectionGroup[],
): number[] {
  const seen = new Set<number>();
  for (const g of groups) for (const b of ruleset.units[g.type]?.builds ?? []) seen.add(b);
  return [...seen];
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
    if (snapshot.owners[i] === owner && snapshot.types[i] === type) return i;
  }
  return -1;
}

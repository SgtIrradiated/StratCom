/** A screen-space rectangle in CSS pixels. */
export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * Indices of units whose projected position lies inside `rect` (corners in any order).
 * `screen` holds x, y pairs; NaN entries (behind the camera) never match.
 */
export function unitsInRect(screen: Float32Array, count: number, rect: Rect): number[] {
  const minX = Math.min(rect.x0, rect.x1);
  const maxX = Math.max(rect.x0, rect.x1);
  const minY = Math.min(rect.y0, rect.y1);
  const maxY = Math.max(rect.y0, rect.y1);
  const hits: number[] = [];
  for (let i = 0; i < count; i++) {
    const x = screen[i * 2] ?? NaN;
    const y = screen[i * 2 + 1] ?? NaN;
    if (x >= minX && x <= maxX && y >= minY && y <= maxY) hits.push(i);
  }
  return hits;
}

/**
 * Index of the unit nearest (`x`, `y`) within `maxDistance` pixels, or -1. Ties go to the
 * lower index, so the result is stable.
 */
export function nearestUnit(
  screen: Float32Array,
  count: number,
  x: number,
  y: number,
  maxDistance: number,
): number {
  let best = -1;
  const limit = maxDistance * maxDistance;
  let bestD = Infinity;
  for (let i = 0; i < count; i++) {
    const dx = (screen[i * 2] ?? NaN) - x;
    const dy = (screen[i * 2 + 1] ?? NaN) - y;
    const d = dx * dx + dy * dy;
    if (d <= limit && d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

/** The player's current selection plus numbered control groups (1–9). Pure state. */
export class Selection {
  /** Selected entity ids. Treat as read-only; mutate through the methods. */
  readonly ids = new Set<number>();
  private readonly groups = new Map<number, number[]>();

  /** Replaces the selection. */
  set(ids: Iterable<number>): void {
    this.ids.clear();
    for (const id of ids) this.ids.add(id);
  }

  /** Adds to the selection. */
  add(ids: Iterable<number>): void {
    for (const id of ids) this.ids.add(id);
  }

  /** Clears the selection. */
  clear(): void {
    this.ids.clear();
  }

  /** Stores the current selection as control group `n`. An empty selection clears it. */
  assignGroup(n: number): void {
    if (this.ids.size === 0) this.groups.delete(n);
    else this.groups.set(n, [...this.ids]);
  }

  /**
   * Selects control group `n`, dropping ids rejected by `isAlive`. Returns the surviving ids
   * (empty if the group is unset).
   */
  recallGroup(n: number, isAlive: (id: number) => boolean): number[] {
    const live = (this.groups.get(n) ?? []).filter(isAlive);
    if (live.length > 0) this.groups.set(n, live);
    else this.groups.delete(n);
    this.set(live);
    return live;
  }
}

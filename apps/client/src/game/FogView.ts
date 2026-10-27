import {
  EntityKind,
  Fog,
  NO_TEAM,
  VISION_CELL,
  createSnapshotBuffers,
  type SimEvent,
  type SimRuleset,
  type SnapshotBuffers,
} from "@stratcom/sim";
import type { ViewSnapshot } from "../render/types";

/** An enemy structure as last seen. */
interface Remembered {
  type: number;
  owner: number;
  x: number;
  z: number;
  heading: number;
  progress: number;
  health: number;
}

/**
 * What one team is allowed to see of a snapshot (fog of war). The simulation knows
 * everything; this filters it for drawing and picking:
 *
 * - own and allied units always show; enemy units only while the team sees them;
 * - enemy structures, once seen, stay as dimmed "last known" ghosts until the team sees
 *   their spot again without them;
 * - features (debris, wrecks) show on explored ground; projectiles and shots only where seen.
 *
 * With no view team (spectating, benchmarks) everything shows.
 */
export class FogView {
  /** The filtered snapshot, rewritten by every {@link update}. */
  readonly view: ViewSnapshot & { remembered: Uint8Array };
  private viewTeam: number | undefined;
  private readonly memory = new Map<number, Remembered>();

  /**
   * @param capacity Entities per snapshot, plus room for remembered structures.
   * @param teamOf Dense team index per player slot (from `denseTeams`).
   */
  constructor(
    capacity: number,
    private readonly teamOf: Uint8Array,
    private readonly ruleset: SimRuleset,
    viewTeam: number | undefined,
  ) {
    this.view = { ...createSnapshotBuffers(capacity), remembered: new Uint8Array(capacity) };
    this.viewTeam = viewTeam;
  }

  /** The dense team whose view is drawn, or undefined to see everything. */
  get team(): number | undefined {
    return this.viewTeam;
  }

  /** Switches the view to another dense team (or none). Forgets the old team's memories. */
  setTeam(team: number | undefined): void {
    if (team === this.viewTeam) return;
    this.viewTeam = team;
    this.memory.clear();
  }

  /** Fog state of the ground at (`x`, `z`) for the view team. */
  fogAt(s: SnapshotBuffers, x: number, z: number): number {
    const team = this.viewTeam;
    if (team === undefined || s.visionCols === 0) return Fog.visible;
    const c = Math.min(Math.max(Math.floor(x / VISION_CELL), 0), s.visionCols - 1);
    const r = Math.min(Math.max(Math.floor(z / VISION_CELL), 0), s.visionRows - 1);
    const cells = s.visionCols * s.visionRows;
    return s.vision[team * cells + r * s.visionCols + c] ?? Fog.unexplored;
  }

  /** Rebuilds {@link view} from `s`. Returns it. */
  update(s: SnapshotBuffers): ViewSnapshot & { remembered: Uint8Array } {
    const v = this.view;
    // Everything that is not per entity passes through unchanged.
    v.tick = s.tick;
    v.economy = s.economy;
    v.production = s.production;
    v.match = s.match;
    v.visionCols = s.visionCols;
    v.visionRows = s.visionRows;
    v.visionTeams = s.visionTeams;
    v.vision = s.vision;

    const team = this.viewTeam;
    const present = new Set<number>();
    let n = 0;
    for (let i = 0; i < s.count && n < v.ids.length; i++) {
      const id = s.ids[i] ?? 0;
      const x = s.x[i] ?? 0;
      const z = s.z[i] ?? 0;
      let show: boolean;
      if (team === undefined) show = true;
      else if (s.kinds[i] === EntityKind.feature) show = this.fogAt(s, x, z) !== Fog.unexplored;
      else {
        const owner = s.owners[i] ?? 0;
        const own = (this.teamOf[owner] ?? NO_TEAM) === team;
        const seen = (((s.seenBy[i] ?? 0) >> team) & 1) === 1;
        show = own || seen;
        if (!own && seen && this.ruleset.units[s.types[i] ?? 0]?.mobile === false) {
          this.memory.set(id, {
            type: s.types[i] ?? 0,
            owner,
            x,
            z,
            heading: s.heading[i] ?? 0,
            progress: s.progress[i] ?? 0,
            health: s.health[i] ?? 0,
          });
        }
      }
      if (!show) continue;
      present.add(id);
      v.ids[n] = id;
      v.kinds[n] = s.kinds[i] ?? 0;
      v.types[n] = s.types[i] ?? 0;
      v.owners[n] = s.owners[i] ?? 0;
      v.prevX[n] = s.prevX[i] ?? 0;
      v.prevZ[n] = s.prevZ[i] ?? 0;
      v.x[n] = x;
      v.z[n] = z;
      v.heading[n] = s.heading[i] ?? 0;
      v.progress[n] = s.progress[i] ?? 0;
      v.health[n] = s.health[i] ?? 0;
      v.seenBy[n] = s.seenBy[i] ?? 0;
      v.remembered[n] = 0;
      n++;
    }

    // Last-known enemy structures: drawn where they were, until that spot is seen empty.
    for (const [id, m] of this.memory) {
      if (present.has(id)) continue;
      if (this.fogAt(s, m.x, m.z) === Fog.visible) {
        this.memory.delete(id);
        continue;
      }
      if (n >= v.ids.length) break;
      v.ids[n] = id;
      v.kinds[n] = EntityKind.unit;
      v.types[n] = m.type;
      v.owners[n] = m.owner;
      v.prevX[n] = v.x[n] = m.x;
      v.prevZ[n] = v.z[n] = m.z;
      v.heading[n] = m.heading;
      v.progress[n] = m.progress;
      v.health[n] = m.health;
      v.seenBy[n] = 0;
      v.remembered[n] = 1;
      n++;
    }
    v.count = n;

    let p = 0;
    for (let k = 0; k < s.projectileCount; k++) {
      const x = s.projX[k] ?? 0;
      const z = s.projZ[k] ?? 0;
      if (this.fogAt(s, x, z) !== Fog.visible) continue;
      v.projPrevX[p] = s.projPrevX[k] ?? 0;
      v.projPrevZ[p] = s.projPrevZ[k] ?? 0;
      v.projX[p] = x;
      v.projZ[p] = z;
      v.projT[p] = s.projT[k] ?? 0;
      v.projWeapon[p] = s.projWeapon[k] ?? 0;
      p++;
    }
    v.projectileCount = p;
    v.events = s.events.filter((e) => this.eventSeen(s, e));
    return v;
  }

  private eventSeen(s: SnapshotBuffers, e: SimEvent): boolean {
    if (e.t === "death") return this.fogAt(s, e.x, e.z) === Fog.visible;
    return this.fogAt(s, e.x, e.z) === Fog.visible || this.fogAt(s, e.tx, e.tz) === Fog.visible;
  }
}

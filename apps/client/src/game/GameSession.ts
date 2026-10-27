import {
  EntityKind,
  TICK_MS,
  denseTeams,
  setupCapacity,
  type MatchSetup,
  type PlayerCommand,
  type SnapshotBuffers,
  type Terrain,
} from "@stratcom/sim";
import type { StatsPanel } from "../bench/stats";
import { InputController } from "../input/InputController";
import { Selection } from "../input/selection";
import { createSceneRenderer } from "../render/SceneRenderer";
import type {
  FeatureVisual,
  GameRenderer,
  GroundPoint,
  UnitVisual,
  ViewSnapshot,
  WeaponKind,
} from "../render/types";
import { SimClient } from "../sim/SimClient";
import { FogView } from "./FogView";
import { findUnit } from "./hudModel";

/** Everything a {@link GameSession} needs to run a match locally. */
export interface SessionOptions {
  setup: MatchSetup;
  /** Placeholder looks, indexed by unit type id. */
  unitVisuals: readonly UnitVisual[];
  /** Placeholder looks, indexed by feature type id. */
  featureVisuals?: readonly FeatureVisual[];
  /** Kind of each weapon id, for its effects. */
  weaponKinds?: readonly WeaponKind[];
  /** Slot of the local (human) player. */
  localSlot: number;
  /** Drive the match with the built-in scripted commands (demo and `?bench=N`). */
  scripted?: boolean;
  /** Fog of war for the local player's team; defaults to on. Off shows the whole map. */
  fog?: boolean;
  /** Selection-ring colour; the local faction's accent. */
  selectionColor?: string;
  /** Unit type the camera starts on, normally the local commander. */
  focusType?: number;
  /** Performance panel fed with frame and sim figures (`?bench=N`). */
  stats?: StatsPanel;
  /** Called when the simulation worker reports an error. */
  onError?(message: string): void;
}

/** Initial camera distance in metres when starting on the commander. */
const START_DISTANCE = 240;

/**
 * One running match on this machine: a fresh canvas, the renderer, the sim worker, input and
 * the frame loop. Screens create one, read from it, and dispose it; nothing else touches the
 * renderer or the worker. Each session gets its own canvas so a disposed WebGL context is
 * never reused.
 */
export class GameSession {
  readonly canvas: HTMLCanvasElement;
  readonly selection = new Selection();
  /** Resolves once the first snapshot has been drawn. */
  readonly firstFrame: Promise<void>;
  private readonly renderer: GameRenderer;
  private readonly sim: SimClient;
  private readonly input: InputController;
  private readonly observer: ResizeObserver;
  private current: SnapshotBuffers | undefined;
  /** {@link current} as the local team may see it. */
  private seen: ViewSnapshot | undefined;
  private readonly fog: FogView;
  private readonly teamOf: Uint8Array;
  private activeSlot: number;
  private receivedAt = 0;
  private frame = 0;
  private isPaused = false;
  private disposed = false;

  constructor(private readonly options: SessionOptions) {
    const { setup } = options;
    this.canvas = replaceViewport();
    const players: (string | undefined)[] = [];
    for (const p of setup.players) players[p.slot] = p.color;
    this.renderer = createSceneRenderer(this.canvas, {
      unitVisuals: options.unitVisuals,
      featureVisuals: options.featureVisuals ?? [],
      weaponKinds: options.weaponKinds ?? [],
      deposits: setup.deposits ?? [],
      playerColors: Array.from(players, (c) => c ?? "#808080"),
      maxUnits: setupCapacity(setup),
      terrain: setup.terrain,
      ...(options.selectionColor ? { selectionColor: options.selectionColor } : {}),
    });
    this.focusStart();
    const teams = denseTeams(setup.players);
    this.teamOf = teams.teamOf;
    this.activeSlot = options.localSlot;
    this.fog = new FogView(
      setupCapacity(setup),
      teams.teamOf,
      setup.ruleset,
      options.fog === false ? undefined : teams.teamOf[options.localSlot],
    );

    let drawn: () => void = () => undefined;
    this.firstFrame = new Promise((resolve) => (drawn = resolve));
    this.sim = new SimClient(
      setup,
      {
        onSnapshot: (snapshot, at) => {
          if (this.current) this.sim.recycle(this.current);
          this.current = snapshot;
          this.receivedAt = at;
          this.seen = this.fog.update(snapshot);
          this.renderer.addEvents(this.seen.events, at);
          this.shadeFog(snapshot);
        },
        onStats: (s) => options.stats?.setSim(s),
        onError: (message) => options.onError?.(message),
      },
      options.scripted ?? false,
    );

    const activeSlot = (): number => this.activeSlot;
    this.input = new InputController({
      canvas: this.canvas,
      renderer: this.renderer,
      selection: this.selection,
      // A getter, so hotseat switches reach the input layer.
      get localSlot() {
        return activeSlot();
      },
      teams: teamsBySlot(setup),
      ruleset: setup.ruleset,
      terrain: setup.terrain,
      deposits: setup.deposits ?? [],
      unitVisuals: options.unitVisuals,
      // Input sees what the player sees: hidden enemies cannot be picked.
      current: () => (this.seen ? { snapshot: this.seen, alpha: this.alpha() } : undefined),
      command: (cmd) => {
        this.issue(cmd);
      },
    });
    this.input.onPlacementChange = (type) => {
      if (type === undefined) delete document.documentElement.dataset["placing"];
      else document.documentElement.dataset["placing"] = String(type);
    };

    const resize = (): void => {
      this.renderer.resize(this.canvas.clientWidth, this.canvas.clientHeight, devicePixelRatio);
    };
    this.observer = new ResizeObserver(resize);
    this.observer.observe(this.canvas);
    resize();

    let lastTime = performance.now();
    const root = document.documentElement.dataset;
    const loop = (time: number): void => {
      this.input.update(Math.min((time - lastTime) / 1000, 0.1));
      lastTime = time;
      const snap = this.seen;
      if (snap) {
        this.renderer.setUnits(snap, this.alpha(), this.selection.ids);
        root["selected"] = String(this.selection.ids.size);
        root["units"] = String(countOwned(snap, this.activeSlot));
        root["slot"] = String(this.activeSlot);
        const ghost = this.input.ghostValid;
        if (ghost === undefined) delete root["ghost"];
        else root["ghost"] = ghost ? "valid" : "invalid";
        root["zoom"] = this.renderer.strategicBlend.toFixed(2);
      }
      this.renderer.render(time);
      options.stats?.frame(time, this.renderer.drawCalls);
      if (snap) drawn();
      this.frame = requestAnimationFrame(loop);
    };
    this.frame = requestAnimationFrame(loop);
  }

  /** The latest snapshot, if one has arrived. Read-only: it is handed back to the worker. */
  get snapshot(): SnapshotBuffers | undefined {
    return this.current;
  }

  /** The player slot this machine commands now (changes only in hotseat mode). */
  get localSlot(): number {
    return this.activeSlot;
  }

  /**
   * Hands control to player `slot` (hotseat debugging): the selection is cleared, and the
   * fog of war, if on, switches to that player's team.
   */
  setLocalSlot(slot: number): void {
    if (slot === this.activeSlot) return;
    this.activeSlot = slot;
    this.input.cancelPlacement();
    this.selection.set([]);
    if (this.fog.team !== undefined) this.fog.setTeam(this.teamOf[slot]);
    if (this.current) {
      this.seen = this.fog.update(this.current);
      this.shadeFog(this.current);
    }
  }

  /** Dense team index whose view is shown (fog of war), or undefined when fog is off. */
  get viewTeam(): number | undefined {
    return this.fog.team;
  }

  /** The match's ground. */
  get terrain(): Terrain {
    return this.options.setup.terrain;
  }

  /** The latest snapshot as the local team sees it (fog of war applied). */
  get view(): ViewSnapshot | undefined {
    return this.seen;
  }

  /** Ticks simulated so far, as of the latest snapshot. */
  get tick(): number {
    return this.current?.tick ?? 0;
  }

  get paused(): boolean {
    return this.isPaused;
  }

  /** Pauses the simulation and input (pause menu); rendering continues. */
  setPaused(paused: boolean): void {
    this.isPaused = paused;
    this.input.enabled = !paused;
    if (paused) this.input.cancelPlacement();
    this.sim.setPaused(paused);
  }

  /** Sends a command from the local player to the simulation (HUD buttons use this). */
  issue(cmd: PlayerCommand): void {
    this.sim.sendCommands([cmd]);
  }

  /** Structure type being placed, if the player is placing one. */
  get placing(): number | undefined {
    return this.input.placingType;
  }

  /** Starts placing structure `type` for the selected builders. */
  beginPlacement(type: number): void {
    this.input.beginPlacement(type);
  }

  /** Leaves placement mode. */
  cancelPlacement(): void {
    this.input.cancelPlacement();
  }

  /** Centres the camera on the local player's first unit of `type`. Returns false if none. */
  focusType(type: number): boolean {
    const snap = this.current;
    const i = snap ? findUnit(snap, this.activeSlot, type) : -1;
    if (!snap || i < 0) return false;
    this.renderer.camera.focus(snap.x[i] ?? 0, snap.z[i] ?? 0);
    return true;
  }

  /** Centres the camera on a ground point (minimap clicks). */
  focus(x: number, z: number): void {
    this.renderer.camera.focus(x, z);
  }

  /** Orders the selection to a ground point as a right click there would (minimap). */
  orderAt(x: number, z: number, queue: boolean): void {
    this.input.orderAt({ x, z }, queue);
  }

  /**
   * The ground under the four corners of the view (top-left, top-right, bottom-right,
   * bottom-left). Corners that look past the map edge into the sky are left out.
   */
  viewQuad(): GroundPoint[] {
    const corners: [number, number][] = [
      [-1, 1],
      [1, 1],
      [1, -1],
      [-1, -1],
    ];
    const out: GroundPoint[] = [];
    for (const [x, y] of corners) {
      const p = this.renderer.groundAt(x, y);
      if (p) out.push(p);
    }
    return out;
  }

  /** Narrows the selection to units of one type. */
  selectOnlyType(type: number): void {
    const snap = this.current;
    if (!snap) return;
    const keep: number[] = [];
    for (let i = 0; i < snap.count; i++) {
      const id = snap.ids[i] ?? 0;
      if (snap.types[i] === type && this.selection.ids.has(id)) keep.push(id);
    }
    this.selection.set(keep);
  }

  /** Stops the worker and frame loop and releases the GPU context. Safe to call twice. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    this.observer.disconnect();
    this.input.dispose();
    this.sim.dispose();
    this.renderer.dispose();
    replaceViewport();
    const root = document.documentElement.dataset;
    delete root["selected"];
    delete root["zoom"];
    delete root["units"];
    delete root["placing"];
    delete root["ghost"];
    delete root["fog"];
    delete root["slot"];
  }

  /** Darkens the ground the view team has not explored or does not see now. */
  private shadeFog(snapshot: SnapshotBuffers): void {
    const team = this.fog.team;
    const cells = snapshot.visionCols * snapshot.visionRows;
    if (team === undefined || cells === 0) this.renderer.setFog(undefined);
    else this.renderer.setFog(snapshot.vision, team * cells);
    document.documentElement.dataset["fog"] = team === undefined ? "off" : String(team);
  }

  private alpha(): number {
    // Snapshot N holds the state at the end of tick N; blend prev→current over one tick.
    if (this.isPaused) return 1;
    return Math.min((performance.now() - this.receivedAt) / TICK_MS, 1);
  }

  private focusStart(): void {
    const { setup, focusType, localSlot } = this.options;
    const start = setup.initialUnits.find(
      (u) => u.slot === localSlot && (focusType === undefined || u.type === focusType),
    );
    if (!start) {
      this.renderer.camera.zoomAt(0, 0, 0.4);
      return;
    }
    const cam = this.renderer.camera;
    cam.zoomAt(0, 0, START_DISTANCE / cam.distance);
    cam.focus(start.x, start.z);
  }
}

/** Team of each player slot, indexed by slot. */
function teamsBySlot(setup: MatchSetup): (number | undefined)[] {
  const teams: (number | undefined)[] = [];
  for (const p of setup.players) teams[p.slot] = p.team;
  return teams;
}

/** Number of units and structures (finished or not) owned by `slot`. */
function countOwned(snap: SnapshotBuffers, slot: number): number {
  let n = 0;
  for (let i = 0; i < snap.count; i++) {
    if (snap.owners[i] === slot && snap.kinds[i] === EntityKind.unit) n++;
  }
  return n;
}

/** Swaps `#viewport` for a fresh canvas, so every session starts with a clean context. */
function replaceViewport(): HTMLCanvasElement {
  const old = document.querySelector<HTMLCanvasElement>("#viewport");
  const fresh = document.createElement("canvas");
  fresh.id = "viewport";
  if (old) old.replaceWith(fresh);
  else document.body.prepend(fresh);
  return fresh;
}

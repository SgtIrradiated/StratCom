import { TICK_MS, type MatchSetup, type SnapshotBuffers } from "@stratcom/sim";
import type { StatsPanel } from "../bench/stats";
import { InputController } from "../input/InputController";
import { Selection } from "../input/selection";
import { createSceneRenderer } from "../render/SceneRenderer";
import type { GameRenderer, UnitVisual } from "../render/types";
import { SimClient } from "../sim/SimClient";
import { findUnit } from "./hudModel";

/** Everything a {@link GameSession} needs to run a match locally. */
export interface SessionOptions {
  setup: MatchSetup;
  /** Placeholder looks, indexed by unit type id. */
  unitVisuals: readonly UnitVisual[];
  /** Slot of the local (human) player. */
  localSlot: number;
  /** Drive the match with the built-in scripted commands (demo and `?bench=N`). */
  scripted?: boolean;
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
      playerColors: Array.from(players, (c) => c ?? "#808080"),
      maxUnits: setup.capacity ?? setup.initialUnits.length + 4096,
      terrain: setup.terrain,
      ...(options.selectionColor ? { selectionColor: options.selectionColor } : {}),
    });
    this.focusStart();

    let drawn: () => void = () => undefined;
    this.firstFrame = new Promise((resolve) => (drawn = resolve));
    this.sim = new SimClient(
      setup,
      {
        onSnapshot: (snapshot, at) => {
          if (this.current) this.sim.recycle(this.current);
          this.current = snapshot;
          this.receivedAt = at;
        },
        onStats: (s) => options.stats?.setSim(s),
        onError: (message) => options.onError?.(message),
      },
      options.scripted ?? false,
    );

    this.input = new InputController({
      canvas: this.canvas,
      renderer: this.renderer,
      selection: this.selection,
      localSlot: options.localSlot,
      current: () => (this.current ? { snapshot: this.current, alpha: this.alpha() } : undefined),
      command: (cmd) => {
        this.sim.sendCommands([cmd]);
      },
    });

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
      const snap = this.current;
      if (snap) {
        this.renderer.setUnits(snap, this.alpha(), this.selection.ids);
        root["selected"] = String(this.selection.ids.size);
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
    this.sim.setPaused(paused);
  }

  /** Centres the camera on the local player's first unit of `type`. Returns false if none. */
  focusType(type: number): boolean {
    const snap = this.current;
    const i = snap ? findUnit(snap, this.options.localSlot, type) : -1;
    if (!snap || i < 0) return false;
    this.renderer.camera.focus(snap.x[i] ?? 0, snap.z[i] ?? 0);
    return true;
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

/** Swaps `#viewport` for a fresh canvas, so every session starts with a clean context. */
function replaceViewport(): HTMLCanvasElement {
  const old = document.querySelector<HTMLCanvasElement>("#viewport");
  const fresh = document.createElement("canvas");
  fresh.id = "viewport";
  if (old) old.replaceWith(fresh);
  else document.body.prepend(fresh);
  return fresh;
}

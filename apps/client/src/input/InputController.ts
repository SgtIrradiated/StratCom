import type { PlayerCommand, SnapshotBuffers } from "@stratcom/sim";
import type { GameRenderer } from "../render/types";
import type { Selection } from "./selection";
import { nearestUnit, unitsInRect } from "./selection";

/** What the controller needs from the running match. */
export interface InputHost {
  readonly canvas: HTMLCanvasElement;
  readonly renderer: GameRenderer;
  readonly selection: Selection;
  /** Slot of the local player; only that player's units can be selected or commanded. */
  readonly localSlot: number;
  /** Latest snapshot and its interpolation factor, if one has arrived. */
  current(): { snapshot: SnapshotBuffers; alpha: number } | undefined;
  /** Sends a command to the simulation. */
  command(cmd: PlayerCommand): void;
}

const EDGE_PX = 6;
const CLICK_RADIUS_PX = 16;
const DRAG_THRESHOLD_PX = 5;
const PAN_SCREENS_PER_SECOND = 0.9;
const ROTATE_RADIANS_PER_SECOND = 1.6;
const GROUP_DOUBLE_TAP_MS = 400;

/**
 * Translates mouse and keyboard input into camera motion, selection changes and commands.
 * Never touches simulation state: the only output is {@link InputHost.command}.
 *
 * Mouse: left click / drag-box select (Shift adds), double-click selects every visible unit
 * of the same type, right click moves, middle-drag rotates, wheel zooms to the cursor, and
 * the screen edges pan. Keyboard: WASD / arrows pan, Q / E rotate, Ctrl+1–9 stores a control
 * group, 1–9 recalls it (twice to centre the camera), X stops.
 */
export class InputController {
  /** While false, every input except releasing held buttons is ignored (pause menu). */
  enabled = true;
  private readonly keys = new Set<string>();
  private readonly box = document.createElement("div");
  private screenBuf = new Float32Array(0);
  private dragStart: { x: number; y: number } | undefined;
  private rotating = false;
  private mouse: { x: number; y: number } | undefined;
  private lastGroup = { n: 0, at: 0 };
  private readonly disposers: (() => void)[] = [];

  constructor(private readonly host: InputHost) {
    this.box.className = "select-box";
    this.box.hidden = true;
    document.body.append(this.box);
    const c = host.canvas;
    this.listen(c, "pointerdown", (e) => {
      this.onPointerDown(e);
    });
    this.listen(window, "pointermove", (e) => {
      this.onPointerMove(e);
    });
    this.listen(window, "pointerup", (e) => {
      this.onPointerUp(e);
    });
    this.listen(c, "dblclick", (e) => {
      this.onDoubleClick(e);
    });
    this.listen(c, "contextmenu", (e) => {
      e.preventDefault();
    });
    this.listen(
      c,
      "wheel",
      (e) => {
        this.onWheel(e);
      },
      { passive: false },
    );
    this.listen(document, "mouseleave", () => {
      this.mouse = undefined;
    });
    this.listen(window, "keydown", (e) => {
      this.onKeyDown(e);
    });
    this.listen(window, "keyup", (e) => {
      this.keys.delete(e.code);
    });
    this.listen(window, "blur", () => {
      this.keys.clear();
    });
  }

  /** Applies held-key and screen-edge camera motion. Call once per frame. */
  update(dtSec: number): void {
    if (!this.enabled) return;
    const cam = this.host.renderer.camera;
    const speed = cam.distance * PAN_SCREENS_PER_SECOND * dtSec;
    let right = 0;
    let forward = 0;
    if (this.keys.has("KeyD") || this.keys.has("ArrowRight")) right += 1;
    if (this.keys.has("KeyA") || this.keys.has("ArrowLeft")) right -= 1;
    if (this.keys.has("KeyW") || this.keys.has("ArrowUp")) forward += 1;
    if (this.keys.has("KeyS") || this.keys.has("ArrowDown")) forward -= 1;
    const m = this.mouse;
    if (m && !this.dragStart && !this.rotating) {
      const r = this.host.canvas.getBoundingClientRect();
      if (m.x <= r.left + EDGE_PX) right -= 1;
      if (m.x >= r.right - EDGE_PX) right += 1;
      if (m.y <= r.top + EDGE_PX) forward += 1;
      if (m.y >= r.bottom - EDGE_PX) forward -= 1;
    }
    if (right !== 0 || forward !== 0) cam.pan(right * speed, forward * speed);
    if (this.keys.has("KeyQ")) cam.rotate(-ROTATE_RADIANS_PER_SECOND * dtSec);
    if (this.keys.has("KeyE")) cam.rotate(ROTATE_RADIANS_PER_SECOND * dtSec);
  }

  /** Removes every listener and DOM node this controller added. */
  dispose(): void {
    for (const d of this.disposers) d();
    this.box.remove();
  }

  private listen<K extends keyof HTMLElementEventMap>(
    target: EventTarget,
    type: K,
    handler: (e: HTMLElementEventMap[K]) => void,
    options?: AddEventListenerOptions,
  ): void {
    target.addEventListener(type, handler as EventListener, options);
    this.disposers.push(() => {
      target.removeEventListener(type, handler as EventListener);
    });
  }

  private local(e: MouseEvent): { x: number; y: number } {
    const r = this.host.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private ndc(p: { x: number; y: number }): { x: number; y: number } {
    const r = this.host.canvas.getBoundingClientRect();
    return { x: (p.x / r.width) * 2 - 1, y: 1 - (p.y / r.height) * 2 };
  }

  /** Projects the current snapshot to screen space. Returns undefined before the first one. */
  private project(): { snapshot: SnapshotBuffers; screen: Float32Array } | undefined {
    const cur = this.host.current();
    if (!cur) return undefined;
    if (this.screenBuf.length < cur.snapshot.count * 2) {
      this.screenBuf = new Float32Array(cur.snapshot.ids.length * 2);
    }
    this.host.renderer.projectUnits(cur.snapshot, cur.alpha, this.screenBuf);
    return { snapshot: cur.snapshot, screen: this.screenBuf };
  }

  private isMine(snapshot: SnapshotBuffers, i: number): boolean {
    return snapshot.owners[i] === this.host.localSlot;
  }

  private onPointerDown(e: PointerEvent): void {
    if (!this.enabled) return;
    this.mouse = { x: e.clientX, y: e.clientY };
    if (e.button === 0) {
      this.dragStart = this.local(e);
    } else if (e.button === 1) {
      this.rotating = true;
      e.preventDefault();
    } else if (e.button === 2) {
      const p = this.ndc(this.local(e));
      const ground = this.host.renderer.groundAt(p.x, p.y);
      if (ground && this.host.selection.ids.size > 0) {
        this.host.command({
          t: "move",
          slot: this.host.localSlot,
          units: [...this.host.selection.ids],
          to: ground,
        });
      }
    }
  }

  private onPointerMove(e: PointerEvent): void {
    this.mouse = { x: e.clientX, y: e.clientY };
    if (this.rotating) {
      this.host.renderer.camera.rotate(e.movementX * 0.005);
      return;
    }
    const start = this.dragStart;
    if (!start) return;
    const p = this.local(e);
    if (Math.abs(p.x - start.x) + Math.abs(p.y - start.y) < DRAG_THRESHOLD_PX) return;
    const r = this.host.canvas.getBoundingClientRect();
    this.box.hidden = false;
    this.box.style.left = `${r.left + Math.min(start.x, p.x)}px`;
    this.box.style.top = `${r.top + Math.min(start.y, p.y)}px`;
    this.box.style.width = `${Math.abs(p.x - start.x)}px`;
    this.box.style.height = `${Math.abs(p.y - start.y)}px`;
  }

  private onPointerUp(e: PointerEvent): void {
    if (e.button === 1) this.rotating = false;
    if (e.button !== 0 || !this.dragStart) return;
    const start = this.dragStart;
    const end = this.local(e);
    this.dragStart = undefined;
    this.box.hidden = true;
    const proj = this.project();
    if (!proj) return;
    const { snapshot, screen } = proj;

    const dragged = Math.abs(end.x - start.x) + Math.abs(end.y - start.y) >= DRAG_THRESHOLD_PX;
    let picked: number[];
    if (dragged) {
      picked = unitsInRect(screen, snapshot.count, {
        x0: start.x,
        y0: start.y,
        x1: end.x,
        y1: end.y,
      });
    } else {
      const i = nearestUnit(screen, snapshot.count, end.x, end.y, CLICK_RADIUS_PX);
      picked = i >= 0 ? [i] : [];
    }
    const ids = picked.filter((i) => this.isMine(snapshot, i)).map((i) => snapshot.ids[i] ?? 0);
    if (e.shiftKey) this.host.selection.add(ids);
    else this.host.selection.set(ids);
  }

  private onDoubleClick(e: MouseEvent): void {
    if (!this.enabled) return;
    const proj = this.project();
    if (!proj) return;
    const { snapshot, screen } = proj;
    const p = this.local(e);
    const i = nearestUnit(screen, snapshot.count, p.x, p.y, CLICK_RADIUS_PX);
    if (i < 0 || !this.isMine(snapshot, i)) return;
    const type = snapshot.types[i];
    const r = this.host.canvas.getBoundingClientRect();
    const onScreen = unitsInRect(screen, snapshot.count, {
      x0: 0,
      y0: 0,
      x1: r.width,
      y1: r.height,
    });
    const ids = onScreen
      .filter((k) => this.isMine(snapshot, k) && snapshot.types[k] === type)
      .map((k) => snapshot.ids[k] ?? 0);
    if (e.shiftKey) this.host.selection.add(ids);
    else this.host.selection.set(ids);
  }

  private onWheel(e: WheelEvent): void {
    e.preventDefault();
    if (!this.enabled) return;
    const p = this.ndc(this.local(e));
    // Trackpads send many small deltas, mice a few large ones; both map to smooth zoom.
    const factor = Math.exp(Math.max(-200, Math.min(200, e.deltaY)) * 0.0022);
    this.host.renderer.camera.zoomAt(p.x, p.y, factor);
  }

  private onKeyDown(e: KeyboardEvent): void {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    if (!this.enabled) return;
    this.keys.add(e.code);
    const digit = /^Digit([1-9])$/.exec(e.code)?.[1];
    if (digit !== undefined) {
      this.groupKey(Number(digit), e.ctrlKey || e.metaKey);
      e.preventDefault();
    } else if (e.code === "KeyX" && !e.repeat && this.host.selection.ids.size > 0) {
      this.host.command({
        t: "stop",
        slot: this.host.localSlot,
        units: [...this.host.selection.ids],
      });
    }
  }

  private groupKey(n: number, assign: boolean): void {
    const sel = this.host.selection;
    if (assign) {
      sel.assignGroup(n);
      return;
    }
    const cur = this.host.current();
    const alive = new Set<number>();
    if (cur) for (let i = 0; i < cur.snapshot.count; i++) alive.add(cur.snapshot.ids[i] ?? 0);
    const ids = sel.recallGroup(n, (id) => alive.has(id));
    const now = performance.now();
    if (
      cur &&
      ids.length > 0 &&
      this.lastGroup.n === n &&
      now - this.lastGroup.at < GROUP_DOUBLE_TAP_MS
    ) {
      let sx = 0;
      let sz = 0;
      let k = 0;
      const set = new Set(ids);
      for (let i = 0; i < cur.snapshot.count; i++) {
        if (!set.has(cur.snapshot.ids[i] ?? 0)) continue;
        sx += cur.snapshot.x[i] ?? 0;
        sz += cur.snapshot.z[i] ?? 0;
        k++;
      }
      if (k > 0) this.host.renderer.camera.focus(sx / k, sz / k);
    }
    this.lastGroup = { n, at: now };
  }
}

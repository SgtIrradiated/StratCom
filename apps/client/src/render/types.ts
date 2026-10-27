/**
 * Renderer-facing types. Code outside `src/render` talks to the renderer only through
 * these interfaces and never imports three.js directly (ADR-0004). That keeps a future
 * move to three's WebGPURenderer contained to this folder.
 */
import type { SnapshotBuffers } from "@stratcom/sim";

/** How one unit type is drawn until real models exist. Indexed by the sim's unit type id. */
export interface UnitVisual {
  /** Box dimensions in metres: width (x), height (y), length (z). */
  size: readonly [number, number, number];
}

export interface SceneOptions {
  /** One entry per unit type id used by the simulation. */
  unitVisuals: readonly UnitVisual[];
  /** CSS hex colour per player slot, indexed by slot. */
  playerColors: readonly string[];
  /** Maximum number of units that can be drawn (snapshot capacity). */
  maxUnits: number;
  /** Side length of the square test plain, in metres. */
  mapSize: number;
}

export interface GameRenderer {
  /** Resizes the drawing buffer. Sizes are CSS pixels; the renderer applies DPR itself. */
  resize(width: number, height: number, devicePixelRatio: number): void;
  /**
   * Sets the units to draw from a sim snapshot. `alpha` in [0, 1] blends each unit between
   * its position at the start (0) and end (1) of the snapshot's tick.
   */
  setUnits(snapshot: SnapshotBuffers, alpha: number): void;
  /** Points the camera at (`x`, `z`) on the ground from `height` metres up. */
  lookAt(x: number, z: number, height: number): void;
  /** Draws one frame. `timeMs` is the rAF timestamp, for presentation-only animation. */
  render(timeMs: number): void;
  /** Number of GPU draw calls issued by the last {@link render}. */
  readonly drawCalls: number;
  /** Releases all GPU resources. The renderer is unusable afterwards. */
  dispose(): void;
}

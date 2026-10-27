/**
 * Renderer-facing types. Code outside `src/render` talks to the renderer only through
 * these interfaces and never imports three.js directly (ADR-0004). That keeps a future
 * move to three's WebGPURenderer contained to this folder.
 */
import type { SnapshotBuffers, Terrain } from "@stratcom/sim";

/** Shape of the strategic-zoom icon for a unit type. */
export type IconShape = "circle" | "square" | "triangle" | "diamond";

/** How one unit type is drawn until real models exist. Indexed by the sim's unit type id. */
export interface UnitVisual {
  /** Box dimensions in metres: width (x), height (y), length (z). */
  size: readonly [number, number, number];
  /** Collision radius in metres; sizes the selection ring. */
  radius: number;
  /** Icon shown when zoomed out. */
  icon: IconShape;
}

export interface SceneOptions {
  /** One entry per unit type id used by the simulation. */
  unitVisuals: readonly UnitVisual[];
  /** CSS hex colour per player slot, indexed by slot. */
  playerColors: readonly string[];
  /** Maximum number of units that can be drawn (snapshot capacity). */
  maxUnits: number;
  terrain: Terrain;
}

/** A point on the ground plane, in metres. */
export interface GroundPoint {
  x: number;
  z: number;
}

/** Camera operations the input layer may use. Distances are metres, angles radians. */
export interface CameraControl {
  /** Distance from the camera to its ground target. Larger means further zoomed out. */
  readonly distance: number;
  /** Ground point the camera looks at. */
  readonly target: GroundPoint;
  /** Pans relative to the view direction: `right` and `forward` in metres. */
  pan(right: number, forward: number): void;
  /** Rotates around the target. */
  rotate(radians: number): void;
  /** Zooms by `factor` (< 1 in, > 1 out) keeping the ground under the cursor fixed. */
  zoomAt(ndcX: number, ndcY: number, factor: number): void;
  /** Centres the view on a ground point. */
  focus(x: number, z: number): void;
}

export interface GameRenderer {
  readonly camera: CameraControl;
  /** Resizes the drawing buffer. Sizes are CSS pixels; the renderer applies DPR itself. */
  resize(width: number, height: number, devicePixelRatio: number): void;
  /**
   * Sets the units to draw from a sim snapshot. `alpha` in [0, 1] blends each unit between
   * its position at the start (0) and end (1) of the snapshot's tick. `selected` holds the
   * entity ids to highlight.
   */
  setUnits(snapshot: SnapshotBuffers, alpha: number, selected: ReadonlySet<number>): void;
  /**
   * Writes the screen position (CSS pixels, x then y per unit) of every unit in the
   * snapshot into `out`, using the same interpolation as {@link setUnits}. Units behind
   * the camera get NaN.
   */
  projectUnits(snapshot: SnapshotBuffers, alpha: number, out: Float32Array): void;
  /** Ground point under normalised device coordinates (-1…1, y up), if the ray hits it. */
  groundAt(ndcX: number, ndcY: number): GroundPoint | undefined;
  /** Advances camera smoothing/LOD and draws one frame. */
  render(timeMs: number): void;
  /** Number of GPU draw calls issued by the last {@link render}. */
  readonly drawCalls: number;
  /** 0 when drawing 3D models, 1 when only strategic icons are shown. */
  readonly strategicBlend: number;
  /** Releases all GPU resources. The renderer is unusable afterwards. */
  dispose(): void;
}

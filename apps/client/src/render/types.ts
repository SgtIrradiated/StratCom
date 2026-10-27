/**
 * Renderer-facing types. Code outside `src/render` talks to the renderer only through
 * these interfaces and never imports three.js directly (ADR-0004). That keeps a future
 * move to three's WebGPURenderer contained to this folder.
 */
import type { IconShape, WeaponKind } from "@stratcom/data";
import type { SimEvent, SnapshotBuffers, Terrain } from "@stratcom/sim";

export type { IconShape, WeaponKind };

/** How one unit type is drawn until real models exist. Indexed by the sim's unit type id. */
export interface UnitVisual {
  /** Box dimensions in metres: width (x), height (y), length (z). */
  size: readonly [number, number, number];
  /** Collision radius in metres; sizes the selection ring. */
  radius: number;
  /** Icon shown when zoomed out. */
  icon: IconShape;
}

/** How one feature type (debris, wrecks) is drawn. Indexed by the sim's feature type id. */
export interface FeatureVisual {
  /** Box dimensions in metres: width (x), height (y), length (z). */
  size: readonly [number, number, number];
  /** CSS hex colour. */
  color: string;
}

/**
 * A snapshot as one player may see it (fog of war applied by the game layer). `remembered`
 * marks enemy structures drawn where they were last seen.
 */
export interface ViewSnapshot extends SnapshotBuffers {
  remembered?: Uint8Array;
}

export interface SceneOptions {
  /** One entry per unit type id used by the simulation. */
  unitVisuals: readonly UnitVisual[];
  /** One entry per feature type id. */
  featureVisuals: readonly FeatureVisual[];
  /** Kind of each weapon id, for its effects. Missing weapons draw as ballistic. */
  weaponKinds: readonly WeaponKind[];
  /** Salvage deposits, drawn as markers on the ground. */
  deposits: readonly GroundPoint[];
  /** CSS hex colour per player slot, indexed by slot. */
  playerColors: readonly string[];
  /** Maximum number of units that can be drawn (snapshot capacity). */
  maxUnits: number;
  terrain: Terrain;
  /** CSS hex colour of selection rings; the local player's faction accent. */
  selectionColor?: string;
}

/** A point on the ground plane, in metres. */
export interface GroundPoint {
  x: number;
  z: number;
}

/** The translucent preview of a structure being placed. */
export interface PlacementGhost {
  /** Centre on the ground, in metres. */
  x: number;
  z: number;
  /** Footprint in metres along x and z (already rotated). */
  width: number;
  depth: number;
  /** Placeholder box size of the structure, before rotation. */
  size: readonly [number, number, number];
  heading: number;
  /** Green when the site is buildable, red when it is not. */
  valid: boolean;
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
  setUnits(snapshot: ViewSnapshot, alpha: number, selected: ReadonlySet<number>): void;
  /**
   * Shades the ground by fog of war: one team's cells of a snapshot's `vision` grid, or
   * undefined to light the whole map.
   */
  setFog(vision: Uint8Array | undefined, offset?: number): void;
  /** Starts the effects (shots, impacts) for a snapshot's events, received at `timeMs`. */
  addEvents(events: readonly SimEvent[], timeMs: number): void;
  /**
   * Writes the screen position (CSS pixels, x then y per unit) of every unit in the
   * snapshot into `out`, using the same interpolation as {@link setUnits}. Units behind
   * the camera get NaN.
   */
  projectUnits(snapshot: SnapshotBuffers, alpha: number, out: Float32Array): void;
  /** Shows the placement ghost, or hides it with undefined. */
  setGhost(ghost: PlacementGhost | undefined): void;
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

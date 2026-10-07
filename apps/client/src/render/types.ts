/**
 * Renderer-facing types. Code outside `src/render` talks to the renderer only through
 * these interfaces and never imports three.js directly (ADR-0004). That keeps a future
 * move to three's WebGPURenderer contained to this folder.
 */

/** A placeholder unit drawn until real models exist (M0 only; replaced by UnitLayer in M1). */
export interface PlaceholderUnit {
  /** CSS hex colour, e.g. "#6b7a4f". */
  baseColor: string;
  /** CSS hex colour for the glowing accent light. */
  accentColor: string;
  /** World position on the ground plane, in metres. */
  x: number;
  z: number;
}

export interface SceneOptions {
  placeholders: readonly PlaceholderUnit[];
}

export interface GameRenderer {
  /** Resizes the drawing buffer. Sizes are CSS pixels; the renderer applies DPR itself. */
  resize(width: number, height: number, devicePixelRatio: number): void;
  /** Draws one frame. `timeMs` is the rAF timestamp, used for presentation-only animation. */
  render(timeMs: number): void;
  /** Releases all GPU resources. The renderer is unusable afterwards. */
  dispose(): void;
}

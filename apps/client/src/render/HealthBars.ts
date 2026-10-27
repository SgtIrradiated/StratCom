import {
  Color,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedMesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Vector3,
  type PerspectiveCamera,
} from "three";

/** Bar height in metres, and its gap above the unit's box. */
const BAR_HEIGHT = 0.6;
const BAR_GAP = 1.5;
const BACK = new Color("#1a1a16");
const FULL = new Color("#7dff9a");
const EMPTY = new Color("#ff4a3a");

/**
 * Health bars over damaged units: a dark backing and a fill that shrinks to the left and
 * shifts from green to red. Each bar faces the camera. Drawn on top of everything.
 */
export class HealthBars {
  readonly mesh: InstancedMesh;
  private readonly geometry = new PlaneGeometry(1, 1);
  // Exact colours: tone mapping would wash the bars out to white.
  private readonly material = new MeshBasicMaterial({
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
  private readonly matrices: Float32Array;
  private readonly colors: Float32Array;
  private readonly right = new Vector3();
  private readonly up = new Vector3();
  private readonly back = new Vector3();
  private readonly fill = new Color();
  private n = 0;

  constructor(maxUnits: number) {
    // Two instances per bar: backing and fill.
    this.mesh = new InstancedMesh(this.geometry, this.material, maxUnits * 2);
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.colors = new Float32Array(maxUnits * 6);
    this.mesh.instanceColor = new InstancedBufferAttribute(this.colors, 3);
    this.mesh.instanceColor.setUsage(DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 10;
    this.mesh.count = 0;
    this.matrices = this.mesh.instanceMatrix.array as Float32Array;
  }

  /** Starts a frame; bars face `camera`. */
  begin(camera: PerspectiveCamera): void {
    this.n = 0;
    const e = camera.matrixWorld.elements;
    this.right.set(e[0], e[1], e[2]);
    this.up.set(e[4], e[5], e[6]);
    this.back.set(e[8], e[9], e[10]);
  }

  /**
   * Adds a bar `width` metres wide over a unit whose box top is at (`x`, `top`, `z`), filled
   * to `fraction`.
   */
  add(x: number, top: number, z: number, width: number, fraction: number): void {
    const f = Math.min(Math.max(fraction, 0), 1);
    const y = top + BAR_GAP;
    this.put(x, y, z, width, BACK);
    this.fill.copy(EMPTY).lerp(FULL, f);
    // The fill keeps its left edge where the backing's is.
    const shift = (-(1 - f) * width) / 2;
    this.put(
      x + this.right.x * shift,
      y + this.right.y * shift,
      z + this.right.z * shift,
      width * f,
      this.fill,
    );
  }

  /** Finishes the frame; `opacity` of 0 hides the bars. */
  end(visible: boolean): void {
    this.mesh.visible = visible && this.n > 0;
    this.mesh.count = this.n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.dispose();
    this.geometry.dispose();
    this.material.dispose();
  }

  private put(x: number, y: number, z: number, width: number, color: Color): void {
    const m = this.matrices;
    const o = this.n * 16;
    const { right: r, up: u, back: b } = this;
    m[o] = r.x * width;
    m[o + 1] = r.y * width;
    m[o + 2] = r.z * width;
    m[o + 3] = 0;
    m[o + 4] = u.x * BAR_HEIGHT;
    m[o + 5] = u.y * BAR_HEIGHT;
    m[o + 6] = u.z * BAR_HEIGHT;
    m[o + 7] = 0;
    m[o + 8] = b.x;
    m[o + 9] = b.y;
    m[o + 10] = b.z;
    m[o + 11] = 0;
    m[o + 12] = x;
    m[o + 13] = y;
    m[o + 14] = z;
    m[o + 15] = 1;
    const c = this.n * 3;
    this.colors[c] = color.r;
    this.colors[c + 1] = color.g;
    this.colors[c + 2] = color.b;
    this.n++;
  }
}

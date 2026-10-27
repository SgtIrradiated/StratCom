import { DynamicDrawUsage, InstancedMesh, MeshBasicMaterial, RingGeometry } from "three";

/** Flat rings drawn under selected units. */
export class SelectionRings {
  readonly mesh: InstancedMesh;
  private readonly geometry = new RingGeometry(0.88, 1, 28);
  private readonly material = new MeshBasicMaterial({
    color: "#7dff9a",
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  private readonly matrices: Float32Array;
  private n = 0;

  constructor(maxUnits: number) {
    this.geometry.rotateX(-Math.PI / 2);
    this.mesh = new InstancedMesh(this.geometry, this.material, maxUnits);
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.matrices = this.mesh.instanceMatrix.array as Float32Array;
  }

  begin(): void {
    this.n = 0;
  }

  /** Adds a ring of the given radius centred at (`x`, `y`, `z`). */
  add(x: number, y: number, z: number, radius: number): void {
    const m = this.matrices;
    const o = this.n++ * 16;
    m[o] = radius;
    m[o + 1] = 0;
    m[o + 2] = 0;
    m[o + 3] = 0;
    m[o + 4] = 0;
    m[o + 5] = 1;
    m[o + 6] = 0;
    m[o + 7] = 0;
    m[o + 8] = 0;
    m[o + 9] = 0;
    m[o + 10] = radius;
    m[o + 11] = 0;
    m[o + 12] = x;
    m[o + 13] = y + 0.4;
    m[o + 14] = z;
    m[o + 15] = 1;
  }

  /** Finishes the frame; `opacity` of 0 hides the rings. */
  end(opacity: number): void {
    this.mesh.visible = opacity > 0 && this.n > 0;
    this.material.opacity = opacity;
    this.mesh.count = this.n;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.dispose();
    this.geometry.dispose();
    this.material.dispose();
  }
}

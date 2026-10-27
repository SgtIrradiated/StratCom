import {
  BoxGeometry,
  Color,
  DynamicDrawUsage,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  MeshStandardMaterial,
} from "three";
import type { SnapshotBuffers } from "@stratcom/sim";
import type { UnitVisual } from "./types";

/**
 * Draws every unit with one `InstancedMesh` per unit type, so draw calls scale with the
 * number of types rather than units (docs/PLAN.md §4.3). Per-instance transform and team
 * colour are written straight into the instance attribute arrays each frame.
 */
export class UnitLayer {
  /** Add this to the scene. */
  readonly group = new Group();
  private readonly meshes: InstancedMesh[];
  private readonly colors: Float32Array[];
  private readonly geometries: BoxGeometry[] = [];
  private readonly material = new MeshStandardMaterial({
    color: "#ffffff",
    roughness: 0.8,
    metalness: 0.2,
  });
  private readonly playerRgb: Float32Array;

  constructor(visuals: readonly UnitVisual[], playerColors: readonly string[], maxUnits: number) {
    this.playerRgb = new Float32Array(playerColors.length * 3);
    const c = new Color();
    playerColors.forEach((hex, slot) => {
      c.set(hex);
      this.playerRgb.set([c.r, c.g, c.b], slot * 3);
    });

    this.meshes = visuals.map((v) => {
      const geometry = new BoxGeometry(...v.size);
      geometry.translate(0, v.size[1] / 2, 0);
      this.geometries.push(geometry);
      const mesh = new InstancedMesh(geometry, this.material, maxUnits);
      mesh.instanceMatrix.setUsage(DynamicDrawUsage);
      mesh.instanceColor = new InstancedBufferAttribute(new Float32Array(maxUnits * 3), 3);
      mesh.instanceColor.setUsage(DynamicDrawUsage);
      mesh.count = 0;
      // Instances span the whole map; the default bounding sphere would cull them wrongly.
      mesh.frustumCulled = false;
      this.group.add(mesh);
      return mesh;
    });
    this.colors = this.meshes.map(
      (m) => (m.instanceColor as InstancedBufferAttribute).array as Float32Array,
    );
  }

  /** Rewrites all instance data from `snapshot`, interpolated by `alpha`. */
  update(snapshot: SnapshotBuffers, alpha: number): void {
    const counts = new Uint32Array(this.meshes.length);
    const matrices = this.meshes.map((m) => m.instanceMatrix.array as Float32Array);
    const { count, types, owners, prevX, prevZ, x, z, heading } = snapshot;
    for (let i = 0; i < count; i++) {
      const t = types[i] ?? 0;
      const m = matrices[t];
      const col = this.colors[t];
      if (!m || !col) continue;
      const n = counts[t] ?? 0;
      counts[t] = n + 1;

      const px = prevX[i] ?? 0;
      const pz = prevZ[i] ?? 0;
      const h = heading[i] ?? 0;
      const cos = Math.cos(h);
      const sin = Math.sin(h);
      const o = n * 16;
      // Column-major rotation about +Y by `h` (heading 0 faces +z), then translation.
      m[o] = cos;
      m[o + 1] = 0;
      m[o + 2] = -sin;
      m[o + 3] = 0;
      m[o + 4] = 0;
      m[o + 5] = 1;
      m[o + 6] = 0;
      m[o + 7] = 0;
      m[o + 8] = sin;
      m[o + 9] = 0;
      m[o + 10] = cos;
      m[o + 11] = 0;
      m[o + 12] = px + ((x[i] ?? 0) - px) * alpha;
      m[o + 13] = 0;
      m[o + 14] = pz + ((z[i] ?? 0) - pz) * alpha;
      m[o + 15] = 1;

      const rgb = (owners[i] ?? 0) * 3;
      const c = n * 3;
      col[c] = this.playerRgb[rgb] ?? 1;
      col[c + 1] = this.playerRgb[rgb + 1] ?? 1;
      col[c + 2] = this.playerRgb[rgb + 2] ?? 1;
    }
    this.meshes.forEach((mesh, t) => {
      mesh.count = counts[t] ?? 0;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    });
  }

  /** Releases GPU resources. */
  dispose(): void {
    for (const mesh of this.meshes) mesh.dispose();
    for (const g of this.geometries) g.dispose();
    this.material.dispose();
  }
}

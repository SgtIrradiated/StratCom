import {
  BoxGeometry,
  Color,
  DynamicDrawUsage,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  MeshStandardMaterial,
  type PerspectiveCamera,
} from "three";
import { EntityKind, sampleHeight, type SnapshotBuffers, type Terrain } from "@stratcom/sim";
import { HealthBars } from "./HealthBars";
import { IconLayer } from "./IconLayer";
import { SelectionRings } from "./SelectionRings";
import type { FeatureVisual, UnitVisual } from "./types";

/** Unfinished units are drawn this grey, blending to the owner's colour as they complete. */
const FRAME_GREY = 0.32;
/** Height of a site at 0 % progress, as a fraction of the finished height. */
const FRAME_MIN_HEIGHT = 0.12;

/**
 * Draws every unit and feature. Near the ground it uses one `InstancedMesh` per unit type
 * and per feature type (draw calls scale with types, not units, docs/PLAN.md §4.3); zoomed
 * out, the {@link IconLayer} takes over with a cross-fade (features get no icon). Selected
 * units get a ring, and damaged units a {@link HealthBars} bar. Unfinished units rise from a low grey frame as they are built; features
 * shrink as they are reclaimed. Per-instance data is written straight into the attribute
 * arrays each frame.
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
  private readonly icons: IconLayer;
  private readonly rings: SelectionRings;
  private readonly bars: HealthBars;
  private readonly playerRgb: Float32Array;
  private readonly featureRgb: Float32Array;

  constructor(
    private readonly visuals: readonly UnitVisual[],
    private readonly featureVisuals: readonly FeatureVisual[],
    playerColors: readonly string[],
    maxUnits: number,
    private readonly terrain: Terrain,
    selectionColor?: string,
  ) {
    this.playerRgb = new Float32Array(playerColors.length * 3);
    const c = new Color();
    playerColors.forEach((hex, slot) => {
      c.set(hex);
      this.playerRgb.set([c.r, c.g, c.b], slot * 3);
    });
    this.featureRgb = new Float32Array(featureVisuals.length * 3);
    featureVisuals.forEach((f, i) => {
      c.set(f.color);
      this.featureRgb.set([c.r, c.g, c.b], i * 3);
    });

    // Unit types first, then feature types: mesh index = type, or units + feature type.
    const sizes = [...visuals.map((v) => v.size), ...featureVisuals.map((f) => f.size)];
    this.meshes = sizes.map((size) => {
      const geometry = new BoxGeometry(...size);
      geometry.translate(0, size[1] / 2, 0);
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
    this.icons = new IconLayer(visuals, maxUnits);
    this.rings = new SelectionRings(maxUnits, selectionColor);
    this.bars = new HealthBars(maxUnits);
    this.group.add(this.icons.group, this.rings.mesh, this.bars.mesh);
  }

  /**
   * Rewrites all instance data from `snapshot`, interpolated by `alpha`. `blend` is the
   * strategic-zoom factor: 0 draws models only, 1 icons only.
   */
  update(
    snapshot: SnapshotBuffers,
    alpha: number,
    selected: ReadonlySet<number>,
    camera: PerspectiveCamera,
    blend: number,
  ): void {
    const counts = new Uint32Array(this.meshes.length);
    const matrices = this.meshes.map((m) => m.instanceMatrix.array as Float32Array);
    const drawModels = blend < 1;
    const drawIcons = blend > 0;
    const { count, ids, kinds, types, owners, prevX, prevZ, x, z, heading, progress, health } =
      snapshot;
    this.icons.begin(camera);
    this.rings.begin();
    this.bars.begin(camera);

    for (let i = 0; i < count; i++) {
      const t = types[i] ?? 0;
      const isFeature = kinds[i] === EntityKind.feature;
      const visual = isFeature ? undefined : this.visuals[t];
      if (!visual && !(isFeature && this.featureVisuals[t])) continue;
      const mesh = isFeature ? this.visuals.length + t : t;
      const px = prevX[i] ?? 0;
      const pz = prevZ[i] ?? 0;
      const ux = px + ((x[i] ?? 0) - px) * alpha;
      const uz = pz + ((z[i] ?? 0) - pz) * alpha;
      const uy = sampleHeight(this.terrain, ux, uz);
      const done = progress[i] ?? 1;
      const palette = isFeature ? this.featureRgb : this.playerRgb;
      const rgb = (isFeature ? t : (owners[i] ?? 0)) * 3;
      // Unfinished units blend from grey to their owner's colour.
      const tint = isFeature || done >= 1 ? 1 : done * 0.6;
      const r = FRAME_GREY + ((palette[rgb] ?? 1) - FRAME_GREY) * tint;
      const g = FRAME_GREY + ((palette[rgb + 1] ?? 1) - FRAME_GREY) * tint;
      const b = FRAME_GREY + ((palette[rgb + 2] ?? 1) - FRAME_GREY) * tint;
      // Sites rise as they are built; debris flattens as it is reclaimed.
      const sy = isFeature
        ? 0.35 + 0.65 * done
        : done >= 1
          ? 1
          : FRAME_MIN_HEIGHT + (1 - FRAME_MIN_HEIGHT) * done;
      const isSelected = selected.has(ids[i] ?? 0);

      if (drawModels) {
        const m = matrices[mesh];
        const col = this.colors[mesh];
        if (m && col) {
          const n = counts[mesh] ?? 0;
          counts[mesh] = n + 1;
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
          m[o + 5] = sy;
          m[o + 6] = 0;
          m[o + 7] = 0;
          m[o + 8] = sin;
          m[o + 9] = 0;
          m[o + 10] = cos;
          m[o + 11] = 0;
          m[o + 12] = ux;
          m[o + 13] = uy;
          m[o + 14] = uz;
          m[o + 15] = 1;
          const c = n * 3;
          col[c] = r;
          col[c + 1] = g;
          col[c + 2] = b;
        }
        if (isSelected && visual) this.rings.add(ux, uy, uz, visual.radius * 2);
        // Sites show their build progress instead; only finished units get a bar.
        const hp = health[i] ?? 1;
        if (visual && done >= 1 && hp < 1) {
          this.bars.add(ux, uy + visual.size[1], uz, Math.max(visual.radius * 2, 3), hp);
        }
      }
      if (drawIcons && !isFeature) this.icons.add(t, ux, uy, uz, r, g, b, isSelected);
    }

    this.meshes.forEach((mesh, t) => {
      mesh.count = counts[t] ?? 0;
      mesh.visible = drawModels;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    });
    // Models fade out as icons fade in; transparency is only enabled mid-fade so the
    // common cases keep opaque, depth-sorted rendering.
    this.material.opacity = 1 - blend;
    const fading = blend > 0 && blend < 1;
    if (this.material.transparent !== fading) {
      this.material.transparent = fading;
      this.material.needsUpdate = true;
    }
    this.icons.end(blend);
    this.rings.end(Math.max(0, 1 - blend * 2));
    this.bars.end(blend < 0.5);
  }

  /**
   * Screen position of every unit, in CSS pixels (`out[2i]`, `out[2i + 1]`). Uses the same
   * interpolation as {@link update}. Units behind the camera get NaN.
   */
  project(
    snapshot: SnapshotBuffers,
    alpha: number,
    camera: PerspectiveCamera,
    width: number,
    height: number,
    out: Float32Array,
  ): void {
    const m = camera.matrixWorldInverse.elements;
    const p = camera.projectionMatrix.elements;
    const { count, prevX, prevZ, x, z } = snapshot;
    for (let i = 0; i < count; i++) {
      const ax = prevX[i] ?? 0;
      const az = prevZ[i] ?? 0;
      const wx = ax + ((x[i] ?? 0) - ax) * alpha;
      const wz = az + ((z[i] ?? 0) - az) * alpha;
      const wy = sampleHeight(this.terrain, wx, wz) + 2;
      // View space.
      const vx = m[0] * wx + m[4] * wy + m[8] * wz + m[12];
      const vy = m[1] * wx + m[5] * wy + m[9] * wz + m[13];
      const vz = m[2] * wx + m[6] * wy + m[10] * wz + m[14];
      // Clip space.
      const cw = p[3] * vx + p[7] * vy + p[11] * vz + p[15];
      if (cw <= 0) {
        out[i * 2] = NaN;
        out[i * 2 + 1] = NaN;
        continue;
      }
      const cx = (p[0] * vx + p[4] * vy + p[8] * vz + p[12]) / cw;
      const cy = (p[1] * vx + p[5] * vy + p[9] * vz + p[13]) / cw;
      out[i * 2] = (cx * 0.5 + 0.5) * width;
      out[i * 2 + 1] = (1 - (cy * 0.5 + 0.5)) * height;
    }
  }

  /** Releases GPU resources. */
  dispose(): void {
    for (const mesh of this.meshes) mesh.dispose();
    for (const g of this.geometries) g.dispose();
    this.material.dispose();
    this.icons.dispose();
    this.rings.dispose();
    this.bars.dispose();
  }
}

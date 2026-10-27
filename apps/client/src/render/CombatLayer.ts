import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DynamicDrawUsage,
  Group,
  IcosahedronGeometry,
  InstancedBufferAttribute,
  InstancedMesh,
  LineBasicMaterial,
  LineSegments,
  MeshBasicMaterial,
} from "three";
import { sampleHeight, type SimEvent, type SnapshotBuffers, type Terrain } from "@stratcom/sim";
import type { WeaponKind } from "./types";

/** How long a beam or flame stays on screen, in milliseconds. */
const SHOT_MS = 160;
/** Most beams and flames drawn at once; older ones are dropped first. */
const MAX_SHOTS = 512;
/** Height shots leave from and arrive at, above the ground, in metres. */
const MUZZLE_HEIGHT = 2.5;
/** Arc height at mid-flight, in metres. */
const ARC: Record<WeaponKind, number> = { ballistic: 1.5, beam: 0, flame: 0, artillery: 45 };
const COLOR: Record<WeaponKind, string> = {
  ballistic: "#ffd27a",
  beam: "#8ff7ff",
  flame: "#ff8a2a",
  artillery: "#ffb347",
};

interface Shot {
  x: number;
  z: number;
  tx: number;
  tz: number;
  kind: WeaponKind;
  at: number;
}

/**
 * Placeholder weapon effects: a glowing dot per projectile in flight (artillery arcs high),
 * and a short-lived line for each instant hit (beams, flame). The look is M7's job; this
 * makes combat legible.
 */
export class CombatLayer {
  readonly group = new Group();
  private readonly projGeometry = new IcosahedronGeometry(0.45, 0);
  private readonly projMaterial = new MeshBasicMaterial({ color: "#ffffff" });
  private readonly projectiles: InstancedMesh;
  private readonly lineGeometry = new BufferGeometry();
  private readonly lineMaterial = new LineBasicMaterial({ vertexColors: true });
  private readonly lines: LineSegments;
  private readonly linePositions = new Float32Array(MAX_SHOTS * 6);
  private readonly lineColors = new Float32Array(MAX_SHOTS * 6);
  private readonly kindRgb = new Map<WeaponKind, Color>();
  private shots: Shot[] = [];

  /**
   * @param weaponKinds Kind of each weapon id; unknown weapons draw as ballistic.
   * @param capacity Most projectiles a snapshot can hold.
   */
  constructor(
    private readonly weaponKinds: readonly WeaponKind[],
    capacity: number,
    private readonly terrain: Terrain,
  ) {
    for (const [kind, hex] of Object.entries(COLOR)) {
      this.kindRgb.set(kind as WeaponKind, new Color(hex));
    }
    this.projectiles = new InstancedMesh(this.projGeometry, this.projMaterial, capacity);
    this.projectiles.instanceMatrix.setUsage(DynamicDrawUsage);
    this.projectiles.instanceColor = new InstancedBufferAttribute(
      new Float32Array(capacity * 3),
      3,
    );
    this.projectiles.frustumCulled = false;
    this.projectiles.count = 0;

    this.lineGeometry.setAttribute(
      "position",
      new BufferAttribute(this.linePositions, 3).setUsage(DynamicDrawUsage),
    );
    this.lineGeometry.setAttribute(
      "color",
      new BufferAttribute(this.lineColors, 3).setUsage(DynamicDrawUsage),
    );
    this.lines = new LineSegments(this.lineGeometry, this.lineMaterial);
    this.lines.frustumCulled = false;
    this.group.add(this.projectiles, this.lines);
  }

  /** Starts effects for the events of a new snapshot, received at `timeMs`. */
  addEvents(events: readonly SimEvent[], timeMs: number): void {
    for (const e of events) {
      if (e.t !== "fire") continue;
      const kind = this.kindOf(e.weapon);
      if (kind !== "beam" && kind !== "flame") continue;
      this.shots.push({ x: e.x, z: e.z, tx: e.tx, tz: e.tz, kind, at: timeMs });
    }
    if (this.shots.length > MAX_SHOTS) this.shots = this.shots.slice(-MAX_SHOTS);
  }

  /** Redraws projectiles from `snapshot` (interpolated by `alpha`) and fades the shots. */
  update(snapshot: SnapshotBuffers, alpha: number, timeMs: number): void {
    const n = snapshot.projectileCount;
    const m = this.projectiles.instanceMatrix.array as Float32Array;
    const col = (this.projectiles.instanceColor as InstancedBufferAttribute).array as Float32Array;
    for (let i = 0; i < n; i++) {
      const px = snapshot.projPrevX[i] ?? 0;
      const pz = snapshot.projPrevZ[i] ?? 0;
      const x = px + ((snapshot.projX[i] ?? 0) - px) * alpha;
      const z = pz + ((snapshot.projZ[i] ?? 0) - pz) * alpha;
      const t = snapshot.projT[i] ?? 0;
      const kind = this.kindOf(snapshot.projWeapon[i] ?? 0);
      const y = sampleHeight(this.terrain, x, z) + MUZZLE_HEIGHT + 4 * ARC[kind] * t * (1 - t);
      const o = i * 16;
      m.fill(0, o, o + 16);
      m[o] = m[o + 5] = m[o + 10] = m[o + 15] = 1;
      m[o + 12] = x;
      m[o + 13] = y;
      m[o + 14] = z;
      const c = this.kindRgb.get(kind);
      col[i * 3] = c?.r ?? 1;
      col[i * 3 + 1] = c?.g ?? 1;
      col[i * 3 + 2] = c?.b ?? 1;
    }
    this.projectiles.count = n;
    this.projectiles.instanceMatrix.needsUpdate = true;
    if (this.projectiles.instanceColor) this.projectiles.instanceColor.needsUpdate = true;

    this.shots = this.shots.filter((s) => timeMs - s.at < SHOT_MS);
    let k = 0;
    for (const s of this.shots) {
      const c = this.kindRgb.get(s.kind);
      const o = k * 6;
      this.linePositions[o] = s.x;
      this.linePositions[o + 1] = sampleHeight(this.terrain, s.x, s.z) + MUZZLE_HEIGHT;
      this.linePositions[o + 2] = s.z;
      this.linePositions[o + 3] = s.tx;
      this.linePositions[o + 4] = sampleHeight(this.terrain, s.tx, s.tz) + MUZZLE_HEIGHT * 0.5;
      this.linePositions[o + 5] = s.tz;
      for (let v = 0; v < 2; v++) {
        this.lineColors[o + v * 3] = c?.r ?? 1;
        this.lineColors[o + v * 3 + 1] = c?.g ?? 1;
        this.lineColors[o + v * 3 + 2] = c?.b ?? 1;
      }
      k++;
    }
    this.lineGeometry.setDrawRange(0, k * 2);
    (this.lineGeometry.getAttribute("position") as BufferAttribute).needsUpdate = true;
    (this.lineGeometry.getAttribute("color") as BufferAttribute).needsUpdate = true;
    this.lines.visible = k > 0;
  }

  dispose(): void {
    this.projectiles.dispose();
    this.projGeometry.dispose();
    this.projMaterial.dispose();
    this.lineGeometry.dispose();
    this.lineMaterial.dispose();
  }

  private kindOf(weapon: number): WeaponKind {
    return this.weaponKinds[weapon] ?? "ballistic";
  }
}

import { PerspectiveCamera, Vector3 } from "three";
import {
  raycastTerrain,
  sampleHeight,
  terrainDepth,
  terrainWidth,
  type Terrain,
} from "@stratcom/sim";
import type { CameraControl, GroundPoint } from "./types";

const MIN_DISTANCE = 60;
const MAX_DISTANCE = 3600;
const MIN_PITCH = (42 * Math.PI) / 180;
const MAX_PITCH = (78 * Math.PI) / 180;

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

/**
 * Orbit-style RTS camera: a ground target, a yaw, and a distance. The pitch steepens as the
 * camera zooms out, so the full-map view is nearly top-down.
 */
export class RtsCamera implements CameraControl {
  readonly camera = new PerspectiveCamera(45, 1, 2, 9000);
  readonly target: GroundPoint;
  private yaw = 0;
  private dist: number;
  private readonly scratch = new Vector3();

  constructor(private readonly terrain: Terrain) {
    this.target = { x: terrainWidth(terrain) / 2, z: terrainDepth(terrain) / 2 };
    this.dist = 1600;
    this.apply();
  }

  get distance(): number {
    return this.dist;
  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  pan(right: number, forward: number): void {
    const sin = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);
    // Forward on the ground is (sin yaw, cos yaw). three.js is right-handed with +y up, so
    // screen-right is forward × up = (-cos yaw, sin yaw): at yaw 0, +x is on the left.
    this.target.x += -right * cos + forward * sin;
    this.target.z += right * sin + forward * cos;
    this.apply();
  }

  rotate(radians: number): void {
    this.yaw += radians;
    this.apply();
  }

  focus(x: number, z: number): void {
    this.target.x = x;
    this.target.z = z;
    this.apply();
  }

  zoomAt(ndcX: number, ndcY: number, factor: number): void {
    const before = this.groundAt(ndcX, ndcY);
    this.dist = clamp(this.dist * factor, MIN_DISTANCE, MAX_DISTANCE);
    this.apply();
    const after = this.groundAt(ndcX, ndcY);
    if (before && after) {
      // Slide the target so the point under the cursor stays under the cursor.
      this.target.x += before.x - after.x;
      this.target.z += before.z - after.z;
      this.apply();
    }
  }

  /** Ground point under normalised device coordinates, or undefined if the ray misses. */
  groundAt(ndcX: number, ndcY: number): GroundPoint | undefined {
    const p = this.camera.position;
    const d = this.scratch.set(ndcX, ndcY, 0.5).unproject(this.camera).sub(p);
    const hit = raycastTerrain(this.terrain, [p.x, p.y, p.z], [d.x, d.y, d.z], 12000, 6);
    return hit ? { x: hit.x, z: hit.z } : undefined;
  }

  /** Recomputes the camera transform from target, yaw and distance. */
  private apply(): void {
    const w = terrainWidth(this.terrain);
    const h = terrainDepth(this.terrain);
    this.target.x = clamp(this.target.x, 0, w);
    this.target.z = clamp(this.target.z, 0, h);
    const t = clamp((this.dist - MIN_DISTANCE) / 2400, 0, 1);
    const pitch = MIN_PITCH + (MAX_PITCH - MIN_PITCH) * t;
    const ground = sampleHeight(this.terrain, this.target.x, this.target.z);
    const horizontal = Math.cos(pitch) * this.dist;
    this.camera.position.set(
      this.target.x - Math.sin(this.yaw) * horizontal,
      ground + Math.sin(pitch) * this.dist,
      this.target.z - Math.cos(this.yaw) * horizontal,
    );
    this.camera.lookAt(this.target.x, ground, this.target.z);
    this.camera.updateMatrixWorld();
  }
}

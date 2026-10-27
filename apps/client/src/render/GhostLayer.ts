import { BoxGeometry, Group, Mesh, MeshBasicMaterial, PlaneGeometry } from "three";
import { sampleHeight, type Terrain } from "@stratcom/sim";
import type { PlacementGhost } from "./types";

const VALID = "#5dff8a";
const INVALID = "#ff4a3a";

/** The translucent structure preview and its footprint outline while placing a building. */
export class GhostLayer {
  /** Add this to the scene. */
  readonly group = new Group();
  private readonly boxGeometry = new BoxGeometry(1, 1, 1);
  private readonly padGeometry = new PlaneGeometry(1, 1);
  // Not tone-mapped, so valid/invalid read as clear green and red.
  private readonly boxMaterial = new MeshBasicMaterial({
    toneMapped: false,
    transparent: true,
    opacity: 0.32,
    depthWrite: false,
  });
  private readonly padMaterial = new MeshBasicMaterial({
    toneMapped: false,
    transparent: true,
    opacity: 0.4,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -3,
    polygonOffsetUnits: -3,
  });
  private readonly box = new Mesh(this.boxGeometry, this.boxMaterial);
  private readonly pad = new Mesh(this.padGeometry, this.padMaterial);

  constructor(private readonly terrain: Terrain) {
    this.boxGeometry.translate(0, 0.5, 0);
    this.padGeometry.rotateX(-Math.PI / 2);
    this.group.add(this.pad, this.box);
    this.group.visible = false;
  }

  /** Shows `ghost`, or hides the preview. */
  set(ghost: PlacementGhost | undefined): void {
    this.group.visible = ghost !== undefined;
    if (!ghost) return;
    const y = sampleHeight(this.terrain, ghost.x, ghost.z);
    const color = ghost.valid ? VALID : INVALID;
    this.boxMaterial.color.set(color);
    this.padMaterial.color.set(color);
    this.box.position.set(ghost.x, y, ghost.z);
    this.box.rotation.y = ghost.heading;
    this.box.scale.set(...ghost.size);
    this.pad.position.set(ghost.x, y + 0.25, ghost.z);
    this.pad.scale.set(ghost.width, 1, ghost.depth);
  }

  /** Releases GPU resources. */
  dispose(): void {
    this.boxGeometry.dispose();
    this.padGeometry.dispose();
    this.boxMaterial.dispose();
    this.padMaterial.dispose();
  }
}

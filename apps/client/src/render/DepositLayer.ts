import {
  CircleGeometry,
  Group,
  InstancedMesh,
  MeshBasicMaterial,
  Object3D,
  RingGeometry,
} from "three";
import { sampleHeight, type Terrain } from "@stratcom/sim";
import type { GroundPoint } from "./types";

/** Deposit marker colour: oxidised brass, readable on both dust and ash. */
const DEPOSIT_COLOR = "#e0b048";
/** Marker radius in metres; about the size of a 2 × 2 extractor. */
const RADIUS = 7;

/**
 * Salvage deposits: a flat ring with a faint fill on the ground at each one. Static, so the
 * instance matrices are written once.
 */
export class DepositLayer {
  /** Add this to the scene. */
  readonly group = new Group();
  private readonly ring = new RingGeometry(RADIUS * 0.8, RADIUS, 32);
  private readonly disc = new CircleGeometry(RADIUS * 0.8, 32);
  private readonly ringMaterial = new MeshBasicMaterial({
    color: DEPOSIT_COLOR,
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  private readonly discMaterial = this.ringMaterial.clone();

  constructor(deposits: readonly GroundPoint[], terrain: Terrain) {
    this.discMaterial.opacity = 0.18;
    this.ring.rotateX(-Math.PI / 2);
    this.disc.rotateX(-Math.PI / 2);
    const count = Math.max(deposits.length, 1);
    const rings = new InstancedMesh(this.ring, this.ringMaterial, count);
    const discs = new InstancedMesh(this.disc, this.discMaterial, count);
    const o = new Object3D();
    deposits.forEach((d, i) => {
      o.position.set(d.x, sampleHeight(terrain, d.x, d.z) + 0.3, d.z);
      o.updateMatrix();
      rings.setMatrixAt(i, o.matrix);
      discs.setMatrixAt(i, o.matrix);
    });
    rings.count = discs.count = deposits.length;
    rings.frustumCulled = discs.frustumCulled = false;
    this.group.add(discs, rings);
  }

  /** Releases GPU resources. */
  dispose(): void {
    for (const child of this.group.children) (child as InstancedMesh).dispose();
    this.ring.dispose();
    this.disc.dispose();
    this.ringMaterial.dispose();
    this.discMaterial.dispose();
  }
}

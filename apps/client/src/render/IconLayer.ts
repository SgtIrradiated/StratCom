import type { BufferGeometry } from "three";
import {
  CircleGeometry,
  Color,
  DynamicDrawUsage,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  MeshBasicMaterial,
  PlaneGeometry,
  type PerspectiveCamera,
  Shape,
  ShapeGeometry,
} from "three";
import { commitInstances } from "./instancing";
import type { IconShape, UnitVisual } from "./types";

/** Icon size as a fraction of the distance to the camera (constant screen size). */
const SCREEN_SCALE = 0.011;

function shapeGeometry(shape: IconShape): BufferGeometry {
  switch (shape) {
    case "circle":
      return new CircleGeometry(1, 20);
    case "square":
      return new PlaneGeometry(1.8, 1.8);
    case "triangle": {
      const s = new Shape();
      s.moveTo(0, 1.2).lineTo(1.1, -0.9).lineTo(-1.1, -0.9).closePath();
      return new ShapeGeometry(s);
    }
    case "diamond": {
      const s = new Shape();
      s.moveTo(0, 1.3).lineTo(1.3, 0).lineTo(0, -1.3).lineTo(-1.3, 0).closePath();
      return new ShapeGeometry(s);
    }
    case "star":
      // Commanders: larger than everything else so they are easy to find.
      return polygonGeometry(10, (i) => (i % 2 === 0 ? 2 : 0.85));
    case "hexagon":
      return polygonGeometry(6, () => 1.35);
  }
}

/** A closed polygon with `n` vertices, the first pointing up, at radius `radius(i)`. */
function polygonGeometry(n: number, radius: (i: number) => number): BufferGeometry {
  const s = new Shape();
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const r = radius(i);
    if (i === 0) s.moveTo(Math.sin(a) * r, Math.cos(a) * r);
    else s.lineTo(Math.sin(a) * r, Math.cos(a) * r);
  }
  s.closePath();
  return new ShapeGeometry(s);
}

/**
 * Strategic-zoom icons: one camera-facing `InstancedMesh` per unit type, sized to a constant
 * screen footprint, tinted with the owner's colour. Drawn without depth testing so they stay
 * readable over terrain. The minimap will read the same data in M5.
 */
export class IconLayer {
  readonly group = new Group();
  private readonly meshes: InstancedMesh[];
  private readonly matrices: Float32Array[];
  private readonly colors: Float32Array[];
  private readonly geometries: BufferGeometry[];
  private readonly material = new MeshBasicMaterial({
    color: "#ffffff",
    transparent: true,
    depthTest: false,
  });
  private counts: Uint32Array;
  private right = [1, 0, 0];
  private up = [0, 1, 0];
  private back = [0, 0, 1];
  private camPos = [0, 0, 0];
  private readonly tint = new Color();

  constructor(visuals: readonly UnitVisual[], maxUnits: number) {
    this.counts = new Uint32Array(visuals.length);
    this.geometries = visuals.map((v) => shapeGeometry(v.icon));
    this.meshes = visuals.map((_, t) => {
      const mesh = new InstancedMesh(this.geometries[t], this.material, maxUnits);
      mesh.instanceMatrix.setUsage(DynamicDrawUsage);
      mesh.instanceColor = new InstancedBufferAttribute(new Float32Array(maxUnits * 3), 3);
      mesh.instanceColor.setUsage(DynamicDrawUsage);
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.renderOrder = 10;
      this.group.add(mesh);
      return mesh;
    });
    this.matrices = this.meshes.map((m) => m.instanceMatrix.array as Float32Array);
    this.colors = this.meshes.map(
      (m) => (m.instanceColor as InstancedBufferAttribute).array as Float32Array,
    );
    this.group.visible = false;
  }

  /** Starts a frame: captures the camera basis used to face every icon toward it. */
  begin(camera: PerspectiveCamera): void {
    const e = camera.matrixWorld.elements;
    this.right = [e[0], e[1], e[2]];
    this.up = [e[4], e[5], e[6]];
    this.back = [e[8], e[9], e[10]];
    this.camPos = [e[12], e[13], e[14]];
    this.counts.fill(0);
  }

  /** Adds one icon. `highlight` brightens it (selected units). */
  add(
    type: number,
    x: number,
    y: number,
    z: number,
    r: number,
    g: number,
    b: number,
    highlight: boolean,
  ): void {
    const m = this.matrices[type];
    const col = this.colors[type];
    if (!m || !col) return;
    const n = this.counts[type] ?? 0;
    this.counts[type] = n + 1;
    const dx = x - (this.camPos[0] ?? 0);
    const dy = y - (this.camPos[1] ?? 0);
    const dz = z - (this.camPos[2] ?? 0);
    const s = Math.sqrt(dx * dx + dy * dy + dz * dz) * SCREEN_SCALE;
    const o = n * 16;
    const [rx = 1, ry = 0, rz = 0] = this.right;
    const [ux = 0, uy = 1, uz = 0] = this.up;
    const [bx = 0, by = 0, bz = 1] = this.back;
    m[o] = rx * s;
    m[o + 1] = ry * s;
    m[o + 2] = rz * s;
    m[o + 3] = 0;
    m[o + 4] = ux * s;
    m[o + 5] = uy * s;
    m[o + 6] = uz * s;
    m[o + 7] = 0;
    m[o + 8] = bx * s;
    m[o + 9] = by * s;
    m[o + 10] = bz * s;
    m[o + 11] = 0;
    m[o + 12] = x;
    m[o + 13] = y + 2;
    m[o + 14] = z;
    m[o + 15] = 1;
    if (highlight) this.tint.setRGB(r, g, b).lerp(WHITE, 0.65);
    else this.tint.setRGB(r, g, b);
    const c = n * 3;
    col[c] = this.tint.r;
    col[c + 1] = this.tint.g;
    col[c + 2] = this.tint.b;
  }

  /** Finishes the frame; `opacity` of 0 hides the layer. */
  end(opacity: number): void {
    this.group.visible = opacity > 0;
    this.material.opacity = opacity;
    this.meshes.forEach((mesh, t) => {
      commitInstances(mesh, this.counts[t] ?? 0);
    });
  }

  /** Releases GPU resources. */
  dispose(): void {
    for (const mesh of this.meshes) mesh.dispose();
    for (const g of this.geometries) g.dispose();
    this.material.dispose();
  }
}

const WHITE = new Color(1, 1, 1);

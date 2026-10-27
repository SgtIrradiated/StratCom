import {
  BufferAttribute,
  BufferGeometry,
  DataTexture,
  Group,
  LinearFilter,
  Mesh,
  MeshStandardMaterial,
  RedFormat,
  UnsignedByteType,
  Vector2,
  type Vector3,
} from "three";
import { Fog, VISION_CELL, sampleHeight, visionGrid, type Terrain } from "@stratcom/sim";

/** Cells per chunk side at full detail. */
const CHUNK_CELLS = 32;
/** Cell step per LOD level (1 = every cell). */
const LOD_STEPS = [1, 2, 4, 8] as const;
/** Camera distance (m) beyond which a chunk drops to the next LOD level. */
const LOD_DISTANCES = [500, 1100, 2200] as const;

/** Ground brightness under fog (0–255), by `Fog` state. */
const FOG_LIGHT = [60, 140, 255] as const;

/** Wasteland palette blended by height and slope: a poor man's splat map until real textures. */
const LOW = [0.55, 0.47, 0.33] as const; // dust
const MID = [0.43, 0.36, 0.25] as const; // dry earth
const HIGH = [0.42, 0.4, 0.36] as const; // pale rock
const STEEP = [0.29, 0.27, 0.24] as const; // dark rock

const smoothstep = (a: number, b: number, x: number): number => {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
};

/**
 * Chunked heightmap mesh with distance-based LOD. Each chunk keeps one lazily built
 * geometry per LOD level. Edges carry downward skirts, which hide the cracks that appear
 * where neighbouring chunks use different levels. Colours are baked per vertex from height
 * and slope. Fog of war darkens the ground through a small texture of the vision grid,
 * sampled in the fragment shader.
 */
export class TerrainLayer {
  readonly group = new Group();
  private readonly material = new MeshStandardMaterial({
    vertexColors: true,
    roughness: 1,
  });
  private readonly chunks: {
    mesh: Mesh;
    cx: number;
    cz: number;
    centreX: number;
    centreZ: number;
    level: number;
    geometries: (BufferGeometry | undefined)[];
  }[] = [];
  private readonly minH: number;
  private readonly maxH: number;
  private readonly fogData: Uint8Array;
  private readonly fogTexture: DataTexture;

  constructor(private readonly terrain: Terrain) {
    const grid = visionGrid(terrain);
    this.fogData = new Uint8Array(grid.cols * grid.rows).fill(255);
    this.fogTexture = new DataTexture(
      this.fogData,
      grid.cols,
      grid.rows,
      RedFormat,
      UnsignedByteType,
    );
    this.fogTexture.magFilter = LinearFilter;
    this.fogTexture.minFilter = LinearFilter;
    this.fogTexture.needsUpdate = true;
    const fogSize = new Vector2(grid.cols * VISION_CELL, grid.rows * VISION_CELL);
    this.material.onBeforeCompile = (shader) => {
      shader.uniforms["fogMap"] = { value: this.fogTexture };
      shader.uniforms["fogSize"] = { value: fogSize };
      shader.vertexShader =
        "uniform vec2 fogSize;\nvarying vec2 vFogUv;\n" +
        shader.vertexShader.replace(
          "#include <begin_vertex>",
          "#include <begin_vertex>\nvFogUv = (modelMatrix * vec4(transformed, 1.0)).xz / fogSize;",
        );
      shader.fragmentShader =
        "uniform sampler2D fogMap;\nvarying vec2 vFogUv;\n" +
        shader.fragmentShader.replace(
          "#include <color_fragment>",
          "#include <color_fragment>\ndiffuseColor.rgb *= texture2D(fogMap, vFogUv).r;",
        );
    };

    let lo = Infinity;
    let hi = -Infinity;
    for (const h of terrain.heights) {
      lo = Math.min(lo, h);
      hi = Math.max(hi, h);
    }
    this.minH = lo;
    this.maxH = hi;
    const nx = Math.ceil((terrain.cols - 1) / CHUNK_CELLS);
    const nz = Math.ceil((terrain.rows - 1) / CHUNK_CELLS);
    for (let cz = 0; cz < nz; cz++) {
      for (let cx = 0; cx < nx; cx++) {
        const mesh = new Mesh(undefined, this.material);
        mesh.frustumCulled = true;
        this.group.add(mesh);
        this.chunks.push({
          mesh,
          cx,
          cz,
          centreX: (cx + 0.5) * CHUNK_CELLS * terrain.cellSize,
          centreZ: (cz + 0.5) * CHUNK_CELLS * terrain.cellSize,
          level: -1,
          geometries: [],
        });
      }
    }
  }

  /** Picks each chunk's LOD level for a camera at `cameraPosition`. */
  update(cameraPosition: Vector3): void {
    for (const chunk of this.chunks) {
      const dx = chunk.centreX - cameraPosition.x;
      const dz = chunk.centreZ - cameraPosition.z;
      const d = Math.sqrt(dx * dx + dz * dz + cameraPosition.y * cameraPosition.y);
      let level = 0;
      while (level < LOD_DISTANCES.length && d > (LOD_DISTANCES[level] ?? Infinity)) level++;
      if (level === chunk.level) continue;
      chunk.level = level;
      chunk.geometries[level] ??= this.buildGeometry(chunk.cx, chunk.cz, LOD_STEPS[level] ?? 1);
      const geometry = chunk.geometries[level];
      if (geometry) chunk.mesh.geometry = geometry;
    }
  }

  /**
   * Shades the ground by fog of war: `grid` holds `Fog` states for one team (`offset` is
   * where that team's cells start), or undefined to light everything.
   */
  setFog(grid: Uint8Array | undefined, offset = 0): void {
    const data = this.fogData;
    for (let k = 0; k < data.length; k++) {
      const state = grid ? (grid[offset + k] ?? Fog.unexplored) : Fog.visible;
      data[k] = FOG_LIGHT[state] ?? 255;
    }
    this.fogTexture.needsUpdate = true;
  }

  /** Releases GPU resources. */
  dispose(): void {
    for (const chunk of this.chunks) for (const g of chunk.geometries) g?.dispose();
    this.material.dispose();
    this.fogTexture.dispose();
  }

  private buildGeometry(cx: number, cz: number, step: number): BufferGeometry {
    const t = this.terrain;
    const c0 = cx * CHUNK_CELLS;
    const r0 = cz * CHUNK_CELLS;
    const c1 = Math.min(c0 + CHUNK_CELLS, t.cols - 1);
    const r1 = Math.min(r0 + CHUNK_CELLS, t.rows - 1);
    const nCols = Math.ceil((c1 - c0) / step) + 1;
    const nRows = Math.ceil((r1 - r0) / step) + 1;
    const skirt = 4 * step + 2;

    const positions: number[] = [];
    const colors: number[] = [];
    const normals: number[] = [];
    const vertexAt = (c: number, r: number, drop: number): void => {
      const x = c * t.cellSize;
      const z = r * t.cellSize;
      const y = sampleHeight(t, x, z);
      // Central-difference normal from the full-resolution heightmap.
      const e = t.cellSize;
      const nxv = sampleHeight(t, x - e, z) - sampleHeight(t, x + e, z);
      const nzv = sampleHeight(t, x, z - e) - sampleHeight(t, x, z + e);
      const len = Math.sqrt(nxv * nxv + 4 * e * e + nzv * nzv);
      const ny = (2 * e) / len;
      positions.push(x, y - drop, z);
      normals.push(nxv / len, ny, nzv / len);
      const rock = smoothstep(0.12, 0.4, 1 - ny);
      const h = smoothstep(0.15, 0.95, (y - this.minH) / Math.max(this.maxH - this.minH, 1));
      // Cheap deterministic speckle so large flat areas don't look like plastic.
      const speckle = 0.94 + 0.12 * ((Math.imul(c * 73856093, r * 19349663 + 1) >>> 8) / 0xffffff);
      for (let k = 0; k < 3; k++) {
        const low = LOW[k] ?? 0;
        const mid = MID[k] ?? 0;
        const high = HIGH[k] ?? 0;
        const steep = STEEP[k] ?? 0;
        const base = h < 0.5 ? low + (mid - low) * (h * 2) : mid + (high - mid) * ((h - 0.5) * 2);
        colors.push((base + (steep - base) * rock) * speckle);
      }
    };

    const gridC = (i: number): number => Math.min(c0 + i * step, c1);
    const gridR = (j: number): number => Math.min(r0 + j * step, r1);
    for (let j = 0; j < nRows; j++) for (let i = 0; i < nCols; i++) vertexAt(gridC(i), gridR(j), 0);

    const indices: number[] = [];
    for (let j = 0; j < nRows - 1; j++) {
      for (let i = 0; i < nCols - 1; i++) {
        const a = j * nCols + i;
        indices.push(a, a + nCols, a + 1, a + 1, a + nCols, a + nCols + 1);
      }
    }

    // Skirts: duplicate each border vertex lower down and stitch a strip.
    const addSkirt = (border: number[]): void => {
      const base = positions.length / 3;
      for (const v of border) {
        const x = positions[v * 3] ?? 0;
        const y = positions[v * 3 + 1] ?? 0;
        const z = positions[v * 3 + 2] ?? 0;
        positions.push(x, y - skirt, z);
        normals.push(normals[v * 3] ?? 0, normals[v * 3 + 1] ?? 1, normals[v * 3 + 2] ?? 0);
        colors.push(colors[v * 3] ?? 0, colors[v * 3 + 1] ?? 0, colors[v * 3 + 2] ?? 0);
      }
      for (let k = 0; k < border.length - 1; k++) {
        const a = border[k] ?? 0;
        const b = border[k + 1] ?? 0;
        const a2 = base + k;
        const b2 = base + k + 1;
        // Both windings, so the skirt is lit correctly from either side with a front-face
        // material (back faces would get flipped, dark normals).
        indices.push(a, a2, b, b, a2, b2, a, b, a2, b, b2, a2);
      }
    };
    const top: number[] = [];
    const bottom: number[] = [];
    const left: number[] = [];
    const right: number[] = [];
    for (let i = 0; i < nCols; i++) {
      top.push(i);
      bottom.push((nRows - 1) * nCols + i);
    }
    for (let j = 0; j < nRows; j++) {
      left.push(j * nCols);
      right.push(j * nCols + nCols - 1);
    }
    addSkirt(top);
    addSkirt(bottom);
    addSkirt(left);
    addSkirt(right);

    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(new Float32Array(positions), 3));
    geometry.setAttribute("normal", new BufferAttribute(new Float32Array(normals), 3));
    geometry.setAttribute("color", new BufferAttribute(new Float32Array(colors), 3));
    geometry.setIndex(indices);
    geometry.computeBoundingSphere();
    geometry.computeBoundingBox();
    return geometry;
  }
}

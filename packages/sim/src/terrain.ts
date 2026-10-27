import { assert } from "@stratcom/shared";

/**
 * Heightmap terrain. Vertices form a `cols × rows` grid spaced `cellSize` metres apart;
 * the playable area is `(cols - 1) × (rows - 1)` cells. `heights` is row-major
 * (`index = row * cols + col`), with x along columns and z along rows.
 */
export interface Terrain {
  cols: number;
  rows: number;
  cellSize: number;
  heights: Float32Array;
}

/** Width of the terrain in metres (x extent). */
export function terrainWidth(t: Terrain): number {
  return (t.cols - 1) * t.cellSize;
}

/** Depth of the terrain in metres (z extent). */
export function terrainDepth(t: Terrain): number {
  return (t.rows - 1) * t.cellSize;
}

/** Parameters for {@link generateTerrain}. */
export interface TerrainParams {
  seed: number;
  /** Number of cells along each side. */
  cells: number;
  cellSize: number;
  /** Peak-to-trough height scale in metres. */
  amplitude: number;
  /** Wavelength of the lowest-frequency octave, in metres. */
  wavelength: number;
}

/** Integer lattice hash to [0, 1). Pure 32-bit integer maths. */
function lattice(ix: number, iz: number, seed: number): number {
  let h = Math.imul(ix, 0x27d4eb2d) ^ Math.imul(iz, 0x165667b1) ^ Math.imul(seed, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 0x1_0000_0000;
}

function valueNoise(x: number, z: number, seed: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const sx = fx * fx * (3 - 2 * fx);
  const sz = fz * fz * (3 - 2 * fz);
  const a = lattice(ix, iz, seed);
  const b = lattice(ix + 1, iz, seed);
  const c = lattice(ix, iz + 1, seed);
  const d = lattice(ix + 1, iz + 1, seed);
  const top = a + (b - a) * sx;
  const bottom = c + (d - c) * sx;
  return top + (bottom - top) * sz;
}

/**
 * Generates a deterministic rolling-hills heightmap from fractal value noise. Uses only
 * integer hashing and `+ - *`, so every engine produces identical heights.
 */
export function generateTerrain(p: TerrainParams): Terrain {
  assert(p.cells >= 2 && p.cellSize > 0, "invalid terrain parameters");
  const cols = p.cells + 1;
  const heights = new Float32Array(cols * cols);
  for (let r = 0; r < cols; r++) {
    for (let c = 0; c < cols; c++) {
      let sum = 0;
      let amp = 1;
      let total = 0;
      let freq = 1 / p.wavelength;
      for (let o = 0; o < 4; o++) {
        sum += amp * valueNoise(c * p.cellSize * freq, r * p.cellSize * freq, p.seed + o * 101);
        total += amp;
        amp *= 0.5;
        freq *= 2;
      }
      heights[r * cols + c] = Math.fround((sum / total) * p.amplitude);
    }
  }
  return { cols, rows: cols, cellSize: p.cellSize, heights };
}

/** Bilinearly interpolated ground height at (`x`, `z`). Positions are clamped to the map. */
export function sampleHeight(t: Terrain, x: number, z: number): number {
  const gx = Math.min(Math.max(x / t.cellSize, 0), t.cols - 1);
  const gz = Math.min(Math.max(z / t.cellSize, 0), t.rows - 1);
  const c0 = Math.min(Math.floor(gx), t.cols - 2);
  const r0 = Math.min(Math.floor(gz), t.rows - 2);
  const fx = gx - c0;
  const fz = gz - r0;
  const i = r0 * t.cols + c0;
  const h = t.heights;
  const h00 = h[i] ?? 0;
  const h10 = h[i + 1] ?? 0;
  const h01 = h[i + t.cols] ?? 0;
  const h11 = h[i + t.cols + 1] ?? 0;
  const top = h00 + (h10 - h00) * fx;
  const bottom = h01 + (h11 - h01) * fx;
  return top + (bottom - top) * fz;
}

/**
 * Finds where a ray first meets the ground by marching in `step`-metre increments and then
 * bisecting. Returns undefined if it never goes below the terrain within `maxDistance`.
 * Direction need not be normalised.
 */
export function raycastTerrain(
  t: Terrain,
  origin: readonly [number, number, number],
  dir: readonly [number, number, number],
  maxDistance: number,
  step = 4,
): { x: number; y: number; z: number } | undefined {
  const len = Math.sqrt(dir[0] * dir[0] + dir[1] * dir[1] + dir[2] * dir[2]);
  if (len === 0) return undefined;
  const dx = dir[0] / len;
  const dy = dir[1] / len;
  const dz = dir[2] / len;
  const below = (d: number): boolean =>
    origin[1] + dy * d < sampleHeight(t, origin[0] + dx * d, origin[2] + dz * d);
  let prev = 0;
  for (let d = step; d <= maxDistance; d += step) {
    if (below(d)) {
      let lo = prev;
      let hi = d;
      for (let k = 0; k < 12; k++) {
        const mid = (lo + hi) / 2;
        if (below(mid)) hi = mid;
        else lo = mid;
      }
      return { x: origin[0] + dx * hi, y: origin[1] + dy * hi, z: origin[2] + dz * hi };
    }
    prev = d;
  }
  return undefined;
}

import { buildNavGrid, type Terrain } from "@stratcom/sim";

/** `#rrggbb` to its red, green and blue components. */
export function rgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * Paints a top-down, hill-shaded picture of `t` into a `size` × `size` image, in the UI's
 * `phosphor` colour, with ground steeper than `maxSlope` hatched dark. Oriented like the
 * default in-game camera (yaw 0): +z up the image, +x to the left. Used by the map preview
 * and the minimap.
 */
export function shadeTerrain(
  img: ImageData,
  t: Terrain,
  size: number,
  phosphor: string,
  maxSlope: number,
): void {
  const nav = buildNavGrid(t, maxSlope);
  const [pr, pg, pb] = rgb(phosphor);
  let lo = Infinity;
  let hi = -Infinity;
  for (const h of t.heights) {
    lo = Math.min(lo, h);
    hi = Math.max(hi, h);
  }
  const range = Math.max(hi - lo, 1);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const c = Math.min(Math.floor(((size - 1 - x) / size) * (t.cols - 1)), t.cols - 2);
      const r = Math.min(Math.floor(((size - 1 - y) / size) * (t.rows - 1)), t.rows - 2);
      const i = r * t.cols + c;
      const h = t.heights[i] ?? 0;
      // Light from the top-left of the image: brighter on slopes that face it.
      const shade = ((t.heights[i - 1] ?? h) - (t.heights[i + t.cols] ?? h)) / t.cellSize;
      const height = (h - lo) / range;
      let k = 0.18 + height * 0.45 - shade * 0.9;
      if (nav.passable[r * nav.cols + c] === 0) k *= (x + y) % 4 < 2 ? 0.25 : 0.45;
      k = Math.min(Math.max(k, 0.04), 1);
      const o = (y * size + x) * 4;
      img.data[o] = pr * k;
      img.data[o + 1] = pg * k;
      img.data[o + 2] = pb * k;
      img.data[o + 3] = 255;
    }
  }
}

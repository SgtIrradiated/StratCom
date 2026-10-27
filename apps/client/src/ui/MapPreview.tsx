import type { MapDef } from "@stratcom/data";
import { buildNavGrid, generateMapTerrain, type Terrain } from "@stratcom/sim";
import type { JSX } from "preact";
import { useEffect, useRef } from "preact/hooks";

/** Preview resolution in pixels per side. */
const SIZE = 256;

/** Generated terrain per map id; maps are pure functions of their definition. */
const terrainCache = new Map<string, Terrain>();

function terrainOf(map: MapDef): Terrain {
  let t = terrainCache.get(map.id);
  if (!t) {
    t = generateMapTerrain(map);
    terrainCache.set(map.id, t);
  }
  return t;
}

function rgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** A start-position marker: its slot colour, or undefined for a closed slot. */
export interface PreviewMarker {
  color: string | undefined;
}

/**
 * Top-down map preview drawn from the real generated heightmap: hill-shaded in the UI's
 * phosphor colour, with impassable slopes hatched dark and numbered start positions. It is
 * oriented exactly like the default in-game camera, so "top-left" means the same thing in
 * both.
 */
export function MapPreview(props: {
  map: MapDef;
  markers: readonly PreviewMarker[];
  phosphor: string;
  /** Movement class whose impassable ground is darkened. */
  maxSlope: number;
}): JSX.Element {
  const ref = useRef<HTMLCanvasElement>(null);
  const { map, markers, phosphor, maxSlope } = props;

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const t = terrainOf(map);
    const nav = buildNavGrid(t, maxSlope);
    const img = ctx.createImageData(SIZE, SIZE);
    const [pr, pg, pb] = rgb(phosphor);
    let lo = Infinity;
    let hi = -Infinity;
    for (const h of t.heights) {
      lo = Math.min(lo, h);
      hi = Math.max(hi, h);
    }
    const range = Math.max(hi - lo, 1);
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        // Oriented like the default in-game camera (yaw 0): +z up the screen, +x to the left.
        const c = Math.min(Math.floor(((SIZE - 1 - x) / SIZE) * (t.cols - 1)), t.cols - 2);
        const r = Math.min(Math.floor(((SIZE - 1 - y) / SIZE) * (t.rows - 1)), t.rows - 2);
        const i = r * t.cols + c;
        const h = t.heights[i] ?? 0;
        // Light from the top-left of the preview: brighter on slopes that face it.
        const shade = ((t.heights[i - 1] ?? h) - (t.heights[i + t.cols] ?? h)) / t.cellSize;
        const height = (h - lo) / range;
        let k = 0.18 + height * 0.45 - shade * 0.9;
        if (nav.passable[r * nav.cols + c] === 0) k *= (x + y) % 4 < 2 ? 0.25 : 0.45;
        k = Math.min(Math.max(k, 0.04), 1);
        const o = (y * SIZE + x) * 4;
        img.data[o] = pr * k;
        img.data[o + 1] = pg * k;
        img.data[o + 2] = pb * k;
        img.data[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);

    ctx.font = "bold 13px 'Share Tech Mono', monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    map.startPositions.forEach((s, i) => {
      const color = markers[i]?.color;
      const x = (1 - s.x) * SIZE;
      const y = (1 - s.z) * SIZE;
      ctx.beginPath();
      ctx.arc(x, y, 10, 0, Math.PI * 2);
      ctx.fillStyle = color ?? "rgba(0,0,0,0.6)";
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = color ? "#000" : phosphor;
      ctx.stroke();
      ctx.fillStyle = color ? "#000" : phosphor;
      ctx.fillText(String(i + 1), x, y + 1);
    });
  }, [map, markers, phosphor, maxSlope]);

  return (
    <canvas
      ref={ref}
      class="map-preview"
      width={SIZE}
      height={SIZE}
      role="img"
      aria-label={`${map.name}: ${map.startPositions.length} start positions`}
    />
  );
}

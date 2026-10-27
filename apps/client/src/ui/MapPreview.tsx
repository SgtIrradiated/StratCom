import type { MapDef } from "@stratcom/data";
import { generateMapTerrain, type Terrain } from "@stratcom/sim";
import type { JSX } from "preact";
import { useEffect, useRef } from "preact/hooks";
import { shadeTerrain } from "./terrainShade";

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
    const img = ctx.createImageData(SIZE, SIZE);
    shadeTerrain(img, terrainOf(map), SIZE, phosphor, maxSlope);
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

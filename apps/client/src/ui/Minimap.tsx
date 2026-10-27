import { EntityKind, Fog, VISION_CELL, terrainDepth, terrainWidth } from "@stratcom/sim";
import type { JSX } from "preact";
import { useEffect, useMemo, useRef } from "preact/hooks";
import type { GameSession } from "../game/GameSession";
import { shadeTerrain } from "./terrainShade";

/** Minimap resolution in pixels per side. */
const SIZE = 200;
/** Fog over the map: black at this opacity, by `Fog` state. */
const FOG_ALPHA = [0.82, 0.45, 0] as const;

/**
 * The minimap: the hill-shaded map in the faction's phosphor colour, fog of war, a dot per
 * unit the player can see, and the camera's view. Left click (or drag) moves the camera;
 * right click orders the selection there, like a right click on open ground. Oriented like
 * the default camera and the map preview: +z up, +x to the left.
 */
export function Minimap(props: {
  session: GameSession;
  phosphor: string;
  /** Movement class whose impassable ground is hatched. */
  maxSlope: number;
  /** CSS colour per player slot. */
  playerColors: readonly (string | undefined)[];
}): JSX.Element {
  const { session, phosphor, maxSlope, playerColors } = props;
  const terrain = session.terrain;
  const ref = useRef<HTMLCanvasElement>(null);
  const dragging = useRef(false);
  const width = terrainWidth(terrain);
  const depth = terrainDepth(terrain);
  const toPx = (x: number, z: number): [number, number] => [
    (1 - x / width) * SIZE,
    (1 - z / depth) * SIZE,
  ];
  const toGround = (e: MouseEvent): { x: number; z: number } => {
    const r = (e.currentTarget as HTMLCanvasElement).getBoundingClientRect();
    return {
      x: (1 - (e.clientX - r.left) / r.width) * width,
      z: (1 - (e.clientY - r.top) / r.height) * depth,
    };
  };

  const base = useMemo(() => {
    const img = new ImageData(SIZE, SIZE);
    shadeTerrain(img, terrain, SIZE, phosphor, maxSlope);
    return img;
  }, [terrain, phosphor, maxSlope]);

  // Redrawn on every HUD refresh.
  useEffect(() => {
    const ctx = ref.current?.getContext("2d");
    if (!ctx) return;
    ctx.putImageData(base, 0, 0);
    const view = session.view;
    const team = session.viewTeam;
    if (view && team !== undefined && view.visionCols > 0) {
      const cells = view.visionCols * view.visionRows;
      const offset = team * cells;
      for (let r = 0; r < view.visionRows; r++) {
        for (let c = 0; c < view.visionCols; c++) {
          const state = view.vision[offset + r * view.visionCols + c] ?? Fog.unexplored;
          const alpha = FOG_ALPHA[state as 0 | 1 | 2];
          if (alpha === 0) continue;
          const [x0, y0] = toPx((c + 1) * VISION_CELL, (r + 1) * VISION_CELL);
          const [x1, y1] = toPx(c * VISION_CELL, r * VISION_CELL);
          ctx.fillStyle = `rgba(0,0,0,${alpha})`;
          ctx.fillRect(x0, y0, x1 - x0 + 0.5, y1 - y0 + 0.5);
        }
      }
    }
    if (view) {
      for (let i = 0; i < view.count; i++) {
        if (view.kinds[i] !== EntityKind.unit) continue;
        const [x, y] = toPx(view.x[i] ?? 0, view.z[i] ?? 0);
        ctx.fillStyle = playerColors[view.owners[i] ?? 0] ?? "#808080";
        ctx.globalAlpha = view.remembered?.[i] === 1 ? 0.5 : 1;
        ctx.fillRect(x - 1.5, y - 1.5, 3, 3);
      }
      ctx.globalAlpha = 1;
    }
    const quad = session.viewQuad();
    if (quad.length === 4) {
      ctx.beginPath();
      quad.forEach((p, k) => {
        const [x, y] = toPx(p.x, p.z);
        if (k === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.closePath();
      ctx.strokeStyle = phosphor;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    document.documentElement.dataset["minimap"] = "drawn";
  });

  useEffect(
    () => () => {
      delete document.documentElement.dataset["minimap"];
    },
    [],
  );

  return (
    <canvas
      ref={ref}
      class="hud-minimap panel"
      width={SIZE}
      height={SIZE}
      data-testid="minimap"
      role="img"
      aria-label="Minimap"
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        dragging.current = true;
        e.currentTarget.setPointerCapture(e.pointerId);
        const p = toGround(e);
        session.focus(p.x, p.z);
      }}
      onPointerMove={(e) => {
        if (!dragging.current) return;
        const p = toGround(e);
        session.focus(p.x, p.z);
      }}
      onPointerUp={() => {
        dragging.current = false;
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        const p = toGround(e);
        session.orderAt(p.x, p.z, e.shiftKey);
      }}
    />
  );
}

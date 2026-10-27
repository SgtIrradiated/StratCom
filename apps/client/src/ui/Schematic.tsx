import type { JSX } from "preact";
import { useEffect, useRef } from "preact/hooks";

const WIDTH = 240;
const HEIGHT = 170;
/** Radians per second. */
const SPIN = 0.6;

/** The 12 edges of a box, as pairs of corner indices (bit 0 = x, bit 1 = y, bit 2 = z). */
const EDGES: readonly (readonly [number, number])[] = [
  [0, 1],
  [2, 3],
  [4, 5],
  [6, 7],
  [0, 2],
  [1, 3],
  [4, 6],
  [5, 7],
  [0, 4],
  [1, 5],
  [2, 6],
  [3, 7],
];

/**
 * A rotating wireframe "blueprint" of a unit's placeholder hull, drawn on a 2D canvas in the
 * UI colour. Stands in for the commander preview until real models exist; three.js stays out
 * of the menus (ADR-0004). Holds still when the user prefers reduced motion.
 */
export function Schematic(props: {
  size: readonly [number, number, number];
  color: string;
  label: string;
}): JSX.Element {
  const ref = useRef<HTMLCanvasElement>(null);
  const { size, color } = props;

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const [w, h, l] = size;
    const scale = 95 / Math.max(w, l, h * 1.4);
    let frame = 0;

    const draw = (timeMs: number): void => {
      const yaw = still ? 0.7 : (timeMs / 1000) * SPIN;
      const cy = Math.cos(yaw);
      const sy = Math.sin(yaw);
      const pitch = 0.5;
      const cp = Math.cos(pitch);
      const sp = Math.sin(pitch);
      const corners = Array.from({ length: 8 }, (_, i) => {
        const x = ((i & 1 ? 1 : -1) * w) / 2;
        const y = i & 2 ? h : 0;
        const z = ((i & 4 ? 1 : -1) * l) / 2;
        const rx = x * cy - z * sy;
        const rz = x * sy + z * cy;
        return [WIDTH / 2 + rx * scale, HEIGHT * 0.68 - (y * cp - rz * sp) * scale] as const;
      });
      ctx.clearRect(0, 0, WIDTH, HEIGHT);
      // Ground grid.
      ctx.strokeStyle = color;
      ctx.globalAlpha = 0.18;
      ctx.lineWidth = 1;
      for (let k = -4; k <= 4; k++) {
        for (const [ax, az, bx, bz] of [
          [k, -4, k, 4],
          [-4, k, 4, k],
        ] as const) {
          const g = Math.max(w, l) / 4;
          const p = (x: number, z: number): [number, number] => [
            WIDTH / 2 + (x * g * cy - z * g * sy) * scale,
            HEIGHT * 0.68 + (x * g * sy + z * g * cy) * sp * scale,
          ];
          const [x0, y0] = p(ax, az);
          const [x1, y1] = p(bx, bz);
          ctx.beginPath();
          ctx.moveTo(x0, y0);
          ctx.lineTo(x1, y1);
          ctx.stroke();
        }
      }
      // Hull.
      ctx.globalAlpha = 1;
      ctx.lineWidth = 1.5;
      ctx.shadowColor = color;
      ctx.shadowBlur = 6;
      ctx.beginPath();
      for (const [a, b] of EDGES) {
        const pa = corners[a];
        const pb = corners[b];
        if (!pa || !pb) continue;
        ctx.moveTo(pa[0], pa[1]);
        ctx.lineTo(pb[0], pb[1]);
      }
      ctx.stroke();
      ctx.shadowBlur = 0;
      if (!still) frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [size, color]);

  return (
    <figure class="schematic">
      <canvas ref={ref} width={WIDTH} height={HEIGHT} role="img" aria-label={props.label} />
      <figcaption>
        {props.label} · {size[0]} × {size[2]} × {size[1]} m
      </figcaption>
    </figure>
  );
}

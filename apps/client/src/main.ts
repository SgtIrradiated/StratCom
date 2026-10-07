import "./style.css";
import { FACTIONS } from "@stratcom/data";
import { assert } from "@stratcom/shared";
import { TICK_RATE } from "@stratcom/sim";
import { blockingProblems, detectCapabilities } from "./boot/capabilities";
import { createSceneRenderer } from "./render/SceneRenderer";
import { renderBootError, renderBootPanel } from "./ui/bootPanel";

/**
 * Client entry point.
 *
 * Boot sequence: capability check → renderer → frame loop. `<html data-boot>` reports
 * progress ("ready" | "error") for the e2e tests. The screen state machine
 * (menu → faction select → loading → in-game) replaces the boot panel in M3.
 */

const canvas = document.querySelector<HTMLCanvasElement>("#viewport");
const ui = document.querySelector<HTMLElement>("#ui");
assert(canvas && ui, "index.html must contain #viewport and #ui");

const caps = detectCapabilities();
const problems = blockingProblems(caps);

if (problems.length > 0) {
  renderBootError(ui, problems);
  document.documentElement.dataset["boot"] = "error";
} else {
  start(canvas, ui);
}

function start(canvas: HTMLCanvasElement, ui: HTMLElement): void {
  renderBootPanel(ui, { caps, tickRate: TICK_RATE, factions: FACTIONS });

  // Placeholders spread along the x axis, one per faction, in front of the boot panel.
  const renderer = createSceneRenderer(canvas, {
    placeholders: FACTIONS.map((f, i) => ({
      baseColor: f.theme.base,
      accentColor: f.theme.accent,
      x: (i - (FACTIONS.length - 1) / 2) * 60,
      z: 40,
    })),
  });

  const resize = (): void => {
    renderer.resize(canvas.clientWidth, canvas.clientHeight, window.devicePixelRatio);
  };
  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  resize();

  let frame = requestAnimationFrame(function loop(time) {
    renderer.render(time);
    document.documentElement.dataset["boot"] = "ready";
    frame = requestAnimationFrame(loop);
  });

  // Vite HMR: tear everything down so a hot reload doesn't leak WebGL contexts.
  import.meta.hot?.dispose(() => {
    cancelAnimationFrame(frame);
    observer.disconnect();
    renderer.dispose();
    ui.replaceChildren();
  });
}

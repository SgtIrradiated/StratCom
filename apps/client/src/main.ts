import "./style.css";
import { FACTIONS } from "@stratcom/data";
import { assert } from "@stratcom/shared";
import {
  TEST_UNIT_TYPES,
  runDetScenario,
  TICK_MS,
  TICK_RATE,
  createTestMatch,
} from "@stratcom/sim";
import type { SnapshotBuffers } from "@stratcom/sim";
import { blockingProblems, detectCapabilities } from "./boot/capabilities";
import { StatsPanel, parseBenchCount } from "./bench/stats";
import { SimClient } from "./sim/SimClient";
import { createSceneRenderer } from "./render/SceneRenderer";
import { renderBootError, renderBootPanel } from "./ui/bootPanel";

/**
 * Client entry point.
 *
 * Boot sequence: capability check → renderer → sim worker → frame loop. `<html data-boot>`
 * reports progress ("ready" once the first sim snapshot has been drawn, or "error") for the
 * e2e tests. `?bench=N` runs N units and shows the performance panel. The screen state machine
 * (menu → faction select → loading → in-game) replaces the boot panel in M3.
 */

/** Demo unit count when `?bench=N` is absent. */
const DEMO_UNITS = 200;

/** Box sizes for the placeholder unit types, index-aligned with `TEST_UNIT_TYPES`. */
const UNIT_VISUALS = [{ size: [4, 3, 6] as const }, { size: [7, 4, 10] as const }];

const canvas = document.querySelector<HTMLCanvasElement>("#viewport");
const ui = document.querySelector<HTMLElement>("#ui");
assert(canvas && ui, "index.html must contain #viewport and #ui");

// `?detcheck` runs the cross-browser determinism scenario and publishes the hashes for
// e2e/determinism.spec.ts, without starting the renderer.
if (new URLSearchParams(window.location.search).has("detcheck")) {
  document.documentElement.dataset["detcheck"] = JSON.stringify(runDetScenario());
}

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

  const bench = parseBenchCount(window.location.search);
  const setup = createTestMatch(bench ?? DEMO_UNITS);
  const stats = new StatsPanel();
  if (bench !== undefined) document.body.append(stats.element);

  const renderer = createSceneRenderer(canvas, {
    unitVisuals: UNIT_VISUALS.slice(0, TEST_UNIT_TYPES.length),
    playerColors: setup.players.map((p) => p.color),
    maxUnits: setup.initialUnits.length + 4096,
    mapSize: setup.map.width,
  });
  renderer.lookAt(setup.map.width / 2, setup.map.height / 2, 1400);

  // The latest snapshot is kept until the next one arrives, then handed back to the worker.
  let current: SnapshotBuffers | undefined;
  let receivedAt = 0;
  const sim = new SimClient(
    setup,
    {
      onSnapshot(snapshot, at) {
        if (current) sim.recycle(current);
        current = snapshot;
        receivedAt = at;
      },
      onStats(s) {
        stats.setSim(s);
      },
      onError(message) {
        renderBootError(ui, [`Simulation error: ${message}`]);
        document.documentElement.dataset["boot"] = "error";
      },
    },
    true,
  );

  const resize = (): void => {
    renderer.resize(canvas.clientWidth, canvas.clientHeight, window.devicePixelRatio);
  };
  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  resize();

  let frame = requestAnimationFrame(function loop(time) {
    if (current) {
      // Snapshot N holds the state at the end of tick N; draw it one tick behind real time,
      // blending prev→current over the tick interval.
      const alpha = Math.min((performance.now() - receivedAt) / TICK_MS, 1);
      renderer.setUnits(current, alpha);
      document.documentElement.dataset["boot"] = "ready";
    }
    renderer.render(time);
    stats.frame(time, renderer.drawCalls);
    frame = requestAnimationFrame(loop);
  });

  // Vite HMR: tear everything down so a hot reload doesn't leak WebGL contexts or workers.
  import.meta.hot?.dispose(() => {
    cancelAnimationFrame(frame);
    observer.disconnect();
    sim.dispose();
    renderer.dispose();
    stats.element.remove();
    ui.replaceChildren();
  });
}

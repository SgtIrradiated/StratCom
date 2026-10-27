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
import { InputController } from "./input/InputController";
import { Selection } from "./input/selection";
import { createSceneRenderer } from "./render/SceneRenderer";
import type { UnitVisual } from "./render/types";
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

/** Slot of the local (human) player. */
const LOCAL_SLOT = 0;

/** Placeholder looks, index-aligned with `TEST_UNIT_TYPES`. */
const UNIT_VISUALS: readonly UnitVisual[] = [
  { size: [4, 3, 6], radius: TEST_UNIT_TYPES[0].radius, icon: "circle" },
  { size: [7, 4, 10], radius: TEST_UNIT_TYPES[1].radius, icon: "diamond" },
];

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
    unitVisuals: UNIT_VISUALS,
    playerColors: setup.players.map((p) => p.color),
    maxUnits: setup.initialUnits.length + 4096,
    terrain: setup.terrain,
  });
  renderer.camera.zoomAt(0, 0, 0.4);

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

  const selection = new Selection();
  const input = new InputController({
    canvas,
    renderer,
    selection,
    localSlot: LOCAL_SLOT,
    current: () => (current ? { snapshot: current, alpha: alphaNow() } : undefined),
    command(cmd) {
      sim.sendCommands([cmd]);
    },
  });
  // Snapshot N holds the state at the end of tick N; blend prev→current over one tick.
  const alphaNow = (): number => Math.min((performance.now() - receivedAt) / TICK_MS, 1);

  const resize = (): void => {
    renderer.resize(canvas.clientWidth, canvas.clientHeight, window.devicePixelRatio);
  };
  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  resize();

  let lastTime = performance.now();
  let frame = requestAnimationFrame(function loop(time) {
    input.update(Math.min((time - lastTime) / 1000, 0.1));
    lastTime = time;
    if (current) {
      renderer.setUnits(current, alphaNow(), selection.ids);
      document.documentElement.dataset["boot"] = "ready";
      document.documentElement.dataset["selected"] = String(selection.ids.size);
      document.documentElement.dataset["zoom"] = renderer.strategicBlend.toFixed(2);
    }
    renderer.render(time);
    stats.frame(time, renderer.drawCalls);
    frame = requestAnimationFrame(loop);
  });

  // Vite HMR: tear everything down so a hot reload doesn't leak WebGL contexts or workers.
  import.meta.hot?.dispose(() => {
    cancelAnimationFrame(frame);
    observer.disconnect();
    input.dispose();
    sim.dispose();
    renderer.dispose();
    stats.element.remove();
    ui.replaceChildren();
  });
}

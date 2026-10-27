import "@fontsource/share-tech-mono/400.css";
import "@fontsource/vt323/400.css";
import "./style.css";
import "./styles/terminal.css";
import { assert } from "@stratcom/shared";
import { RULESET } from "@stratcom/data";
import {
  TEST_UNIT_TYPES,
  createDuelMatch,
  createTestMatch,
  duelCommands,
  runDetScenario,
  runSkirmishDetScenario,
} from "@stratcom/sim";
import { h, render } from "preact";
import { StatsPanel, parseBenchCount } from "./bench/stats";
import { blockingProblems, detectCapabilities, type Capabilities } from "./boot/capabilities";
import { GameSession } from "./game/GameSession";
import { matchOutcome } from "./game/hudModel";
import {
  featureVisualsFromRuleset,
  visualsFromRuleset,
  weaponKindsFromRuleset,
} from "./game/visuals";
import type { UnitVisual } from "./render/types";
import { App } from "./screens/App";
import { renderBootError } from "./ui/bootPanel";

/**
 * Client entry point.
 *
 * Boot sequence: capability check → main menu (the {@link App} screen flow). `<html
 * data-boot>` reports progress for the e2e tests: "ready" once the menu is up (or, with
 * `?bench=N`, once the first snapshot has been drawn), "error" otherwise. `<html
 * data-screen>` names the current screen.
 *
 * Debug flags skip the menus: `?bench=N` runs N scripted test units with the performance
 * panel, `?detcheck` publishes the determinism hashes (test and skirmish scenarios), and
 * `?duel` runs a short real-content fight that ends in victory for slot 0, publishing
 * `<html data-outcome>` when the simulation decides it.
 */

/** Placeholder looks for the bench scenario, index-aligned with `TEST_UNIT_TYPES`. */
const BENCH_VISUALS: readonly UnitVisual[] = [
  { size: [4, 3, 6], radius: TEST_UNIT_TYPES[0]?.radius ?? 2, icon: "circle" },
  { size: [7, 4, 10], radius: TEST_UNIT_TYPES[1]?.radius ?? 3, icon: "diamond" },
];

const ui = document.querySelector<HTMLElement>("#ui");
assert(ui, "index.html must contain #ui");
const root = document.documentElement.dataset;

if (new URLSearchParams(window.location.search).has("detcheck")) {
  root["detcheck"] = JSON.stringify({
    test: runDetScenario(),
    skirmish: runSkirmishDetScenario(),
  });
}

const caps = detectCapabilities();
const problems = blockingProblems(caps);
const bench = parseBenchCount(window.location.search);

if (problems.length > 0) {
  renderBootError(ui, problems);
  root["boot"] = "error";
} else if (bench !== undefined) {
  startBench(bench, ui);
} else if (new URLSearchParams(window.location.search).has("duel")) {
  startDuel(ui);
} else {
  startApp(caps, ui);
}

function startApp(caps: Capabilities, ui: HTMLElement): void {
  render(h(App, { caps }), ui);
  root["boot"] = "ready";
  import.meta.hot?.dispose(() => {
    render(null, ui);
  });
}

function startBench(units: number, ui: HTMLElement): void {
  const stats = new StatsPanel();
  document.body.append(stats.element);
  const session = new GameSession({
    setup: createTestMatch(units),
    unitVisuals: BENCH_VISUALS,
    localSlot: 0,
    scripted: true,
    fog: false,
    stats,
    onError(message) {
      renderBootError(ui, [`Simulation error: ${message}`]);
      root["boot"] = "error";
    },
  });
  root["screen"] = "bench";
  void session.firstFrame.then(() => {
    root["boot"] = "ready";
  });
  // Vite HMR: tear everything down so a hot reload doesn't leak WebGL contexts or workers.
  import.meta.hot?.dispose(() => {
    session.dispose();
    stats.element.remove();
  });
}

function startDuel(ui: HTMLElement): void {
  const setup = createDuelMatch();
  const session = new GameSession({
    setup,
    unitVisuals: visualsFromRuleset(RULESET),
    featureVisuals: featureVisualsFromRuleset(RULESET),
    weaponKinds: weaponKindsFromRuleset(RULESET),
    localSlot: 0,
    focusType: setup.initialUnits[0]?.type ?? 0,
    onError(message) {
      renderBootError(ui, [`Simulation error: ${message}`]);
      root["boot"] = "error";
    },
  });
  root["screen"] = "duel";
  const timer = setInterval(() => {
    const match = session.snapshot?.match;
    const outcome = match ? matchOutcome(match, 0) : undefined;
    if (!outcome) return;
    root["outcome"] = outcome;
    clearInterval(timer);
  }, 100);
  void session.firstFrame.then(() => {
    for (const cmd of duelCommands(setup)) session.issue(cmd);
    root["boot"] = "ready";
  });
  import.meta.hot?.dispose(() => {
    clearInterval(timer);
    session.dispose();
  });
}

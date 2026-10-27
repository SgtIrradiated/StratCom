import { RULESET, getFaction, getMap, rulesetFaction } from "@stratcom/data";
import { hashHex } from "@stratcom/shared";
import { createSkirmishSetup } from "@stratcom/sim";
import { GameSession } from "./GameSession";
import { localSlot, toPlayers, type SkirmishConfig } from "./skirmishConfig";
import { visualsFromRuleset } from "./visuals";

/** Reports one finished loading step, e.g. `("Terrain", "2,048 m, 4 start positions")`. */
export type LoadProgress = (label: string, detail: string) => void;

/** Lets the browser paint the loading log between the synchronous, blocking steps. */
const nextFrame = (): Promise<void> =>
  new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));

/** Thrown when loading is cancelled through the abort signal. */
export class LoadCancelled extends Error {
  constructor() {
    super("Loading cancelled");
    this.name = "LoadCancelled";
  }
}

/**
 * Loading screen work (docs/PLAN.md §7): ruleset check, map generation, renderer, sim worker,
 * first snapshot. Every step reports real progress; nothing here is padded for effect.
 *
 * @throws {LoadCancelled} if `signal` aborts; the half-built session is disposed.
 */
export async function loadMatch(
  config: SkirmishConfig,
  progress: LoadProgress,
  onError: (message: string) => void,
  signal: AbortSignal,
): Promise<GameSession> {
  const check = (): void => {
    if (signal.aborted) throw new LoadCancelled();
  };
  const me = localSlot(config);
  const mine = config.slots[me];
  if (!mine) throw new Error("No local player in this skirmish.");
  const faction = getFaction(mine.factionId);
  const compiled = rulesetFaction(RULESET, faction.id);

  progress(
    "Ruleset",
    `${RULESET.units.length} units, ${RULESET.weapons.length} weapons · hash ${hashHex(RULESET.hash)}`,
  );
  await nextFrame();
  check();

  const map = getMap(config.mapId);
  const setup = createSkirmishSetup({
    seed: config.seed,
    map,
    ruleset: RULESET,
    players: toPlayers(config),
  });
  const metres = map.cells * map.cellSize;
  progress("Terrain", `${map.name}, ${metres.toLocaleString("en")} m square`);
  await nextFrame();
  check();

  const session = new GameSession({
    setup,
    unitVisuals: visualsFromRuleset(RULESET),
    localSlot: me,
    selectionColor: faction.theme.phosphor,
    focusType: compiled.commanderUnit,
    onError,
  });
  const abort = (): void => {
    session.dispose();
  };
  signal.addEventListener("abort", abort, { once: true });
  progress("Renderer", "WebGL2 scene ready");
  progress("Simulation", `worker started, ${setup.initialUnits.length} units deployed`);

  await session.firstFrame;
  signal.removeEventListener("abort", abort);
  if (signal.aborted) {
    session.dispose();
    throw new LoadCancelled();
  }
  progress("Telemetry", `first snapshot received · ${faction.commanderTitle} online`);
  return session;
}

import { RULESET, getMap } from "@stratcom/data";
import type { PlayerCommand, Vec2 } from "./commands";
import { EntityKind } from "./ecs/world";
import { cos, sin } from "./math/trig";
import { createTestMatch, scriptedCommands } from "./scenario";
import { Simulation, type MatchSetup } from "./simulation";
import { createSkirmishSetup } from "./skirmish";

/** Ticks simulated by {@link runDetScenario}. */
export const DET_TICKS = 1000;

/**
 * The cross-runtime determinism scenario (docs/PLAN.md §4.2): 500 units, 3 players, a
 * scripted command stream, 1,000 ticks. Returns the state hash every 100 ticks. Node,
 * Chromium, Firefox and WebKit must all return exactly the same array; CI enforces it with
 * `e2e/determinism.spec.ts`.
 */
export function runDetScenario(): number[] {
  const setup = createTestMatch(500, 0xdecaf, 3);
  const sim = new Simulation(setup);
  const hashes: number[] = [];
  for (let t = 0; t < DET_TICKS; t++) {
    sim.step(scriptedCommands(setup, sim.tick));
    if ((t + 1) % 100 === 0) hashes.push(sim.stateHash());
  }
  return hashes;
}

/** Ticks simulated by {@link runSkirmishDetScenario}. */
export const SKIRMISH_DET_TICKS = 1200;

/**
 * The determinism scenario for real content: a 4-player 2v2 on Rustbelt Ridge with the
 * built-in ruleset (both factions, every movement class, flattened start plateaus, deposits
 * and debris). Each commander builds extractors, a generator and a factory; engineers assist
 * it and then reclaim debris; finished factories produce; combat units get the scripted
 * orders of {@link runDetScenario}. Returns the ruleset hash followed by the state hash
 * every 100 ticks.
 *
 * Unlike {@link runDetScenario} these values are not pinned, because any rebalance changes
 * them. What must hold is that every runtime returns the same array.
 *
 * @param inspect Called with the simulation after the last tick, for tests.
 */
export function runSkirmishDetScenario(inspect?: (sim: Simulation) => void): number[] {
  const factions = ["directorate", "scrapborn", "scrapborn", "directorate"];
  const setup = createSkirmishSetup({
    seed: 0xc0ffee,
    map: getMap("rustbelt_ridge"),
    ruleset: RULESET,
    players: factions.map((factionId, slot) => ({
      slot,
      team: slot % 2,
      factionId,
      color: "#ffffff",
    })),
  });
  const sim = new Simulation(setup);
  const hashes = [RULESET.hash];
  for (let t = 0; t < SKIRMISH_DET_TICKS; t++) {
    sim.step(skirmishCommands(setup, sim));
    if ((t + 1) % 100 === 0) hashes.push(sim.stateHash());
  }
  inspect?.(sim);
  return hashes;
}

/** Scripted economy orders for {@link runSkirmishDetScenario}. */
function skirmishCommands(setup: MatchSetup, sim: Simulation): PlayerCommand[] {
  const tick = sim.tick;
  const role = (type: number): string => RULESET.units[type]?.role ?? "";
  const idOf = (i: number): number => (1 << 20) | i;
  const commands: PlayerCommand[] = [];
  // Combat units follow the generic script; builders are left to their work.
  for (const cmd of scriptedCommands(setup, tick)) {
    if (cmd.t !== "move") continue;
    const units = cmd.units.filter((id) => {
      const u = setup.initialUnits[id & 0xfffff];
      return u !== undefined && role(u.type) === "land";
    });
    commands.push({ ...cmd, units });
  }
  for (const p of setup.players) {
    const own = setup.initialUnits.flatMap((u, i) => (u.slot === p.slot ? [i] : []));
    const cmdr = own.find((i) => role(setup.initialUnits[i]?.type ?? 0) === "commander") ?? 0;
    const start = setup.initialUnits[cmdr];
    const builds = start ? (RULESET.units[start.type]?.builds ?? []) : [];
    const engineers = own.filter((i) => role(setup.initialUnits[i]?.type ?? 0) === "engineer");
    if (tick === 0 && start) {
      const extractor = builds.find((b) => RULESET.units[b]?.placement === "deposit");
      const generator = builds.find(
        (b) => (RULESET.units[b]?.economy.powerPerSec ?? 0) > 0 && b !== extractor,
      );
      const factory = builds.find((b) => role(b) === "factory");
      const near = [...(setup.deposits ?? [])]
        .map((d) => ({ d, dist: Math.abs(d.x - start.x) + Math.abs(d.z - start.z) }))
        .sort((a, b) => a.dist - b.dist || a.d.x - b.d.x || a.d.z - b.d.z)
        .slice(0, 2);
      const h = start.heading ?? 0;
      const right = { x: cos(h), z: -sin(h) };
      const queue: PlayerCommand[] = [];
      for (const { d } of near) {
        if (extractor !== undefined) queue.push(build(p.slot, [idOf(cmdr)], extractor, d));
      }
      if (generator !== undefined) {
        queue.push(
          build(p.slot, [idOf(cmdr)], generator, {
            x: start.x + right.x * 30,
            z: start.z + right.z * 30,
          }),
        );
      }
      if (factory !== undefined) {
        queue.push(
          build(p.slot, [idOf(cmdr)], factory, {
            x: start.x - right.x * 45,
            z: start.z - right.z * 45,
          }),
        );
      }
      queue.forEach((c, k) => {
        commands.push(k === 0 || c.t !== "build" ? c : { ...c, queue: true });
      });
      commands.push({ t: "assist", slot: p.slot, units: engineers.map(idOf), target: idOf(cmdr) });
    }
    if (tick === 700) {
      // Engineers switch to reclaiming the debris nearest their commander.
      const w = sim.state;
      let best = -1;
      let bestD = Infinity;
      for (let i = 0; i < w.highWater; i++) {
        if (w.alive[i] === 0 || w.kind[i] !== EntityKind.feature || !start) continue;
        const d = Math.abs((w.x[i] ?? 0) - start.x) + Math.abs((w.z[i] ?? 0) - start.z);
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
      if (best >= 0) {
        commands.push({
          t: "reclaim",
          slot: p.slot,
          units: engineers.map(idOf),
          target: w.idAt(best),
        });
      }
    }
    if (tick % 200 === 0 && tick > 0) {
      // Every finished factory queues two of its second build option.
      const w = sim.state;
      for (let i = 0; i < w.highWater; i++) {
        if (w.alive[i] === 0 || w.kind[i] !== EntityKind.unit || w.owner[i] !== p.slot) continue;
        const def = RULESET.units[w.type[i] ?? 0];
        const product = def?.builds[1];
        if (def?.role !== "factory" || w.progress[i] !== 1 || product === undefined) continue;
        commands.push({
          t: "produce",
          slot: p.slot,
          units: [w.idAt(i)],
          unitType: product,
          count: 2,
        });
      }
    }
  }
  return commands;
}

/** A build order for the scenario script. */
function build(slot: number, units: number[], unitType: number, at: Vec2): PlayerCommand {
  return { t: "build", slot, units, unitType, at };
}

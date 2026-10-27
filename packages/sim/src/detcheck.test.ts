import { RULESET } from "@stratcom/data";
import { describe, expect, it } from "vitest";
import { runDetScenario, runSkirmishDetScenario } from "./detcheck";
import { EntityKind } from "./ecs/world";

// Repinned twice in M5 (the system split before them left the hashes unchanged):
// 1. Combat: the test units are armed and fight (TEST_WEAPONS), units have health, and the
//    hash covers health, weapon state, projectiles and kill/loss records.
// 2. Victory: the hash covers each player's defeat tick and the match result. Nobody is
//    defeated in this scenario, so its movement and combat are unchanged by that repin.
const GOLDEN = [
  1614000273, 169803784, 2567070933, 2449092853, 3606758260, 3059260851, 213118930, 415093451,
  3882453656, 277128214,
];

describe("runDetScenario", () => {
  it("is repeatable within one runtime", () => {
    expect(runDetScenario()).toEqual(runDetScenario());
  });

  it("matches the pinned hashes", () => {
    // Update ONLY when a sim change is intentional: this also changes replays and breaks
    // compatibility between builds. The e2e determinism spec compares browsers against the
    // same scenario run in Node.
    expect(runDetScenario()).toEqual(GOLDEN);
  });

  it("includes combat: units die and leave wrecks", () => {
    runDetScenario((sim) => {
      for (let slot = 0; slot < 3; slot++) {
        expect(sim.playerStats(slot).kills, `slot ${slot}`).toBeGreaterThan(0);
      }
      let wrecks = 0;
      const w = sim.state;
      for (let i = 0; i < w.highWater; i++) {
        if (w.alive[i] === 1 && w.kind[i] === EntityKind.feature) wrecks++;
      }
      expect(wrecks).toBeGreaterThan(0);
    });
  });
});

describe("runSkirmishDetScenario", () => {
  it("is repeatable, the state evolves, and every player builds a working base", () => {
    const built = new Map<number, Set<string>>();
    let kills = 0;
    const a = runSkirmishDetScenario((sim) => {
      for (let slot = 0; slot < 4; slot++) kills += sim.playerStats(slot).kills;
      const w = sim.state;
      for (let i = 0; i < w.highWater; i++) {
        if (w.alive[i] === 0 || w.kind[i] !== EntityKind.unit || w.progress[i] !== 1) continue;
        const def = RULESET.units[w.type[i] ?? 0];
        if (!def || def.mobile) continue;
        const roles = built.get(w.owner[i] ?? 0) ?? new Set();
        roles.add(def.placement === "deposit" ? "extractor" : def.role);
        built.set(w.owner[i] ?? 0, roles);
      }
    });
    expect(runSkirmishDetScenario()).toEqual(a);
    expect(kills, "the armies meet and fight").toBeGreaterThan(0);
    expect(a).toHaveLength(13);
    expect(new Set(a.slice(1)).size).toBe(12);
    for (let slot = 0; slot < 4; slot++) {
      expect([...(built.get(slot) ?? [])].sort(), `slot ${slot}`).toEqual([
        "economy",
        "extractor",
        "factory",
      ]);
    }
  });
});

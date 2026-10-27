import { RULESET } from "@stratcom/data";
import { describe, expect, it } from "vitest";
import { runDetScenario, runSkirmishDetScenario } from "./detcheck";
import { EntityKind } from "./ecs/world";

// Repinned in M5: the test units are armed and fight (TEST_WEAPONS), units have health, and
// the state hash covers health, weapon state, projectiles and kill/loss records. The M5
// system split before it left these hashes unchanged.
const GOLDEN = [
  830696657, 3054226357, 2845580709, 3582157984, 2636817060, 504887229, 1044610860, 2946995712,
  937218288, 377764056,
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

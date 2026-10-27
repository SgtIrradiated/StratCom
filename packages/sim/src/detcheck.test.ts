import { RULESET } from "@stratcom/data";
import { describe, expect, it } from "vitest";
import { runDetScenario, runSkirmishDetScenario } from "./detcheck";
import { EntityKind } from "./ecs/world";

// Repinned in M4: the state hash now covers entity kind, build progress, order queues,
// production queues and every player's economy. Unit movement is unchanged (verified
// against a positions-only hash of the M3 build).
const GOLDEN = [
  3017797951, 514476606, 2323874495, 2073086898, 2887356052, 2837909201, 2219960130, 2609706589,
  2391454122, 4216034257,
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
});

describe("runSkirmishDetScenario", () => {
  it("is repeatable, the state evolves, and every player builds a working base", () => {
    const built = new Map<number, Set<string>>();
    const a = runSkirmishDetScenario((sim) => {
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

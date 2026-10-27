import { describe, expect, it } from "vitest";
import { runDetScenario } from "./detcheck";

const GOLDEN = [
  2331397361, 4246729366, 4193804483, 2892502497, 1722673442, 3548738984, 3674121535, 375078780,
  2851128100, 1072409633,
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

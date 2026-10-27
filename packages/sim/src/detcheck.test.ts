import { describe, expect, it } from "vitest";
import { runDetScenario } from "./detcheck";

const GOLDEN = [
  73055389, 233103841, 1917118027, 1625442706, 2533412041, 1043011867, 1324533923, 2414070983,
  116037192, 1595702863,
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

import { describe, expect, it } from "vitest";
import { blockingProblems, type Capabilities } from "./capabilities";

const good: Capabilities = {
  webgl2: true,
  workers: true,
  crossOriginIsolated: true,
  maxTextureSize: 16384,
};

describe("blockingProblems", () => {
  it("accepts a capable browser", () => {
    expect(blockingProblems(good)).toEqual([]);
  });

  it("reports missing WebGL2 and workers", () => {
    const problems = blockingProblems({ ...good, webgl2: false, workers: false });
    expect(problems).toHaveLength(2);
    expect(problems[0]).toMatch(/WebGL2/);
  });

  it("reports a too-small max texture size", () => {
    expect(blockingProblems({ ...good, maxTextureSize: 2048 })).toEqual([
      expect.stringMatching(/texture size 2048/),
    ]);
  });

  it("does not treat missing cross-origin isolation as blocking (yet)", () => {
    expect(blockingProblems({ ...good, crossOriginIsolated: false })).toEqual([]);
  });
});

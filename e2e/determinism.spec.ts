import { expect, test } from "@playwright/test";
import { runDetScenario, runSkirmishDetScenario } from "@stratcom/sim";

// The same scripted matches must produce identical state hashes in Node and in every browser
// engine (V8, SpiderMonkey, JavaScriptCore). See ADR-0002. `test` uses the fixed test ruleset
// (pinned in detcheck.test.ts); `skirmish` uses the real content, maps and N-slot setup.
test("simulation hashes match Node in this browser engine", async ({ page }) => {
  const expected = { test: runDetScenario(), skirmish: runSkirmishDetScenario() };
  await page.goto("/?detcheck");
  const raw = await page.locator("html").getAttribute("data-detcheck");
  expect(raw).not.toBeNull();
  expect(JSON.parse(raw ?? "{}")).toEqual(expected);
});

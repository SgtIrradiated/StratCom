import { expect, test } from "@playwright/test";
import { runDetScenario } from "@stratcom/sim";

// The same scripted match must produce identical state hashes in Node and in every browser
// engine (V8, SpiderMonkey, JavaScriptCore). See ADR-0002.
test("simulation hashes match Node in this browser engine", async ({ page }) => {
  const expected = runDetScenario();
  await page.goto("/?detcheck");
  const raw = await page.locator("html").getAttribute("data-detcheck");
  expect(raw).not.toBeNull();
  expect(JSON.parse(raw ?? "[]")).toEqual(expected);
});

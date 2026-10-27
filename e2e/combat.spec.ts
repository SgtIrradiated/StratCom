import { expect, test } from "@playwright/test";

// Chromium only (WebGL via SwiftShader). The M5 exit criterion end to end: in the `?duel`
// scenario the Overseer and its Lancers destroy the enemy commander, the simulation decides
// the match, and the client sees the victory, with projectiles and beams drawn on the way.
test("destroying the enemy commander wins the match", async ({ page }) => {
  test.setTimeout(60_000);
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });

  await page.goto("/?duel");
  const html = page.locator("html");
  await expect(html).toHaveAttribute("data-boot", "ready", { timeout: 30_000 });
  await expect(html).toHaveAttribute("data-screen", "duel");
  await expect(html).toHaveAttribute("data-outcome", "victory", { timeout: 30_000 });
  expect(errors).toEqual([]);
});

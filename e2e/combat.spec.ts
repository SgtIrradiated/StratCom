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

// Hotseat (debug): F9 hands control and the fog of war to the next player.
test("hotseat switches control to the other player", async ({ page }) => {
  test.setTimeout(60_000);
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));

  await page.goto("/?hotseat");
  await page.mouse.move(640, 360);
  const html = page.locator("html");
  await page.getByTestId("menu-skirmish").click();
  await page.getByRole("button", { name: /Glassed Flats/ }).click();
  await page.getByTestId("setup-next").click();
  await page.getByTestId("faction-directorate").click();
  await page.getByTestId("faction-deploy").click();
  await expect(html).toHaveAttribute("data-screen", "game", { timeout: 30_000 });
  await expect(html).toHaveAttribute("data-slot", "0");
  const fog = await html.getAttribute("data-fog");
  // Keep the pointer off the screen edge, where it would pan the camera.
  await page.mouse.move(640, 360);

  await page.keyboard.press("F9");
  await expect(html).toHaveAttribute("data-slot", "1");
  await expect(page.getByTestId("hotseat")).toContainText("P2");
  await expect(html).not.toHaveAttribute("data-fog", fog ?? "");

  // [C] finds the active player's commander; the box selects their units now.
  await page.keyboard.press("KeyC");
  await page.waitForTimeout(300);
  const vp = page.viewportSize()!;
  await page.mouse.move(vp.width * 0.3, vp.height * 0.25);
  await page.mouse.down();
  await page.mouse.move(vp.width * 0.7, vp.height * 0.75, { steps: 5 });
  await page.mouse.up();
  await expect(html).not.toHaveAttribute("data-selected", "0");
  await page.mouse.click(vp.width / 2, vp.height * 0.6, { button: "right" });

  await page.keyboard.press("F9");
  await expect(html).toHaveAttribute("data-slot", "0");
  await expect(html).toHaveAttribute("data-selected", "0");
  expect(errors).toEqual([]);
});

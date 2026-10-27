import { expect, test } from "@playwright/test";

// Chromium only (WebGL via SwiftShader). The M3 exit criterion: pick a faction, start a 1v1,
// spawn that faction's commander, and see the HUD skinned for it. Then leave the match
// through the pause menu and the results screen.
test("menu → setup → faction select → match → surrender → results → menu", async ({
  page,
}, info) => {
  // A full match load through software WebGL; with the other specs running in parallel it
  // can take over 20 s, too close to the 30 s default.
  test.setTimeout(60_000);
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });

  await page.goto("/");
  const html = page.locator("html");
  await expect(html).toHaveAttribute("data-screen", "menu");

  await page.getByTestId("menu-skirmish").click();
  await expect(html).toHaveAttribute("data-screen", "setup");
  await page.getByRole("button", { name: /Glassed Flats/ }).click();
  await expect(page.getByRole("img", { name: /Glassed Flats: 2 start positions/ })).toBeVisible();
  await page.screenshot({ path: info.outputPath("setup.png") });
  await page.getByTestId("setup-next").click();

  await expect(html).toHaveAttribute("data-screen", "faction");
  await page.getByTestId("faction-scrapborn").click();
  await expect(page.getByTestId("faction-scrapborn")).toHaveAttribute("aria-checked", "true");
  await expect(page.locator(".app")).toHaveClass(/skin-terminal-rust/);
  await expect(page.getByText("Warboss Scrap Fortress").first()).toBeVisible();
  await page.screenshot({ path: info.outputPath("faction.png") });
  await page.getByTestId("faction-deploy").click();

  await expect(html).toHaveAttribute("data-screen", "game", { timeout: 30_000 });
  const hud = page.getByTestId("hud");
  await expect(hud).toContainText("SCRAPBORN // WARBOSS");
  await expect(page.locator(".app")).toHaveClass(/skin-terminal-rust/);

  // The camera starts on our commander: box-selecting the screen centre picks up our units,
  // and the commander's build options appear.
  const vp = page.viewportSize()!;
  await page.mouse.move(vp.width * 0.3, vp.height * 0.25);
  await page.mouse.down();
  await page.mouse.move(vp.width * 0.7, vp.height * 0.75, { steps: 5 });
  await page.mouse.up();
  await expect(html).not.toHaveAttribute("data-selected", "0");
  await expect(hud).toContainText("Warboss Scrap Fortress");
  await page.screenshot({ path: info.outputPath("hud.png") });

  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Paused" })).toBeVisible();
  await page.getByTestId("pause-surrender").click();

  await expect(html).toHaveAttribute("data-screen", "results");
  await expect(page.getByTestId("results-outcome")).toHaveText("WITHDRAWAL");
  await page.getByTestId("results-menu").click();
  await expect(html).toHaveAttribute("data-screen", "menu");

  expect(errors).toEqual([]);
});

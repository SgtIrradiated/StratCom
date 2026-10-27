import { expect, test } from "@playwright/test";

// Chromium only (WebGL via SwiftShader). The M4 exit criterion through the real UI: select
// the commander, pick a generator from the build panel, place it with the ghost, and watch
// it go up and add to the power income.
test("place a generator from the build panel and watch it come online", async ({ page }, info) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });

  await page.goto("/");
  const html = page.locator("html");
  await page.getByTestId("menu-skirmish").click();
  await page.getByRole("button", { name: /Glassed Flats/ }).click();
  await page.getByTestId("setup-next").click();
  await page.getByTestId("faction-directorate").click();
  await page.getByTestId("faction-deploy").click();
  await expect(html).toHaveAttribute("data-screen", "game", { timeout: 30_000 });

  // Commander plus starting force; the economy readout is live.
  const power = page.getByTestId("res-power");
  await expect(power).toContainText("+20");
  const unitsBefore = Number(await html.getAttribute("data-units"));
  expect(unitsBefore).toBeGreaterThan(1);

  const vp = page.viewportSize()!;
  await page.mouse.move(vp.width * 0.3, vp.height * 0.25);
  await page.mouse.down();
  await page.mouse.move(vp.width * 0.7, vp.height * 0.75, { steps: 5 });
  await page.mouse.up();
  await expect(html).not.toHaveAttribute("data-selected", "0");

  await page.getByTestId("build-dir_reactor").click();
  await expect(html).toHaveAttribute("data-placing", /\d+/);
  await expect(page.getByTestId("placing-hint")).toBeVisible();

  // Sweep the cursor until the ghost shows a buildable site, then place it there.
  let placed = false;
  for (const [fx, fy] of [
    [0.5, 0.3],
    [0.35, 0.4],
    [0.65, 0.4],
    [0.3, 0.6],
    [0.7, 0.6],
    [0.5, 0.75],
    [0.4, 0.5],
    [0.6, 0.5],
  ] as const) {
    await page.mouse.move(vp.width * fx, vp.height * fy, { steps: 3 });
    await page.waitForTimeout(100);
    if ((await html.getAttribute("data-ghost")) === "valid") {
      await page.screenshot({ path: info.outputPath("ghost.png") });
      await page.mouse.click(vp.width * fx, vp.height * fy);
      placed = true;
      break;
    }
  }
  expect(placed, "no buildable spot found under the cursor").toBe(true);
  await expect(html).not.toHaveAttribute("data-placing", /.*/);

  // The builders walk over and place the site, then it completes: +20 commander +25 pile.
  await expect
    .poll(async () => Number(await html.getAttribute("data-units")), { timeout: 30_000 })
    .toBe(unitsBefore + 1);
  await page.screenshot({ path: info.outputPath("building.png") });
  await expect(power).toContainText("+45", { timeout: 60_000 });
  await page.screenshot({ path: info.outputPath("built.png") });

  expect(errors).toEqual([]);
});

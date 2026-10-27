import { expect, test } from "@playwright/test";

// Chromium only (WebGL via SwiftShader). Drives the real input path: camera, selection,
// strategic zoom and move commands.
test("select with a box, move, and zoom out to strategic icons", async ({ page }, info) => {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });

  await page.goto("/?bench=300");
  const html = page.locator("html");
  await expect(html).toHaveAttribute("data-boot", "ready");
  await expect(html).toHaveAttribute("data-selected", "0");
  await expect(html).toHaveAttribute("data-zoom", "0.00");

  // Box-select across the whole viewport: selects the local player's visible units.
  const vp = page.viewportSize()!;
  await page.mouse.move(8, 40);
  await page.mouse.down();
  await page.mouse.move(vp.width - 40, vp.height - 40, { steps: 5 });
  await page.mouse.up();
  await expect(html).not.toHaveAttribute("data-selected", "0");

  // Order a move, then confirm the page keeps running without errors.
  await page.mouse.click(vp.width / 2, vp.height / 2, { button: "right" });
  await page.waitForTimeout(500);
  for (let i = 0; i < 4; i++) await page.mouse.wheel(0, -200);
  await page.waitForTimeout(500);
  await page.screenshot({ path: info.outputPath("models.png") });

  // Zooming out far enough hands over to the icon layer.
  for (let i = 0; i < 12; i++) {
    await page.mouse.wheel(0, 200);
    await page.waitForTimeout(30);
  }
  await expect(html).toHaveAttribute("data-zoom", "1.00");
  await page.screenshot({ path: info.outputPath("icons.png") });

  // Escape-free deselect: clicking empty ground clears the selection.
  await page.mouse.click(vp.width / 2, 5);
  expect(errors).toEqual([]);
});

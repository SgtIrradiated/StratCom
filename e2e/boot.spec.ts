import { expect, test } from "@playwright/test";

test("client boots to the main menu and logs no errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });

  await page.goto("/");

  // main.ts flips this once the menu is mounted.
  await expect(page.locator("html")).toHaveAttribute("data-boot", "ready");
  await expect(page.locator("html")).toHaveAttribute("data-screen", "menu");
  await expect(page.locator("canvas#viewport")).toBeVisible();
  await expect(page.getByText("The Atomic Directorate")).toBeVisible();
  await expect(page.getByText("The Scrapborn Clans")).toBeVisible();

  expect(errors).toEqual([]);
});

test("server sends cross-origin isolation headers", async ({ request }) => {
  const res = await request.get("/");
  expect(res.headers()["cross-origin-opener-policy"]).toBe("same-origin");
  expect(res.headers()["cross-origin-embedder-policy"]).toBe("require-corp");
});

import { defineConfig, devices } from "@playwright/test";

const PORT = 4173;

/**
 * End-to-end smoke tests against the *production* build served by the real server.
 * Run `pnpm build` first (CI does this). Firefox and WebKit projects are added in M1
 * together with the cross-browser determinism check.
 */
export default defineConfig({
  testDir: "./e2e",
  forbidOnly: !!process.env["CI"],
  retries: process.env["CI"] ? 1 : 0,
  reporter: process.env["CI"] ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        // Headless CI machines have no GPU: force the SwiftShader software WebGL path.
        launchOptions: { args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] },
      },
    },
  ],
  webServer: {
    command: "pnpm start",
    url: `http://127.0.0.1:${PORT}/healthz`,
    reuseExistingServer: !process.env["CI"],
    env: { PORT: String(PORT), HOST: "127.0.0.1", LOG_LEVEL: "warn" },
  },
});

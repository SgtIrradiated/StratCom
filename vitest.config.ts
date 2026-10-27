import { defineConfig } from "vitest/config";

// Single root config: unit/integration tests live next to the code they test
// (`*.test.ts`). Browser e2e tests live in ./e2e and run under Playwright.
export default defineConfig({
  test: {
    include: ["packages/*/src/**/*.test.ts", "apps/*/src/**/*.test.ts"],
    environment: "node",
    // Cold runs on WSL-mounted disks can push `beforeAll` (which imports and builds the
    // Fastify app) past the 10 s default. Warm hooks take well under a second.
    hookTimeout: 30_000,
  },
});

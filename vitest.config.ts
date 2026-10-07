import { defineConfig } from "vitest/config";

// Single root config: unit/integration tests live next to the code they test
// (`*.test.ts`). Browser e2e tests live in ./e2e and run under Playwright.
export default defineConfig({
  test: {
    include: ["packages/*/src/**/*.test.ts", "apps/*/src/**/*.test.ts"],
    environment: "node",
  },
});

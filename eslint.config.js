// @ts-check
import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import { defineConfig, globalIgnores } from "eslint/config";
import globals from "globals";
import tseslint from "typescript-eslint";

// ---------------------------------------------------------------------------
// Architectural boundaries (see docs/architecture.md §Dependency rules).
//
// Flat config does not merge `no-restricted-imports` between blocks: the last
// matching block wins. Each area below therefore lists its *complete* set of
// restrictions, and the blocks are ordered from general to specific.
// ---------------------------------------------------------------------------

/** @param {string[]} names @param {string} message */
const forbid = (names, message) => ({ group: names.flatMap((n) => [n, `${n}/*`]), message });

const THREE = forbid(
  ["three"],
  "three.js may only be imported under apps/client/src/render (ADR-0004).",
);
const UI = forbid(["preact"], "UI libraries belong in apps/client only.");
const NODE = { group: ["node:*"], message: "Node built-ins are not available here." };
const APPS = forbid(
  ["@stratcom/client", "@stratcom/server"],
  "Packages must never depend on apps.",
);
const SIM = forbid(["@stratcom/sim"], "@stratcom/data must not depend on the simulation.");
const ANY_WORKSPACE = {
  group: ["@stratcom/*"],
  message: "@stratcom/shared is the dependency root and imports no workspace packages.",
};

/** @param {string[]} files @param {object[]} patterns */
const boundary = (files, patterns) => ({
  files,
  rules: { "no-restricted-imports": ["error", { patterns }] },
});

// ---------------------------------------------------------------------------
// Simulation purity (ADR-0002). Anything that is non-deterministic across
// browsers/engines, or that reads the outside world, is banned in the sim.
// ---------------------------------------------------------------------------

const DETERMINISM_HINT = "Not deterministic across JS engines. Use @stratcom/sim/math (ADR-0002).";

const NON_DETERMINISTIC_MATH = [
  "random",
  "sin",
  "cos",
  "tan",
  "asin",
  "acos",
  "atan",
  "atan2",
  "sinh",
  "cosh",
  "tanh",
  "asinh",
  "acosh",
  "atanh",
  "exp",
  "expm1",
  "log",
  "log1p",
  "log2",
  "log10",
  "pow",
  "cbrt",
  "hypot",
];

const IMPURE_GLOBALS = [
  "Date",
  "performance",
  "window",
  "document",
  "self",
  "globalThis",
  "navigator",
  "crypto",
  "fetch",
  "setTimeout",
  "setInterval",
  "requestAnimationFrame",
  "queueMicrotask",
];

export default defineConfig([
  globalIgnores([
    "**/node_modules/",
    "**/dist/",
    "**/coverage/",
    "test-results/",
    "playwright-report/",
  ]),

  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/restrict-template-expressions": ["error", { allowNumber: true }],
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      eqeqeq: ["error", "always"],
      "no-console": ["warn", { allow: ["warn", "error"] }],
    },
  },
  {
    files: ["**/*.js", "**/*.mjs"],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: { globals: globals.node },
  },
  {
    files: ["**/*.test.ts", "e2e/**/*.ts"],
    rules: { "@typescript-eslint/no-non-null-assertion": "off" },
  },

  // --- Boundaries: general → specific -------------------------------------
  boundary(["apps/client/**"], [THREE, NODE]),
  boundary(["apps/client/src/render/**"], [NODE]),
  boundary(["apps/server/**"], [THREE, UI]),
  boundary(["packages/**"], [THREE, UI, NODE, APPS]),
  boundary(["packages/data/**"], [THREE, UI, NODE, APPS, SIM]),
  boundary(["packages/shared/**"], [THREE, UI, NODE, ANY_WORKSPACE]),
  boundary(["apps/client/scripts/**", "apps/server/scripts/**"], []),

  // --- Simulation purity ---------------------------------------------------
  {
    files: ["packages/sim/src/**/*.ts"],
    ignores: ["**/*.test.ts"],
    rules: {
      "no-restricted-properties": [
        "error",
        ...NON_DETERMINISTIC_MATH.map((property) => ({
          object: "Math",
          property,
          message: DETERMINISM_HINT,
        })),
      ],
      "no-restricted-globals": [
        "error",
        ...IMPURE_GLOBALS.map((name) => ({
          name,
          message: "The simulation must not touch the clock, host, or I/O (ADR-0002).",
        })),
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector: "BinaryExpression[operator='**'], AssignmentExpression[operator='**=']",
          message: "`**` is Math.pow. " + DETERMINISM_HINT,
        },
        {
          selector: "ForInStatement",
          message: "for…in order depends on key shape. Iterate arrays or Maps instead.",
        },
        {
          selector: "CallExpression[callee.property.name='sort'][arguments.length=0]",
          message: "Always pass an explicit, total comparator to sort() in the simulation.",
        },
      ],
    },
  },

  prettier,
]);

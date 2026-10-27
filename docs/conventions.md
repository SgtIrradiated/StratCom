# Conventions

## Code style

- **Formatting** is Prettier's job (`pnpm format`). Don't hand-format. Line width is 100.
- **TypeScript strict mode** with `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`.
  No `any`. Use `unknown` plus narrowing (zod for external data).
- **Imports:** `import type` for types only (lint-enforced). Use extensionless relative
  imports inside a package and the package name (`@stratcom/sim`) across packages.
- **Naming:** `PascalCase` for types and classes, `camelCase` for functions and variables,
  `SCREAMING_SNAKE_CASE` for module-level constants. Files are named after their main export
  (`SceneRenderer.ts`, `capabilities.ts`). Content ids are `lower_snake_case`, and unit
  and weapon ids start with a faction tag (`dir_`, `scr_`).
- **Errors:** use `assert()` for programming errors and thrown `Error`s with actionable messages
  for bad input or config. Validate at the boundaries (env, network, content) and trust types
  inside.
- **DOM:** build elements with `textContent`, never `innerHTML` with data.
- **Comments:** explain _why_, not _what_. Every exported symbol gets a TSDoc comment.

## Simulation rules (summary of ADR-0002)

Inside `packages/sim`:

| Don't                                     | Do                                                |
| ----------------------------------------- | ------------------------------------------------- |
| `Math.random()`                           | `world.rng.nextFloat()` (`Prng`)                  |
| `Math.sin/cos/atan2/pow`, `**`            | `@stratcom/sim/math`                              |
| `Date.now()`, `performance.now()`, timers | the tick counter                                  |
| `for (k in obj)`, `arr.sort()`            | arrays/Maps, `sort((a, b) => … \|\| a.id - b.id)` |
| Gameplay values per tick                  | values per second, converted with `TICK_RATE`     |

## Tests

- Unit tests sit next to the code as `*.test.ts` (Vitest). Browser tests live in `e2e/`
  (Playwright).
- Keep UI logic testable: pure modules (`skirmishConfig.ts`, `router.ts`, `hudModel.ts`)
  carry the logic and get unit tests; Preact components stay thin and are covered by e2e.
  Vitest runs in Node, so test files must not import `.tsx` components.
- Every sim system gets unit tests. Bugs get a regression test before the fix.
- Reference vectors (PRNG, hash) and golden replays are only re-recorded deliberately, with a
  reason in the commit message.

## Git

- Branches: `feat/…`, `fix/…`, `docs/…`, `chore/…`. `main` is always releasable.
- [Conventional Commits](https://www.conventionalcommits.org): `feat(sim): add flow fields`,
  `fix(render): dispose icon textures`. The scopes are package or app names.
- Pull requests must pass `pnpm check` and CI. Architectural changes need an ADR.

## Dependencies

Before adding one, check three things:

1. It is **AGPL-compatible** (ADR-0008).
2. It is actively maintained.
3. It is needed: a few lines of our own code is often better.

pnpm's minimum-release-age and blocked install scripts stay on (ADR-0001). Add packages to
`allowBuilds` only after review.

## Documentation

- Each package has a `README.md` covering purpose, status, public API and dependency rules.
- `docs/architecture.md` describes the current structure. `docs/ROADMAP.md` is updated when
  a milestone completes.
- Significant decisions get an ADR (`docs/adr/`).

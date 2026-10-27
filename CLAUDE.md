# StratCom: notes for AI assistants

Browser 3D RTS (Supreme Commander / Beyond All Reason style) with an original Fallout-inspired
setting. TypeScript pnpm monorepo. Read `docs/architecture.md` and `docs/ROADMAP.md` first.

## Commands

- `pnpm check`: format check, lint, typecheck, unit tests. Must pass before you finish
- `pnpm test`: Vitest. `pnpm build && pnpm test:e2e`: Playwright smoke tests
- `pnpm dev`: client on :5173. `pnpm dev:server`: server on :8080
- e2e needs browsers once: `pnpm exec playwright install chromium firefox webkit`. Under WSL,
  WebKit usually cannot launch (missing host libraries) and runs only in CI

## Hard rules

- **`packages/sim` must stay deterministic** (ADR-0002): no `Math.random`, no transcendental
  `Math.*` or `**`, no `Date`/`performance`/timers, no `for…in`, `sort()` needs a total
  comparator. Use `@stratcom/sim/math`. ESLint enforces this. Never disable those rules.
- **three.js only in `apps/client/src/render`** (ADR-0004).
- **Content is data** in `packages/data`, validated by zod (ADR-0006). Never branch on a
  faction id in engine code.
- **Dependency direction:** shared ← data ← sim ← apps. Packages never import apps.
- **Players and teams are N-slot.** Never hard-code two players, even while the UI is 1v1.
- **No Bethesda IP:** no Vault/Pip-Boy/Nuka/Brotherhood/Enclave names, logos or fonts
  (PLAN.md §2).
- Keep `pnpm-workspace.yaml` supply-chain settings. Don't add `minimumReleaseAgeExclude`
  entries. Prefer an older, aged version.
- TypeScript stays on 6.0.x until typescript-eslint supports 7 (ADR-0001).

## Where things live

- Content (units, weapons, factions, maps): `packages/data`, see `docs/content-authoring.md`.
  It compiles to `RULESET` with numeric ids and a hash (ADR-0009).
- Match setup from lobby settings: `createSkirmishSetup` in `packages/sim/src/skirmish.ts`.
- Client flow: `apps/client/src/screens` (Preact, `router.ts` state machine), one running
  match = `game/GameSession.ts`. Faction skins: `styles/terminal.css`, driven by theme data.
- e2e tests wait on `<html data-boot>`, `data-screen`, `data-selected`, `data-zoom`.

## Determinism tests

`detcheck.test.ts` pins hashes of a scenario that uses the fixed `TEST_RULESET`, so content
changes never repin it. Repin only for intended sim behaviour changes, with the reason in the
commit message. `runSkirmishDetScenario` (real content) is not pinned; it must match across
runtimes in `e2e/determinism.spec.ts`.

## Conventions

Tests sit beside code as `*.test.ts`. Every exported symbol gets TSDoc. Use Conventional
Commits. Significant decisions need an ADR in `docs/adr/`. Update package READMEs,
`docs/architecture.md` and `docs/ROADMAP.md` when structure or milestone status changes.

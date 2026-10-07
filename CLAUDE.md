# StratCom: notes for AI assistants

Browser 3D RTS (Supreme Commander / Beyond All Reason style) with an original Fallout-inspired
setting. TypeScript pnpm monorepo. Read `docs/architecture.md` and `docs/ROADMAP.md` first.

## Commands

- `pnpm check`: format check, lint, typecheck, unit tests. Must pass before you finish
- `pnpm test`: Vitest. `pnpm build && pnpm test:e2e`: Playwright smoke tests
- `pnpm dev`: client on :5173. `pnpm dev:server`: server on :8080

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

## Conventions

Tests sit beside code as `*.test.ts`. Every exported symbol gets TSDoc. Use Conventional
Commits. Significant decisions need an ADR in `docs/adr/`. Update package READMEs,
`docs/architecture.md` and `docs/ROADMAP.md` when structure or milestone status changes.

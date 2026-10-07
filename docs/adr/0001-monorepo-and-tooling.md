# 0001. Monorepo and tooling

- **Status:** Accepted
- **Date:** 2026-10-05

## Context

The simulation must run in the browser (sim worker), in Node (tests, server-side replay
validation) and in CI, with exactly the same code. Client, server, and tools share types for
commands, content and the network protocol. The project is maintained by a small team, so
tooling has to stay low-ceremony.

## Decision

- **One TypeScript monorepo** using **pnpm workspaces**: `apps/*` for deployables and
  `packages/*` for libraries. pnpm is pinned through `packageManager` (corepack).
- **Internal packages are consumed as TypeScript source.** Their `exports` point at
  `src/index.ts`, and there are no library build steps and no `tsc -b` project references.
  Vite, Vitest and tsx compile them on the fly. The server is bundled with esbuild, which
  inlines `@stratcom/*` and leaves npm dependencies external. Each package typechecks
  independently with `tsc -p` (`noEmit`).
- **Toolchain:** Node 24 LTS (`.nvmrc`; `engines >= 22.12` because Vitest 5 requires it),
  TypeScript **6.0** (pinned, see below), Vite 8, Vitest 5, ESLint 10 flat config with
  typescript-eslint `strictTypeChecked`, Prettier, Playwright.
- **TypeScript 7 is deliberately not used yet.** typescript-eslint 8.x supports
  `typescript < 6.1`. Type-aware linting enforces our architectural rules and is worth more
  than TS 7's compile speed. Revisit when typescript-eslint supports TS 7.
- **Supply-chain defaults stay on.** pnpm blocks dependency install scripts unless they are
  listed in `allowBuilds` (currently only `esbuild`), and it refuses releases newer than its
  minimum release age. Do not bypass these with `minimumReleaseAgeExclude` without review.

## Consequences

- Library changes need no rebuild. Editors and tests always see the current source.
- Libraries cannot be published to npm as-is. That's fine, because they are private.
- Architectural boundaries are lint-enforced (`eslint.config.js`), not structural, so CI must
  keep running `pnpm lint`.
- Type-aware linting is slow on the Windows filesystem (`/mnt/c` in WSL). Developing inside
  the WSL filesystem is recommended.

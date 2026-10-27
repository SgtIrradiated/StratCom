# Contributing to StratCom

Thanks for helping build StratCom!

1. Read [`docs/architecture.md`](docs/architecture.md) and [`docs/conventions.md`](docs/conventions.md).
2. If you touch `packages/sim`, read [ADR-0002](docs/adr/0002-deterministic-float-simulation.md).
   Determinism rules are non-negotiable.
   If you add or change units, weapons, factions or maps, follow
   [`docs/content-authoring.md`](docs/content-authoring.md). Content is data, so it needs no
   engine changes.
3. Set up the project (see the [README](README.md#getting-started)), branch from `main`, and
   make your change with tests.
4. Run `pnpm check` (format, lint, typecheck, unit tests). If you touched the client or server,
   also run `pnpm build && pnpm test:e2e`.
5. Open a pull request with a [Conventional Commits](https://www.conventionalcommits.org)
   title. Significant design changes need an ADR in `docs/adr/`.

## Content and IP

StratCom is _inspired by_ Fallout's genre and tone, but must not use protected Bethesda
material: names, logos, fonts, characters or lore. See [PLAN.md §2](docs/PLAN.md#2-setting-and-ip-guardrails)
for the avoid-list. Only contribute assets you created or that carry a compatible license.

## License

By contributing, you agree that your code is licensed under the
[AGPL-3.0-or-later](LICENSE).

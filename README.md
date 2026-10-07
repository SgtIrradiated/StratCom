# StratCom

**A browser-based 3D real-time strategy game** in the tradition of _Supreme Commander_ and
_Beyond All Reason_: huge battles, a flow economy, strategic zoom. It is set in an original
retro-futuristic wasteland, where the **Atomic Directorate** emerges from its Shelters to
reclaim the surface and the **Scrapborn Clans** intend to strip them for parts.

> **Status: pre-alpha.** The M0 foundation is done. See the [roadmap](docs/ROADMAP.md).
> The next milestone is M1: simulation core and render bridge.

## Getting started

Requirements: **Node 24 LTS** (see `.nvmrc`; Node ≥ 22.12 also works) with corepack, and Git.

```sh
corepack enable          # provides the pinned pnpm version from package.json
pnpm install
pnpm dev                 # client dev server → http://localhost:5173
```

> **Windows/WSL:** clone the repo inside the WSL filesystem (e.g. `~/projects/stratcom`),
> not under `/mnt/c`. Installs, type-aware linting and tests are many times faster there.

## Scripts

| Command                    | What it does                                                                                               |
| -------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `pnpm dev`                 | Client dev server with hot reload                                                                          |
| `pnpm dev:server`          | Server in watch mode on :8080 (the client proxies `/api`, `/healthz`, `/ws` to it)                         |
| `pnpm build`               | Production build: client → `apps/client/dist`, server → `apps/server/dist`                                 |
| `pnpm start`               | Runs the production server, which also serves the built client                                             |
| `pnpm check`               | Format check, lint, typecheck, unit tests. Run before every PR                                             |
| `pnpm test` / `test:watch` | Unit tests (Vitest)                                                                                        |
| `pnpm test:e2e`            | Browser smoke tests (Playwright). Run `pnpm build` first, and `pnpm exec playwright install chromium` once |
| `pnpm format`              | Format everything with Prettier                                                                            |

## Repository layout

```
apps/client       Vite + three.js browser client
apps/server       Fastify server: static hosting, API, (later) lockstep relay
packages/shared   Tiny shared utilities
packages/sim      Deterministic simulation (pure TypeScript)
packages/data     Factions and (later) units, weapons, maps, validated with zod
deploy/           Dockerfile, docker-compose.yml, Caddyfile
docs/             Plan, roadmap, architecture, conventions, ADRs, deployment guide
e2e/              Playwright tests
```

## Documentation

- [Foundation plan](docs/PLAN.md): vision, architecture and technology choices
- [Roadmap](docs/ROADMAP.md): milestones and exit criteria
- [Architecture](docs/architecture.md): how the code is structured today
- [Conventions](docs/conventions.md): code style, simulation rules, git, dependencies
- [Architecture Decision Records](docs/adr/README.md)
- [Deployment](docs/deployment.md): self-hosting with Docker and Caddy
- [Contributing](CONTRIBUTING.md)

## License

Code: [GNU AGPL-3.0-or-later](LICENSE). If you run a modified StratCom server for others, you
must offer them its source ([ADR-0008](docs/adr/0008-license.md)).

StratCom is an independent project inspired by the post-apocalyptic RTS and RPG genres. It is
not affiliated with or endorsed by Bethesda, Gas Powered Games, or the Beyond All Reason
project.

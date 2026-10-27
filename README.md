# StratCom

**A browser-based 3D real-time strategy game** in the tradition of _Supreme Commander_ and
_Beyond All Reason_: huge battles, a flow economy, strategic zoom. It is set in an original
retro-futuristic wasteland, where the **Atomic Directorate** emerges from its Shelters to
reclaim the surface and the **Scrapborn Clans** intend to strip them for parts.

> **Status: pre-alpha.** Milestones M0–M4 are implemented: a deterministic simulation in a
> worker, an RTS camera with strategic zoom, two factions with placeholder units, the full
> menu flow into a skirmish, and a Supreme Commander-style flow economy with construction,
> factories and reclaim. Combat and victory (M5) are next. See the [roadmap](docs/ROADMAP.md).

## What you can do today

Start `pnpm dev`, choose **Skirmish**, pick a map and the AI's faction, choose your faction
and colour, and deploy. You get your commander and a small starting force on a flattened base
site with salvage deposits behind it. Build extractors on the deposits and generators for
power, put up a factory and queue units, and send engineers to reclaim debris. Salvage and
power flow in and drain as you build; overspend and everything slows together (the HUD shows
a STALL warning). Combat and the AI's behaviour arrive in M5–M6.

| Input                       | Action                                                 |
| --------------------------- | ------------------------------------------------------ |
| Left click / drag           | Select (Shift adds; double-click selects that type)    |
| Right click                 | Move; reclaim debris or assist with builders; rally    |
| Shift + right click         | Queue the order                                        |
| Build panel, then click     | Place a structure (Shift keeps placing, R rotates)     |
| X                           | Stop                                                   |
| WASD / arrows / screen edge | Pan                                                    |
| Q / E, middle-drag          | Rotate                                                 |
| Wheel                       | Zoom to cursor; far out, units become strategic icons  |
| Ctrl+1–9, then 1–9          | Store / recall a control group (twice to centre on it) |
| C                           | Centre on your commander                               |
| Esc                         | Pause menu in a match; back on menu screens            |
| Enter                       | Primary action on menu screens                         |

Debug flags: `/?bench=2000` runs a 2,000-unit stress test with a performance panel;
`/?detcheck` runs the determinism scenarios.

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
packages/data     Content: factions, units, weapons, maps, ruleset compiler (zod)
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
- [Content authoring](docs/content-authoring.md): adding units, factions and maps
- [Deployment](docs/deployment.md): self-hosting with Docker and Caddy
- [Contributing](CONTRIBUTING.md)

## License

Code: [GNU AGPL-3.0-or-later](LICENSE). If you run a modified StratCom server for others, you
must offer them its source ([ADR-0008](docs/adr/0008-license.md)).

Fonts: [VT323](https://fonts.google.com/specimen/VT323) (Peter Hull) and
[Share Tech Mono](https://fonts.google.com/specimen/Share+Tech+Mono) (Carrois Apostrophe),
both under the [SIL Open Font License 1.1](https://openfontlicense.org), self-hosted from the
`@fontsource` packages.

StratCom is an independent project inspired by the post-apocalyptic RTS and RPG genres. It is
not affiliated with or endorsed by Bethesda, Gas Powered Games, or the Beyond All Reason
project.

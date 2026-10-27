# Architecture

A living overview of how StratCom is put together **today**. For the full design and its
rationale, see [PLAN.md](PLAN.md) and the [ADRs](adr/README.md). Update this file whenever the
structure changes.

## Workspace

```
apps/client      Browser client (Vite + three.js). Deployable.
apps/server      Node server (Fastify). Deployable. Serves the client build.
packages/shared  Dependency-free utilities (assert, Brand).
packages/sim     Deterministic simulation: ECS world, Simulation, math. No DOM/Node/renderer.
packages/data    Content definitions + zod schemas (factions today).
```

Libraries are consumed as TypeScript source and have no build step (ADR-0001).

## Dependency rules

Enforced by `no-restricted-imports` in `eslint.config.js`. An arrow means "may import".

```
             ┌──────────── apps/client ────────────┐       apps/server
             │  src/render ──▶ three (only here)   │           │
             └──────┬──────────────┬───────────────┘           │
                    ▼              ▼                           ▼
               packages/sim ──▶ packages/data ──▶ packages/shared
                    └─────────────────────────────▶ (shared)
```

| Area                                 | May not import                                                                                     |
| ------------------------------------ | -------------------------------------------------------------------------------------------------- |
| `packages/shared`                    | any `@stratcom/*`, three, preact, `node:*`                                                         |
| `packages/data`                      | `@stratcom/sim`, apps, three, preact, `node:*`                                                     |
| `packages/sim`                       | apps, three, preact, `node:*`; plus the [purity rules](adr/0002-deterministic-float-simulation.md) |
| `apps/client` (outside `src/render`) | three, `node:*`                                                                                    |
| `apps/server`                        | three, preact                                                                                      |
| `packages/*`                         | `@stratcom/client`, `@stratcom/server`                                                             |

## Runtime: current (M1)

```
Main thread                                      Sim Worker (apps/client/src/sim)
┌──────────────────────────────────────┐ commands ┌───────────────────────────────┐
│ main.ts                              │ ───────▶ │ simWorker.ts                  │
│  ├─ sim/SimClient                    │          │  └─ @stratcom/sim Simulation  │
│  ├─ render/SceneRenderer + UnitLayer │ ◀─────── │     fixed 20 Hz, step()       │
│  └─ bench/StatsPanel (?bench=N)      │ snapshots│     writeSnapshot() → transfer│
└──────────────────────────────────────┘ (3 recycled buffer sets, transferred)
```

The renderer interpolates each unit between `prev` and current position in a single snapshot
(`alpha` = time since the snapshot arrived ÷ tick length). Snapshot buffers are returned to the
worker with a `recycle` message once the next snapshot replaces them; the worker skips posting
(and keeps simulating) when all buffers are out.

Server (unchanged since M0): Fastify serves `client/dist` with COOP/COEP, plus `/healthz`.

## Runtime: target

```
Main thread: input → commands ──▶ Sim Worker: lockstep runner + @stratcom/sim
Main thread: renderer + HUD ◀── snapshots (transferable typed arrays) ── Sim Worker
Sim Worker ◀── turns ── WebSocket ── Server relay (M8)
```

The main data flow is one-way: **input → commands → simulation → snapshot → renderer/UI.**
The UI never mutates simulation state.

## Key invariants

1. The simulation is a pure function of `(MatchSetup, ordered commands)` (ADR-0002).
2. three.js lives only in `apps/client/src/render` (ADR-0004).
3. Content is data, and engine code never branches on a faction id (ADR-0006).
4. Every HTTP response carries COOP/COEP headers, so `SharedArrayBuffer` remains available.

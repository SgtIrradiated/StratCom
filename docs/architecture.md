# Architecture

A living overview of how StratCom is put together **today**. For the full design and its
rationale, see [PLAN.md](PLAN.md) and the [ADRs](adr/README.md). Update this file whenever the
structure changes.

## Workspace

```
apps/client      Browser client (Vite + three.js). Deployable.
apps/server      Node server (Fastify). Deployable. Serves the client build.
packages/shared  Dependency-free utilities (assert, Brand).
packages/sim     Deterministic simulation: ECS world, Simulation (movement, construction,
                 economy), placement rules, skirmish setup, math. No DOM/Node/renderer.
packages/data    Content: zod schemas, faction content packs, features, maps, ruleset compiler.
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

## Content pipeline

```
factions/<id>/{faction,units}.ts ─┐
movement.ts, features.ts ─────────┼─▶ compileRuleset() ─▶ RULESET (numeric ids + hash)
                                  │        zod + cross-references, all problems at once
maps/index.ts ──────┐             ▼
Skirmish config ────┴─▶ createSkirmishSetup() ─▶ MatchSetup ─▶ Simulation
                         terrain + plateaus + deposit pads, deposits, debris,
                         commander + starting force, starting resources per slot
```

The sim reads rules through the structural `SimRuleset` interface (ADR-0009), so tests and
the pinned determinism scenario can use a tiny fixed ruleset.

## Simulation tick (M4)

`Simulation.step(commands)` runs, in order (docs/PLAN.md §4.4, ADR-0010):

1. **Commands**: validated against ownership and the ruleset, then turned into per-unit order
   queues (move, build, reclaim, assist), factory production queues or rally points.
2. **Movement**: each unit works on the head of its queue. Move orders follow a flow field
   shared by the command's group; work orders walk into build range of their target through
   a small cache of shared fields.
3. **Separation**: mobile units push apart and out of structures; features take no part.
4. **Work and economy**: builders place sites and add build power to jobs, factories produce,
   reclaimers strip debris, then each player's income, storage and stall factor are settled
   and every job advances by `step × stall factor`.

Each step is a system in `packages/sim/src/systems/` (`commands`, `movement`, `separation`,
`work`); `Simulation` only wires them up and runs them in order. They share a `SimContext`
(`context.ts`): the world, the setup, navigation (`nav.ts`), the per-unit order queues
(`orders.ts`) and geometry helpers. A system that keeps per-entity-slot state registers it
with the context as a `SlotState`, which clears it whenever a slot is reused or freed and
mixes it into the state hash, so neither can be forgotten. Rule and setup types are in
`rules.ts`.

Structures mark their footprint in an occupancy grid and in every navigation grid, so units
path around them. `placement.ts` holds the placement rules as pure functions, which the
client's placement ghost reuses.

## Runtime: current (M4)

```
Main thread                                         Sim Worker (apps/client/src/sim)
┌─────────────────────────────────────────┐ commands ┌───────────────────────────────┐
│ main.ts → screens/App (Preact)          │ ───────▶ │ simWorker.ts                  │
│  ├─ screens/router.ts  menu → setup →   │          │  └─ @stratcom/sim Simulation  │
│  │   faction → loading → game → results │ ◀─────── │     fixed 20 Hz, step()       │
│  └─ game/GameSession (one per match)    │ snapshots│     writeSnapshot() → transfer│
│      ├─ sim/SimClient                   │          └───────────────────────────────┘
│      ├─ render/ Terrain+Unit+Icon layers│  (3 recycled buffer sets, transferred)
│      └─ input/ InputController+Selection│
│  InGame HUD reads the session (economy, queues); orders are commands│
└─────────────────────────────────────────┘
```

Snapshots carry, per entity, kind (unit or feature), owner, type, position, heading and
build progress, plus every player's economy figures and the factory queues the HUD shows.

Each `GameSession` creates a fresh canvas and releases its WebGL context on dispose, so a
second match never reuses a lost context. `?bench=N` starts a session directly, skipping
the menus.

The renderer interpolates each unit between `prev` and current position in a single snapshot
(`alpha` = time since the snapshot arrived ÷ tick length). Snapshot buffers are returned to the
worker with a `recycle` message once the next snapshot replaces them; the worker skips posting
(and keeps simulating) when all buffers are out.

Server (unchanged since M0): Fastify serves `client/dist` with COOP/COEP, plus `/healthz`.

## Planned: models and assets (C1–C3)

Designed in [ADR-0011](adr/0011-asset-pipeline-and-model-loading.md), not built yet. Art
never reaches the simulation, so it cannot cause a desync.

```
assets/models/<id>.glb + <id>.asset.json ──▶ tools/asset-pipeline ──▶ public/assets/models/<id>.<hash>.glb
   (authored, licence sidecar)                 check · normalise ·      public/asset-manifest.json
                                               (C3: meshopt, KTX2)
unit data: visual.model = "<id>"
                     │
Loading screen ─▶ src/assets/ (fetch bytes, cache across matches; no three.js)
                     │
                     ▼
src/render/models/ ModelLibrary ─▶ ModelProvider ─▶ UnitLayer: one InstancedMesh per (type, part)
                   GLTFLoader         model, or the placeholder box as fallback
```

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

# StratCom — Foundation Plan

> A browser-based 3D real-time strategy game in the tradition of _Supreme Commander_ and
> _Beyond All Reason_: large-scale battles, a flow economy, strategic zoom. It is set in an
> original retro-futuristic, post-nuclear world in the spirit of _Fallout_. Rendering uses WebGL2.
> The finished game is self-hosted.

This document plans the **codebase foundation**: architecture, technology choices, repository
layout, and conventions. Maps, art, and audio come later. The foundation has to let them drop
in without structural changes.

> **Status:** M0–M4 are implemented (see the roadmap for exit criteria still pending). The
> code sketches in §6 were written before implementation; the real definitions live in
> `packages/data/src/schema` and `packages/sim/src`.
> [ADR-0009](adr/0009-ruleset-compiler-and-hash.md) records how the ruleset is compiled and
> [ADR-0010](adr/0010-flow-economy-and-construction.md) how the economy works. The
> milestone plan lives in
> [`ROADMAP.md`](ROADMAP.md), and settled decisions are listed in [§12](#12-decisions).
> Architecture Decision Records in [`adr/`](adr/README.md) take precedence over this document
> where they differ.

---

## 1. Goals and non-goals

### Goals

1. **Scale.** Support 1,000–3,000 active units at a stable frame rate on a mid-range desktop GPU.
2. **Deterministic simulation.** Lockstep multiplayer, replays, and desync detection all depend on it.
3. **Data-driven content.** Factions, units, weapons, and maps are data. Adding the third faction
   should need no engine code changes.
4. **Strict separation of simulation and presentation.** The simulation never imports the renderer,
   the DOM, or the clock.
5. **Self-hostable.** One `docker compose up` serves the client, the lobby, and the game relay.
6. **Well-documented.** Every package has a README, every major decision has an ADR, and public
   APIs have TSDoc.

### Non-goals (for the foundation phase)

- Final art, maps, audio, or balance.
- Accounts, ranked matchmaking, or persistence beyond replays.
- Mobile or touch support.
- WebGPU. The plan keeps the door open (see §4.5) but targets WebGL2 only.

---

## 2. Setting and IP guardrails

The game is **inspired by** Fallout's tone: 1950s atomic-age Americana, retro-futurism, a
scavenged wasteland, dark humor. It must **not** use Bethesda's protected material, because it
will be publicly hosted:

| Avoid (protected)                                                                                       | Use instead (original)                                               |
| ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| "Vault", "Vault-Tec", "Pip-Boy", "Nuka-Cola", "Brotherhood of Steel", "Enclave", "Vault Boy", "Fallout" | "Shelter", "Directorate", "Wrist-Comp", original brands and mascots  |
| Fallout logos, fonts, UI layouts copied 1:1                                                             | Free OFL fonts (e.g. _VT323_, _Share Tech Mono_), original UI layout |
| Copied lore, characters, locations                                                                      | Original lore with the same _genre_ tropes                           |

Genre elements are not ownable: power armor, energy weapons, mutants, raiders, CRT terminals,
atomic optimism, and wasteland scavenging are all fine.

### Starting factions (working names, all data-driven)

|               | **The Atomic Directorate**                                                                      | **The Scrapborn Clans**                                           |
| ------------- | ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Fantasy       | Pre-war technocratic remnant that sheltered in bunkers and now emerges to "reclaim" the surface | Wasteland survivors, raiders, and salvagers who rebuilt from junk |
| Commander     | _Overseer_ in a walking command suit                                                            | _Warboss_ in a rolling scrap fortress                             |
| Style         | Expensive, durable, long-range energy weapons, shields                                          | Cheap, numerous, short-range ballistics/flamers, fast             |
| Economy twist | More efficient power generation                                                                 | Bonus salvage from reclaiming wrecks                              |
| UI theme      | Green phosphor terminal, clean chrome                                                           | Amber phosphor, stencil and rust textures                         |
| Palette       | Olive drab, cream, chrome, teal glow                                                            | Rust, hazard yellow, scorched black                               |

Asymmetry lives in **unit stats and rosters**, not engine code. Both factions use the same
systems: build, move, attack, reclaim, and so on.

### Economy (Supreme Commander / BAR-style continuous flow)

- **Salvage** (mass analog): from extractors placed on deposits and from reclaiming wrecks and
  debris. Reclaiming fits the wasteland theme well.
- **Power** (energy analog): from generators (reactors, scrap-burners, and so on).
- Construction drains both resources per tick while building. Stalling slows every build
  proportionally, as in SupCom/BAR.

---

## 3. High-level architecture

```
┌────────────────────────── Browser ───────────────────────────┐
│                                                               │
│  Main thread                          Sim Worker              │
│  ┌──────────────┐  commands (local)  ┌────────────────────┐   │
│  │ Input / UI   │ ─────────────────▶ │  Lockstep runner   │   │
│  │ (Preact HUD) │                    │  ┌──────────────┐  │   │
│  └──────┬───────┘                    │  │ @stratcom/sim│  │   │
│         │                            │  │ (pure, det.) │  │   │
│  ┌──────▼───────┐   snapshots (SoA   │  └──────────────┘  │   │
│  │ Renderer     │ ◀──── typed arrays,│                    │   │
│  │ (three.js,   │       transferable)└─────────┬──────────┘   │
│  │  WebGL2)     │                              │ net turns    │
│  └──────────────┘                              │              │
└────────────────────────────────────────────────┼──────────────┘
                                                 │ WebSocket
┌────────────────────────── Server (Node) ───────▼──────────────┐
│  Static file host · Lobby service · Lockstep relay            │
│  (optional) headless @stratcom/sim for replay validation      │
└───────────────────────────────────────────────────────────────┘
```

### Core principles

1. **The simulation is a pure function of (initial state, ordered command stream).** It has no
   wall-clock reads, no `Math.random`, no DOM, and no rendering types. The same code runs in the
   browser worker, in Node for tests, and on the server for replay validation.
2. **Fixed timestep.** The sim runs at **20 ticks/s** (50 ms). The renderer runs at display rate
   and interpolates between the last two snapshots.
3. **Lockstep networking.** Clients exchange only _commands_, never state. The server relays and
   orders them into turns. Bandwidth stays tiny regardless of unit count, which is how both
   SupCom and BAR (Spring engine) work.
4. **One-way data flow.** Input produces commands, the sim consumes commands and emits a snapshot,
   and the renderer and UI read the snapshot. The UI never mutates sim state directly.

---

## 4. Technology choices

| Concern              | Choice                                                                          | Rationale                                                                                                         |
| -------------------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Language             | **TypeScript (strict)** everywhere                                              | One language for client, sim, and server, so the sim can run headless on the server                               |
| Runtime              | **Node 24 LTS**                                                                 | Node 20 (currently installed) reached end of life in April 2026                                                   |
| Package manager      | **pnpm workspaces** (via corepack)                                              | Fast, strict dependency isolation for a monorepo                                                                  |
| Client bundler       | **Vite**                                                                        | Fast HMR, native worker and WASM support, good asset hashing                                                      |
| 3D rendering         | **three.js** (`WebGLRenderer`, WebGL2)                                          | Mature, flexible, light. Supports `InstancedMesh`, glTF, and KTX2. It also ships a WebGPU renderer for the future |
| UI / HUD             | **Preact** + CSS modules (DOM overlay)                                          | Text-heavy terminal-style UI is easier in the DOM than in WebGL. Preact is tiny                                   |
| ECS                  | **Custom minimal SoA ECS** in `@stratcom/sim`                                   | Full control over iteration order (determinism). Typed-array storage gives cheap hashing, snapshots, and transfer |
| Schemas / validation | **zod**                                                                         | Validates unit, faction, and map data and network messages, with types inferred from schemas                      |
| Server               | **Fastify** + **ws**                                                            | Static hosting, REST for the lobby, and WebSocket for the relay in one small process                              |
| Tests                | **Vitest** (unit/integration), **Playwright** (e2e + cross-browser determinism) | Both are Vite-native. Playwright ships Chromium, Firefox, and WebKit                                              |
| Lint / format        | **ESLint** (flat config, typescript-eslint) + **Prettier**                      | Custom lint rules enforce sim purity (§5.3)                                                                       |
| Docs                 | Markdown in `docs/`, ADRs, **TypeDoc** for API reference                        | Lives with the code and is reviewed in PRs                                                                        |
| Deployment           | **Docker** + **Caddy** reverse proxy                                            | Automatic HTTPS and a single-host deployment                                                                      |

### 4.1 Why not Babylon.js / raw WebGL / a full engine?

- **Raw WebGL**: maximum control, but months spent rebuilding loaders, materials, and shadows.
  Not worth it for a foundation.
- **Babylon.js**: excellent and batteries-included, but heavier and more opinionated. three.js's
  smaller surface fits better behind our own renderer abstraction.
- **Godot or Unity web export**: large download sizes, and weaker control over the deterministic
  simulation and the web-native networking.

### 4.2 Determinism strategy (ADR-0002)

JavaScript `number` is IEEE-754 double precision. `+ - * /`, `Math.sqrt`, and `Math.fround` are
**correctly rounded by spec**, so they produce identical results across engines. `Math.sin`,
`cos`, `atan2`, `exp`, `pow`, and similar are **implementation-approximated** and can differ
between V8, SpiderMonkey, and JavaScriptCore.

Rules for `@stratcom/sim`:

- Use only the deterministic arithmetic subset. Trig and other transcendental functions come from
  `@stratcom/sim/math` (our own polynomial or lookup-table implementations).
- RNG is a seeded **PCG32 / xoshiro128\*\*** instance that lives in sim state. `Math.random` is banned.
- No iteration over `Object.keys` on objects with numeric-like keys. Use arrays or `Map`, which
  preserve insertion order.
- Sorting must use explicit, total comparators with a tiebreak on entity ID.
- No reads of `Date`, `performance`, or anything else time-related.
- Every N ticks, compute a **state hash** (xxhash32 over the SoA typed arrays) and exchange it with
  peers. A mismatch triggers a desync report that includes a state dump.
- CI runs the same scripted match in Node, Chromium, Firefox, and WebKit, and asserts identical
  hashes.

_Fallback:_ if float determinism ever proves unreliable, the math module's API is narrow enough
to swap in fixed-point (Q16.16) arithmetic behind the same interface.

### 4.3 Rendering approach

- **Units**: one `InstancedMesh` (or a small set per LOD) per unit-type mesh. Per-instance
  attributes cover transform, team color, and build-progress/damage. Draw calls scale with unit
  _types_, not unit _count_.
- **Strategic zoom** (the signature SupCom feature): a continuous camera range from close-up to
  full-map. Above a height threshold, 3D meshes fade out and an **instanced billboard icon layer**
  (shape by role, team color) takes over. A minimap is rendered from the same icon data.
- **Terrain**: 16-bit heightmap driving a chunked mesh with LOD (geomipmapping first, clipmaps
  later if needed). Splat-map texturing (up to 4–8 layers) and decals for scorch marks and craters.
- **Projectiles and effects**: pooled instanced particles, GPU-animated where possible.
- **Post-processing** (the "wasteland look"): color-grading LUT (dusty, desaturated, warm), film
  grain, vignette, and an optional subtle bloom for energy weapons. CRT scanlines are reserved for
  UI panels and the menu, not the 3D view.
- **Fog of war**: a low-resolution visibility texture uploaded from the sim's per-team
  visibility grid and sampled by the terrain and unit shaders.
- **Assets**: glTF 2.0 (`.glb`) compressed with **meshopt**, and textures in **KTX2/Basis**.
  Until real art exists, a _placeholder asset provider_ generates primitives (boxes, cylinders)
  per unit role from the same unit definitions.

### 4.4 Simulation core systems (in tick order)

1. `CommandIngest`: apply this turn's validated player commands.
2. `Orders`: advance per-unit order queues (move, attack, build, reclaim, patrol, guard).
3. `Pathfinding`: grid A\* on a passability grid per movement class (start), upgraded to
   **hierarchical A\*** for long paths and **flow fields** for large group moves. Requests are
   budgeted per tick.
4. `Movement`: steering plus deterministic local separation/avoidance, and terrain height and slope.
5. `Targeting`: spatial-hash queries for weapons in range, with priority rules.
6. `Weapons` / `Projectiles`: ballistic arcs, hitscan beams, area damage.
7. `Economy`: income, storage, and proportional stall distribution across consumers.
8. `Construction` / `Reclaim`: build progress and wreck salvage.
9. `Health` / `Death`: damage application, wreck spawning, entity removal.
10. `Visibility`: per-team vision grid for fog of war.
11. `Snapshot` + `Hash`: emit render snapshot and periodic state hash.

The spatial index is a uniform grid hash rebuilt incrementally, and it is shared by targeting,
separation, and visibility.

### 4.5 Keeping WebGPU possible

The renderer package exposes its own interfaces (`UnitLayer`, `TerrainLayer`, `IconLayer`,
`FxLayer`). three.js types never leak outside `client/src/render`. Moving to three's
`WebGPURenderer` would then change only that folder.

---

## 5. Repository layout

```
stratcom/
├── apps/
│   ├── client/                 # Vite app: boot, menus, faction select, HUD, renderer, input
│   │   ├── src/
│   │   │   ├── boot/           # entry, capability checks (WebGL2), asset preload
│   │   │   ├── screens/        # MainMenu, FactionSelect, Lobby, Loading, InGame, Results
│   │   │   ├── ui/             # Preact HUD components + theme (per-faction terminal styles)
│   │   │   ├── input/          # camera controls, selection box, command issuing, hotkeys
│   │   │   ├── render/         # three.js — the ONLY place three is imported
│   │   │   │   ├── layers/     # TerrainLayer, UnitLayer, IconLayer, FxLayer, FogLayer
│   │   │   │   ├── post/       # LUT grading, grain, vignette
│   │   │   │   └── assets/     # glTF/KTX2 loaders, placeholder asset provider
│   │   │   ├── worker/         # sim worker entry + main<->worker message bridge
│   │   │   └── net/            # WebSocket client, lockstep turn buffer
│   │   └── public/             # static assets (fonts, icons, maps, models) — later
│   └── server/                 # Fastify: static hosting, lobby REST, lockstep relay (WS)
│       └── src/
│           ├── http/
│           ├── lobby/
│           ├── relay/
│           └── replay/         # stores command logs; optional headless validation
├── packages/
│   ├── sim/                    # @stratcom/sim — deterministic simulation (no DOM, no three)
│   │   └── src/
│   │       ├── ecs/            # World, entity allocator, SoA component stores, queries
│   │       ├── math/           # det. trig, vec2/vec3 helpers, PRNG, hashing
│   │       ├── systems/        # one file per system in §4.4
│   │       ├── spatial/        # grid hash, passability grids
│   │       ├── path/           # A*, HPA*, flow fields
│   │       ├── commands/       # command types + validation
│   │       └── snapshot/       # snapshot builder, state hash
│   ├── data/                   # @stratcom/data — zod schemas + faction/unit/weapon defs
│   │   └── src/
│   │       ├── schema/         # FactionDef, UnitDef, WeaponDef, MapDef schemas
│   │       └── factions/
│   │           ├── directorate/  # faction.ts, units/*.ts, theme.ts
│   │           └── scrapborn/
│   ├── protocol/               # @stratcom/protocol — net messages, codecs, version (added in M8)
│   └── shared/                 # @stratcom/shared — tiny utils used by everyone (Result, assert, ids)
├── tools/
│   ├── asset-pipeline/         # glTF optimize (meshopt), KTX2 encode, manifest generation
│   ├── map-tools/              # heightmap → map package, validation
│   └── det-check/              # runs scripted matches, compares hashes across runtimes
├── docs/
│   ├── PLAN.md                 # this file
│   ├── architecture.md         # living architecture overview (diagrams from §3)
│   ├── adr/                    # Architecture Decision Records (0001-*.md …)
│   ├── conventions.md          # code style, naming, determinism rules, commit format
│   ├── content-authoring.md    # how to add a unit / faction / map
│   ├── networking.md           # lockstep protocol spec
│   └── deployment.md           # self-hosting guide
├── deploy/
│   ├── Dockerfile
│   ├── docker-compose.yml
│   └── Caddyfile
├── .github/workflows/ci.yml    # lint, typecheck, test, det-check, build
├── CLAUDE.md                   # AI-assistant project context
├── README.md
├── package.json / pnpm-workspace.yaml / tsconfig.base.json / eslint.config.js
└── LICENSE
```

### 5.1 Dependency rules (enforced with ESLint `no-restricted-imports`, see `eslint.config.js`)

```
shared   ← everyone
data     ← sim, client, server            (data depends only on shared + zod)
sim      ← client/worker, server, tools   (sim depends on shared + data only)
protocol ← client/net, server             (protocol depends on shared + sim command types)
client   — nothing depends on it
server   — nothing depends on it
three    — imported ONLY under apps/client/src/render
```

### 5.2 TypeScript configuration

- `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`.
- Workspace packages are consumed as TypeScript source (`exports` points at `src/index.ts`), so
  libraries need no build step. Each package typechecks with its own `tsconfig.json` (ADR-0001).
- Packages use ESM only (`"type": "module"`).

### 5.3 Sim-purity lint rules (scoped to `packages/sim/**`)

- `no-restricted-globals`: `window`, `document`, `performance`, `Date`, `setTimeout`,
  `requestAnimationFrame`, `fetch`.
- `no-restricted-properties`: `Math.random`, `Math.sin`, `Math.cos`, `Math.tan`, `Math.atan2`,
  `Math.exp`, `Math.log`, `Math.pow`, and the other transcendental functions. Each error message
  points to `@stratcom/sim/math`.
- `no-restricted-imports`: `three`, `preact`, `node:*`.

---

## 6. Key interfaces (sketches)

### 6.1 Faction and unit definitions (`@stratcom/data`)

```ts
// schema/faction.ts
export const FactionDef = z.object({
  id: z.string().regex(/^[a-z][a-z0-9_]*$/), // "directorate"
  name: z.string(), // "The Atomic Directorate"
  tagline: z.string(),
  lore: z.string(),
  commanderUnit: z.string(), // unit id
  startingResources: z.object({ salvage: z.number(), power: z.number() }),
  theme: z.object({
    // drives faction-select + HUD styling
    phosphor: z.string(), // "#4cff7a" (green) / "#ffb000" (amber)
    accent: z.string(),
    teamColors: z.array(z.string()).min(8),
    uiSkin: z.enum(["terminal-clean", "terminal-rust"]),
  }),
  roster: z.array(z.string()), // unit ids available to this faction
});
export type FactionDef = z.infer<typeof FactionDef>;

// schema/unit.ts
export const UnitDef = z.object({
  id: z.string(),
  faction: z.string(),
  name: z.string(),
  role: z.enum([
    "commander",
    "engineer",
    "land",
    "air",
    "naval",
    "structure",
    "economy",
    "defense",
  ]),
  tech: z.number().int().min(1).max(4),
  cost: z.object({ salvage: z.number(), power: z.number(), buildTime: z.number() }),
  health: z.number(),
  movement: z
    .object({
      class: z.enum(["tracked", "wheeled", "legged", "hover", "air", "static"]),
      speed: z.number(),
      turnRate: z.number(),
      accel: z.number(),
    })
    .optional(),
  footprint: z.object({ x: z.number().int(), z: z.number().int() }),
  vision: z.number(),
  weapons: z.array(z.string()).default([]), // weapon ids
  builds: z.array(z.string()).default([]), // unit ids this can construct
  economy: z
    .object({
      salvagePerSec: z.number(),
      powerPerSec: z.number(),
      storageSalvage: z.number(),
      storagePower: z.number(),
    })
    .partial()
    .optional(),
  visual: z.object({
    model: z.string().optional(),
    icon: z.string(),
    scale: z.number().default(1),
  }),
});
```

At startup, a **registry compiler** validates all definitions, resolves cross-references (fails
fast on an unknown weapon ID, for example), and produces a compact `CompiledRuleset` with
numeric IDs that the sim uses. The ruleset hash is part of the lobby handshake, so every player
must have identical data.

### 6.2 Simulation API (`@stratcom/sim`)

```ts
export interface MatchSetup {
  seed: number;
  ruleset: CompiledRuleset;
  map: CompiledMap;
  players: { slot: number; team: number; factionId: string; color: string }[];
}

export class Simulation {
  constructor(setup: MatchSetup);
  step(commands: readonly PlayerCommand[]): void; // advance exactly one tick
  get tick(): number;
  stateHash(): number;
  writeSnapshot(out: SnapshotBuffers): void; // fills transferable typed arrays
}
```

### 6.3 Commands (the only way to change game state)

```ts
type PlayerCommand =
  | { t: "move"; units: EntityId[]; to: Vec2; queue: boolean }
  | { t: "attack"; units: EntityId[]; target: EntityId; queue: boolean }
  | {
      t: "build";
      builders: EntityId[];
      unitType: UnitTypeId;
      at: Vec2;
      facing: 0 | 1 | 2 | 3;
      queue: boolean;
    }
  | { t: "reclaim"; units: EntityId[]; target: EntityId; queue: boolean }
  | { t: "stop"; units: EntityId[] };
// … patrol, guard, assist, setFactoryQueue, etc.
```

The sim validates every command, checking ownership, affordability, and placement. A malformed
or malicious command becomes a no-op on every client in the same way, so validation preserves
determinism too.

### 6.4 Lockstep protocol (`@stratcom/protocol`)

- The server groups commands into **turns** of 2 ticks (100 ms). Each turn message is
  `{turn, commands[]}` with commands ordered by `(playerSlot, seq)`.
- Clients schedule local input `inputDelay` turns ahead. The delay adapts to the measured
  round-trip time, defaulting to 2 turns.
- If a turn hasn't arrived, the client **pauses the sim and keeps rendering**, using interpolation
  plus a "waiting for player" UI.
- Periodic `{tick, hash}` messages give desync detection.
- The protocol version and ruleset hash are checked at join time.
- Encoding is JSON at first, behind a codec interface, so a binary codec can replace it without
  touching callers.
- Replay = setup + turn log, stored server-side as `.scr` (gzipped JSON lines).

---

## 7. Game flow and the faction selector

```
Boot → capability check (WebGL2, worker, minimum texture size)
  → Main Menu ─┬─ Skirmish → Skirmish Setup (map, slots, AI) ┐
               ├─ Multiplayer → Lobby list → Lobby room ───┤
               └─ Replays / Settings / Credits             │
                                                           ▼
                                  Faction Select (per slot)
                                  · faction cards from FactionDef (name, tagline, lore)
                                  · rotating commander preview (placeholder mesh for now)
                                  · terminal-style UI recolors to the faction's phosphor
                                  · team color picker from theme.teamColors
                                           ▼
                                  Loading (assets + map + ruleset compile + hash)
                                           ▼
                                  In-Game ⇄ Pause/Menu → Results → Main Menu
```

- **Skirmish Setup is slot-based from day one.** A match is a list of slots, each with
  `{ kind: human | ai | open | closed, faction, team, color }`. v0.1 exposes only a 1v1 layout
  (you vs. one AI), but because teams are just numbers on slots, FFA (every slot on its own
  team) and team games (2v2, 3v3, 4v4) are UI work, not engine work. The same slot model backs
  the online lobby in M8.
- Screens form a tiny explicit state machine (`screens/router.ts`), not a URL router, because
  game flow is linear and stateful.
- The faction select screen is generated **entirely from the faction registry**. Adding
  `factions/<id>.ts` makes it appear automatically.

---

## 8. Hosting and deployment

- **One container** runs Node, serving the built client (`apps/client/dist`), the lobby REST API,
  and the WebSocket relay on the same origin, which avoids CORS issues.
- **Caddy** in front provides automatic Let's Encrypt TLS, HTTP/2 and HTTP/3, and Brotli/gzip.
  It serves hashed assets with `Cache-Control: immutable` and `index.html` with `no-cache`.
- Headers `Cross-Origin-Opener-Policy: same-origin` and
  `Cross-Origin-Embedder-Policy: require-corp` are set from day one. They are required if we
  later use `SharedArrayBuffer` for zero-copy snapshots between the worker and the main thread.
- Large assets (models, textures, maps) live in a mounted volume, so they can be updated
  without rebuilding the image.
- `deploy/docker-compose.yml` has two services: `stratcom` and `caddy`. A `.env` file supplies
  the domain, port, and log level.
- Health endpoint at `/healthz`. Structured JSON logs come from pino, which Fastify includes.
- `docs/deployment.md` contains a step-by-step guide for a fresh VPS.

---

## 9. Quality and documentation standards

| Area          | Standard                                                                                                                                                                                                                                                                      |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Docs          | Each package has a `README.md` covering purpose, public API, and dependency rules. TSDoc on all exported symbols. TypeDoc output is generated in CI                                                                                                                           |
| ADRs          | `docs/adr/NNNN-title.md` with Context, Decision, Consequences. Initial set: 0001 Monorepo & tooling, 0002 Deterministic float sim, 0003 Lockstep networking, 0004 three.js renderer boundary, 0005 Custom SoA ECS, 0006 Data-driven content & zod, 0007 Sim tick rate (20 Hz) |
| Tests         | Unit tests for every sim system. **Golden-replay tests**: scripted command logs with expected final hashes, re-recorded only on purpose. Cross-runtime determinism job. Playwright smoke test (boot → faction select → skirmish → 30 s → no console errors)                   |
| CI            | `format:check`, `lint`, `typecheck`, `test`, `build`, `test:e2e`, Docker build; `det-check` from M1                                                                                                                                                                           |
| Commits       | Conventional Commits (`feat(sim): …`, `fix(render): …`)                                                                                                                                                                                                                       |
| Performance   | A `?bench` URL flag spawns N units and reports sim ms/tick and frame ms. Budgets are tracked in `docs/performance.md`: **sim < 25 ms/tick at 2,000 units**, **render < 12 ms/frame**                                                                                          |
| Debug tooling | Dev overlay showing tick, entity count, path requests, the hash, and a desync log. Sim state dump to JSON                                                                                                                                                                     |

---

## 10. Milestone roadmap

Moved to [`ROADMAP.md`](ROADMAP.md) so it can be updated as milestones complete without
churning this design document.

--------- | --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| **M0** | Scaffolding | Monorepo, TS configs, ESLint (incl. sim purity rules), Prettier, Vitest, Playwright, CI, Docker/Caddy skeleton, README, CLAUDE.md, ADRs 0001–0007 | `pnpm dev` shows a blank three.js scene. CI is green. `docker compose up` serves it over HTTPS locally |
| **M1** | Sim core + render bridge | SoA ECS, det. math + PRNG, state hash, sim worker, snapshot transfer, interpolated `UnitLayer` with placeholder cubes on a flat plane | 2,000 cubes moving deterministically. Hashes match in Node and all 3 browsers |
| **M2** | Camera, selection, movement | RTS camera with **strategic zoom** and icon layer, box/click selection, move command, A\* on a passability grid, separation steering, heightmap terrain (procedural test map) | Select and move groups across hilly terrain. Zooming out switches smoothly to icons |
| **M3** | Data & factions | zod schemas, registry compiler, two faction packages with ~6 placeholder units each, **faction select screen** with terminal UI themes, main menu flow | Pick a faction, start a skirmish, and spawn the correct commander and roster |
| **M4** | Economy & construction | Salvage/Power flow economy, extractors on deposits, generators, engineer/commander build with placement ghost, factories with queues, reclaim of wrecks | Build a working base. Stalls behave proportionally |
| **M5** | Combat | Weapons, projectiles (ballistic + beam), targeting, damage, death → wrecks, fog of war, minimap | Two players (hotseat or local) can fight to commander kill |
| **M6** | Multiplayer | Lobby, lockstep relay, input delay, desync detection + report, reconnect-as-spectator, replays | Two browsers on separate machines finish a match without desync. The replay reproduces the match |
| **M7** | Skirmish AI + polish | Basic AI (build order + attack waves, as a "virtual player" that only issues commands), post-processing look, audio hooks, settings | A full single-player match against the AI |
| **Later** | Content | Real models, the asset pipeline in production use, map format v1 + editor, sound, a third faction, naval/air expansion, balance | — |

---

## 11. Risks and mitigations

| Risk                                             | Impact                          | Mitigation                                                                                                                                                                  |
| ------------------------------------------------ | ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hidden determinism bugs (float, iteration order) | Desyncs ruin multiplayer        | Lint bans, det. math module, cross-browser hash CI from M1, periodic in-game hash exchange with state dumps                                                                 |
| JS sim performance at BAR-scale counts           | Low unit cap                    | SoA typed arrays, no per-entity allocations in hot loops, path request budgets, worker thread. Hot systems can move to WASM (Rust/AssemblyScript) later behind the same API |
| Draw-call / GPU limits                           | Low frame rate on large battles | Instancing per unit type, LOD, strategic icons at distance, frustum culling per chunk                                                                                       |
| Main-thread ↔ worker transfer cost               | Stutter                         | Transferable buffers (double-buffered), optional SharedArrayBuffer (COOP/COEP headers already set)                                                                          |
| Scope creep                                      | Foundation never finishes       | Strict milestone exit criteria. Art and maps are out of scope until after v0.1                                                                                              |
| IP infringement                                  | Takedown of hosted game         | §2 guardrails. Original names, fonts, and art only. Review new content against the avoid-list                                                                               |

---

## 12. Decisions

Answered on 2026-10-05:

| #   | Question               | Decision                                                               | Consequence                                                                            |
| --- | ---------------------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| 1   | Faction names          | **Keep** "The Atomic Directorate" and "The Scrapborn Clans"            | Defined in `packages/data/src/factions/`                                               |
| 2   | Player count           | **1v1 first.** FFA and teams come later through a skirmish setup lobby | Sim and lobby use N slots + team numbers from the start. The UI exposes 1v1 until M9   |
| 3   | AI before multiplayer? | **Yes**                                                                | Skirmish AI is M6. Online multiplayer moves to M8                                      |
| 4   | Unit-count budget      | **2,000 units** is the target                                          | Performance budgets in §9 stand. WASM stays an optional later optimization             |
| 5   | License                | **Open source**                                                        | Code is AGPL-3.0-or-later (ADR-0008). Asset licensing is decided when real art arrives |

Tooling decisions made during M0 are recorded in [ADR-0001](adr/0001-monorepo-and-tooling.md).
Two of them: TypeScript is pinned to 6.0 until typescript-eslint supports TS 7, and the package
manager is pnpm 12 with build scripts blocked by default.

# StratCom Roadmap

_Last updated: 2026-10-28 21:51 CET, M6 split into M6.1–M6.5 (M1/M2 exit criteria partly pending)._

This roadmap reflects the decisions from [PLAN.md §12](PLAN.md#12-decisions):

- **1v1 first.** FFA and team games follow later through a slot-based skirmish lobby.
- **Single-player against the AI comes before online multiplayer.**
- **Performance budget: 2,000 units.**
- **Open source** under AGPL-3.0-or-later.

Each milestone ends with something playable or testable, updated docs, and green CI. Every
milestone after M0 must preserve the [simulation rules](adr/0002-deterministic-float-simulation.md):
each one adds to the determinism test suite, and none may weaken it.

```
M0 ─▶ M1 ─▶ M2 ─▶ M3 ─▶ M4 ─▶ M5 ─▶ M6 ─▶ M7 (v0.1: playable 1v1 vs AI) ─▶ M8 ─▶ M9
Foundation   Engine core       Gameplay loop      AI   Release        Online   FFA/Teams
                         └──────── Content track (art, maps, audio) can start in parallel from M3 ─▶
```

---

## ✅ M0: Foundation (done)

| Delivered                                                                                                               | Where                                    |
| ----------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| pnpm 12 monorepo: `apps/client`, `apps/server`, `packages/{shared,sim,data}`                                            | repo root                                |
| Strict TypeScript, ESLint with **architecture boundaries** and **sim-purity rules**, Prettier                           | `eslint.config.js`, `tsconfig.base.json` |
| Deterministic `Prng` (xoshiro128\*\*) and `StateHasher` (MurmurHash3), verified against the C reference implementations | `packages/sim/src/math`                  |
| zod `FactionDef` schema, plus the Atomic Directorate and the Scrapborn Clans                                            | `packages/data`                          |
| Vite + three.js client: capability check, renderer boundary, placeholder scene, boot panel                              | `apps/client`                            |
| Fastify server: static hosting, `/healthz`, COOP/COEP, cache headers, env config validation, graceful shutdown          | `apps/server`                            |
| 34 unit tests (Vitest) and 2 browser smoke tests (Playwright)                                                           | `**/*.test.ts`, `e2e/`                   |
| Dockerfile, Compose with Caddy (automatic HTTPS), CI workflow                                                           | `deploy/`, `.github/workflows/`          |
| README, CLAUDE.md, CONTRIBUTING, architecture, conventions, deployment guide, ADRs 0001–0008                            | `docs/`                                  |

**Not yet verified:** CI runs only after the first push to GitHub. The Docker image hasn't been
built locally, because no Docker engine was available; the CI `docker` job builds it. The
`pnpm deploy` step it relies on was tested locally.

---

## 🟡 M1: Simulation core and render bridge (implemented, exit criteria pending)

**Goal:** the engine heartbeat. A deterministic simulation in a worker drives thousands of
interpolated units on screen.

- SoA ECS: generational entity ids, typed-array component stores, queries in id order (ADR-0005)
- Deterministic math: `sin`/`cos`/`atan2`/`sqrt`-based vector helpers in `@stratcom/sim/math`
- `Simulation` API: `MatchSetup` with **N slots and team numbers** (not hard-coded to 2
  players), `step(commands)`, `stateHash()`, `writeSnapshot()`
- Sim Web Worker, fixed 20 Hz loop, double-buffered transferable snapshots, render
  interpolation
- `UnitLayer` (one `InstancedMesh` per unit type) replaces the M0 placeholder scene
- `tools/det-check`: one scripted scenario run in Node, Chromium, Firefox and WebKit, with
  identical hashes required. It becomes a CI job
- `?bench=N` flag and `docs/performance.md` with measured baselines

**Exit:** 2,000 placeholder units move deterministically at 60 fps. Hashes match across all
4 runtimes. The sim stays under 25 ms per tick.

**Status:**

- ✅ Sim under 25 ms per tick: 0.29 ms average in Node and 0.37 ms in the Chromium worker at 2,000 units ([performance.md](performance.md)).
- ⏳ 60 fps: needs a `/?bench=2000` run on a machine with a GPU.
- 🟡 Hashes across 4 runtimes: Node, Chromium and Firefox verified locally (identical, both
  the test and the M3 skirmish scenario). WebKit runs in CI (`e2e/determinism.spec.ts`); it
  could not launch locally (missing host libraries under WSL).
- Deviation: the det-check is an e2e spec plus `?detcheck` page flag instead of a separate
  `tools/det-check` package. It needs no extra tooling.

## 🟡 M2: Camera, terrain, selection, movement (implemented, exit criteria pending)

**Goal:** it feels like an RTS.

- RTS camera: edge/WASD pan, zoom-to-cursor, rotate. **Strategic zoom** with an `IconLayer`
  that takes over from meshes when zoomed out
- Heightmap terrain (procedural test map), chunked mesh with LOD, splat texturing
- Selection: click, box, shift-add, double-click-same-type, control groups
- Move command, grid A\* per movement class, deterministic separation steering
- `docs/networking.md` drafted early, so commands are designed to be serializable from the start

**Exit:** select and move 500 units across hilly terrain. Zooming out to the full map switches
smoothly to icons.

**Status:** implemented and covered by `e2e/rts.spec.ts` (box select, move, zoom to icons) and
sim tests (500 units cross the hills without entering blocked cells). Deviations:

- **Flow fields instead of per-unit A\*.** One Dijkstra distance field (bucket queue) per move
  command and movement class, shared by the whole group, so ordering 500 units costs one
  search, not 500. It is the "flow fields for large group moves" step from PLAN.md §4.4, taken
  first because it is simpler and cheaper for RTS group orders. Units that have line of sight
  to the goal walk straight at it.
- **Splat texturing is baked into vertex colours** (height and slope) until real texture
  assets exist (content track).
- Still to do by eye: feel-tuning of camera speeds on real hardware, and a GPU fps check.

## ✅ M3: Factions, units and game flow (done)

**Goal:** the faction selector and a real menu flow.

| Delivered                                                                                                                         | Where                                                     |
| --------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `UnitDef`, `WeaponDef`, `MovementClassDef`, `MapDef` schemas; `compileRuleset` (all problems at once, numeric ids, hash)          | `packages/data`, ADR-0009                                 |
| Two content packs: Directorate (7 units, 3 weapons) and Scrapborn (8 units, 5 weapons); 3 movement classes; 3 skirmish maps       | `packages/data/src/factions`, `maps`                      |
| `createSkirmishSetup`: N-slot setup, flattened start plateaus, commander + starting force on passable ground                      | `packages/sim/src/skirmish.ts`                            |
| Structures in the sim: never move, never pushed; mobile units are pushed clear of them                                            | `packages/sim/src/simulation.ts`                          |
| Preact screens: Main Menu → Skirmish Setup → Faction Select → Loading → In-Game → Results, as an explicit state machine           | `apps/client/src/screens`                                 |
| Slot model (`human \| ai \| open \| closed`, faction, team, colour) with validation; 1v1 layout in the UI                         | `apps/client/src/game/skirmishConfig.ts`                  |
| Terminal HUD skins (`terminal-clean` green, `terminal-rust` amber) driven by faction data; self-hosted OFL fonts                  | `apps/client/src/styles/terminal.css`                     |
| HUD: status bar, selection panel (per-type groups, unit card), build options, pause menu (resume, surrender, quit), [C] commander | `apps/client/src/screens/InGame.tsx`                      |
| Map preview from the real heightmap; rotating commander schematic                                                                 | `apps/client/src/ui`                                      |
| `docs/content-authoring.md`                                                                                                       | `docs/`                                                   |
| Determinism check extended to a real-content 4-player skirmish across engines (quality microstep)                                 | `packages/sim/src/detcheck.ts`, `e2e/determinism.spec.ts` |

**Exit:** ✅ pick either faction, start a 1v1, and spawn the correct commander. The HUD is
skinned for your faction. Covered by `e2e/flow.spec.ts` (Scrapborn: rust skin, Warboss
spawned and selectable, surrender → results → menu) and `skirmish.test.ts` (each slot gets
its own faction's commander on its start position, on every map).

Deviations and notes:

- **Placeholder starting force.** Each faction spawns its commander plus a few units from
  `startingUnits`, so there is something to command before construction exists (M4).
- **AI slots are dormant** until M6: the AI's units spawn but receive no orders.
- **Resources are static** in the HUD (the faction's starting stores) until the M4 economy.
  Build options are shown but disabled.
- **Commander preview is a 2D wireframe schematic**, not a three.js model, to keep three.js
  out of the menus (ADR-0004) and avoid a second WebGL context.
- Fonts: VT323 (display) and Share Tech Mono (body), both SIL OFL 1.1, from `@fontsource`.

## ✅ M4: Economy and construction (done)

**Goal:** build a working base from your commander.

| Delivered                                                                                                                                | Where                                                     |
| ---------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| Flow economy: income, storage, pay-as-you-build, one proportional stall factor per player                                                | `packages/sim/src/economy.ts`, `simulation.ts`, ADR-0010  |
| Order queues per unit (`queue: true` = Shift); commands `build`, `reclaim`, `assist`, `produce`, `rally`                                 | `packages/sim/src/commands.ts`                            |
| Construction: builders walk into range, place the site, build it; several builders share a site; assist                                  | `packages/sim/src/simulation.ts`                          |
| Placement rules shared by sim and client: grid snap, facing, slope, occupancy, deposits                                                  | `packages/sim/src/placement.ts`                           |
| Structures block every navigation grid; flow fields recompute lazily                                                                     | `packages/sim/src/simulation.ts`                          |
| Factories with production queues (add, remove, stop) and rally points                                                                    | `packages/sim/src/simulation.ts`                          |
| Deposits (an arc behind each start, plus field deposits on flattened pads) and seeded debris fields                                      | `packages/sim/src/skirmish.ts`, `packages/data/src/maps`  |
| Neutral features and reclaim, with the faction `reclaimMultiplier` (Scrapborn ×1.5); dismantling own structures                          | `packages/data/src/features.ts`, sim                      |
| Data: `buildRate`, `buildRange`, `placement`, `FeatureDef`, map `deposits` / `debris` / `startDeposits`, compiler checks for builders    | `packages/data`                                           |
| Client: placement ghost (green/red, R rotates, Shift keeps placing), context right click (move, reclaim, assist, rally), deposit markers | `apps/client/src/input`, `src/render`                     |
| HUD: live salvage/power with income, spending and a STALL warning; working build panel; construction and factory queue progress          | `apps/client/src/screens/InGame.tsx`                      |
| Determinism: real-content scenario now builds bases and produces units in all 4 slots; pinned hashes repinned (movement unchanged)       | `packages/sim/src/detcheck.ts`, `e2e/determinism.spec.ts` |

**Exit:** ✅ build a working base from your commander, and stalls slow everything
proportionally. Covered by `e2e/build.spec.ts` (select the commander, place an Atomic Pile
with the ghost, watch it rise and power income go from +20 to +45),
`construction.test.ts` (placement, shared sites, assist, queues, pathing around structures,
the stall factor, storage caps, reclaim, dismantling, factories) and the skirmish
determinism scenario (every player ends with extractors, a generator and a factory).

Deviations and notes:

- **Factories don't spawn half-built units.** They track progress internally and roll the
  unit out when done (ADR-0010).
- **No build priorities.** Every job of a stalled player slows by the same factor.
- **Dismantling has no UI binding yet.** The `reclaim` command accepts your own structures; a
  hotkey can follow with the M5 command card.
- **No repair**: health arrives with combat in M5, and wrecks with it. Map debris is the only
  reclaimable for now.
- The starting force from M3 stays until the AI (M6) has to build its own.
- Sim cost at 2,000 units went from about 1.15 ms to 1.3 ms per tick ([performance.md](performance.md)).

## ✅ M5: Combat and victory (done)

**Goal:** armies fight, and a match can be won.

| Delivered                                                                                                                                | Where                                                       |
| ---------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| The simulation split into systems sharing a `SimContext`, with a slot lifecycle that resets and hashes per-entity state (no hash change) | `packages/sim/src/systems`, `context.ts`, ADR-0012          |
| Health; damage queued and applied once per tick; death frees slots and cells; kills and losses per player                                | `systems/health.ts`                                         |
| Weapons: staggered targeting with priorities (armed, mobile, structures, nearest), instant hits, projectiles that can miss, area damage  | `systems/combat.ts`, `projectiles.ts`                       |
| `attack` command (right-click an enemy); attack orders chase into weapon range                                                           | `commands.ts`, `systems/movement.ts`, `input/orders.ts`     |
| Wrecks generated by the ruleset compiler (`UnitDef.wreck`, default half the salvage cost), reclaimable like debris                       | `packages/data/src/ruleset.ts`                              |
| Repair: assisting a damaged own unit restores health for the same share of its cost                                                      | `systems/work.ts`                                           |
| Victory rules (assassination by default, annihilation), defeat destroys the rest of the army, draws; Results shows kills and losses      | `systems/victory.ts`, `screens/Results.tsx`                 |
| Fog of war: per-team 32 m vision grid, allies share vision, weapons need sight; the client draws one team's view with remembered bases   | `systems/visibility.ts`, `game/FogView.ts`, terrain fog     |
| Minimap: fog, units, camera frame; click to pan, right-click to order                                                                    | `ui/Minimap.tsx`                                            |
| Placeholder combat visuals: projectiles (artillery arcs), beam and flame shots, health bars                                              | `render/CombatLayer.ts`, `render/HealthBars.ts`             |
| `?hotseat`: F9 switches the commanded player and the view; `?duel`: a short scripted fight to victory                                    | `screens/InGame.tsx`, `main.ts`, `packages/sim/src/duel.ts` |
| Determinism: the pinned scenario's test units fight; the skirmish scenario's armies meet. Node, Chromium and Firefox match               | `detcheck.ts`, `e2e/determinism.spec.ts`                    |

**Exit:** ✅ a full match can be won by destroying the enemy commander. Covered by
`victory.test.ts` (commander kill, 2v2, draw, annihilation, the real-content duel) and
`e2e/combat.spec.ts` (`?duel` ends in victory through the client; hotseat switching). With
AI slots still dormant, a full match is played by hand with `?hotseat`.

Deviations and notes:

- **Done in a different order.** The simulation was first split into systems, with no
  behaviour change. That step was not on the list, but combat would have doubled the old
  single class.
- **No line-of-fire blocking, target leading or turret arcs.** Shots ignore terrain;
  projectiles fly at where the target was; weapons aim in any direction. Turret visuals come
  with C2.
- **Fog of war is presentation in lockstep:** every peer simulates everything, so fog hides
  the enemy on screen but cannot keep it from a modified client (ADR-0012).
- **A defeated player's match ends at once**, even while allies fight on; spectating comes
  with M8.
- **Hotseat is a URL flag** (`?hotseat`), not a lobby option.
- The pinned determinism hashes were repinned three times (combat, victory state, vision),
  each with its reason in `detcheck.test.ts` and the commit.
- Sim cost at 2,000 armed units: about 0.85 ms per tick, and fights kill units, which then
  cost less ([performance.md](performance.md)).

## M6: Skirmish AI (1v1)

- The AI is a **virtual player that only issues commands**, through the same path as human
  input. That keeps it deterministic, and it works unchanged in online and team games later
- Data-driven build orders per faction, economy management, scouting, attack waves, base defense
- Difficulty levels: Easy and Normal

**Exit:** the AI beats a passive player and loses to a competent one, and full matches run
end to end.

M6 is delivered in five steps. Each one ends with a testable result, its own docs update and
green CI, and records its deviations like a full milestone. Every step adds to the
determinism suite.

### M6.1: AI runtime and harness (planned)

- Decide where the AI lives and record it in ADR-0013. Proposed: a new `packages/ai`
  (`sim ← ai ← apps`) under the same determinism lint rules, running in the sim worker and
  feeding `PlayerCommand`s into the tick's command list like human input
- `AiPlayer` interface: thinks on a fixed tick cadence, staggered per slot; reads only what
  its team can see (fog, ADR-0012) plus its own economy; emits ordinary commands
- `ai` slots from `skirmishConfig.ts` get an `AiPlayer` through the setup, `GameSession` and
  the worker; slots carry a difficulty field (no behaviour difference yet)
- Headless match runner in Node: setup plus AIs, run to victory or a tick cap, return the
  result and the state hash. Used by tests and for tuning

**Exit:** a trivial AI (it sends its starting force at the enemy start) plays through the
client and the headless runner. An AI-vs-AI run gives the same hash twice and across engines
(det-check). The AI's cost per tick is measured in [performance.md](performance.md).

### M6.2: Economy and build orders (planned)

- `AiProfileDef` in `packages/data` (zod, compiled into `RULESET`): build order steps and
  economy targets per faction. AI code never branches on a faction id
- Building through the pure placement functions (`placement.ts`): extractors on deposits,
  generators, factories; engineer production; reclaim of nearby debris; reacting to salvage
  and power stalls
- Retire the M3 placeholder starting force for every slot once the AI can build its own

**Exit:** an AI alone on a map, for each faction, has extractors, a generator and a
producing factory by a pinned tick in the headless runner, without long stalls.

### M6.3: Army and attack waves (planned)

- Production mix from the profile, rally points, produced units grouped into an army
- Attack waves when the army reaches a strength threshold, aimed at the known or expected
  enemy base; survivors regroup

**Exit:** the AI destroys a passive opponent's commander on every skirmish map, for each
faction, within a tick cap (headless runner).

### M6.4: Scouting and base defence (planned)

- Scouting with a cheap unit, remembered enemy sightings, a coarse threat map
- Defence: the army returns when the base or commander is attacked, static defences where
  the faction has them, the commander kept out of fights

**Exit:** the AI survives a scripted early rush and finds the enemy base without being given
the start positions.

### M6.5: Difficulty, tuning and full matches (planned)

- Easy and Normal as data (think interval, command rate cap, build order efficiency, wave
  size), chosen per AI slot in Skirmish Setup
- Tuning passes with AI-vs-AI runs; an e2e test starts a match against the AI from the menu
  and sees the AI build

**Exit:** the M6 exit above, on both Easy and Normal.

## M7: v0.1 "First Light", the first playable release

**Goal:** a URL you can share, with a complete 1v1 against the AI.

- Wasteland look: color-grading LUT, film grain, vignette, sky and fog, basic muzzle-flash and
  explosion particles
- Audio system with placeholder SFX and radio-static UI sounds
- Settings: graphics quality, volume, key bindings. Pause menu
- Deploy to your server with `docker compose`, following `docs/deployment.md` end to end

**Exit:** someone with only the URL can play a full 1v1 against the AI in their browser.

## M8: Online 1v1

- `@stratcom/protocol` package: versioned messages and codecs
- Lobby (create/join/ready), lockstep relay, adaptive input delay
- Desync detection with state-dump reports, reconnect, spectators
- Replays: save, list, and watch (setup + turn log)

**Exit:** two browsers on different networks complete a match without desync, and the replay
reproduces it exactly.

## M9: Skirmish lobby with FFA and teams

- 2–8 slots in Skirmish Setup and the online lobby, with team assignment and AI per slot
- Alliance rules in the sim: shared vision, allied victory, and friendly-fire policy
- Multi-start maps (4- and 8-player test maps)
- Performance pass at 8 players and 2,000 units

**Exit:** a 4-player FFA and a 2v2 (any mix of humans and AIs) work offline and online.

---

## Content track (parallel, from M3 onward)

The game is data-driven, so content can be produced alongside engine work. Models and
textures follow [ADR-0011](adr/0011-asset-pipeline-and-model-loading.md) (proposed); artists
work from the [art guide](art-guide.md).

### C1: Model loading foundation (planned, before M5)

**Goal:** a model made per the art guide appears in the game with no code change.

- `visual.model` (optional asset id) on units and features; no model keeps the box
- `assets/` source folder: `.glb` + `.asset.json` sidecar (author, licence, source) + optional
  team mask; generated `CREDITS.md`
- `tools/asset-pipeline` on glTF-Transform: `pnpm assets:check` (in `pnpm check` and CI) and
  `pnpm assets:build` (before dev and build): validation rules, normalisation, content-hashed
  output and `asset-manifest.json`
- Client: manifest and byte loading in `src/assets/` with a loading-screen step and a cache
  across matches; `ModelLibrary` and a `ModelProvider` interface in `src/render/models/`;
  `UnitLayer` draws models or placeholder boxes per type
- Team-colour mask in the material; build progress, selection and strategic zoom work on
  models unchanged
- One real CC0 or self-made model committed as the first asset

**Exit:** drop a `.glb` and its sidecar into `assets/models/`, add `model: "<id>"` to the unit,
and it shows in a match in its owner's colours. `pnpm check` rejects a model with a wrong
scale, a floating origin or no licence, naming the file and the rule. A missing or broken
model falls back to the box with a warning, never an error. Covered by unit tests on the
validator (fixtures built in memory with glTF-Transform) and an e2e check that the first
asset loads.

### C2: Articulated parts (planned, with M5)

- Named parts (`turret`, `barrel`) as their own instanced meshes, aimed from the snapshot
- `muzzle` points from the manifest for muzzle flashes and projectile origins

**Exit:** a tank's turret tracks its target while the hull drives the other way.

### C3: Asset optimisation (planned, before M7)

- meshopt geometry compression; KTX2/Basis (or resized WebP) textures; decoders served from
  our own origin
- A download-size budget for the first release, reported in CI

**Exit:** the full asset set loads within the budget on a cold cache, and `pnpm build`
reports sizes per asset.

### Later

- Terrain texture sets (replacing the vertex colours), decals
- Animation for walkers (vertex animation textures or rigid part animation)
- Map format v1, map tools, and eventually an editor
- Music, SFX, voice lines
- Asset licensing decision (for example CC BY-SA 4.0), separate from the AGPL code license.
  Needed before the first original art is merged (ADR-0011)

## Later

A third faction · air and naval layers · tech tiers 2–4 · balance passes · accounts and
ranked play · WebGPU renderer (behind the ADR-0004 boundary) · WASM for hot sim systems if
profiling demands it

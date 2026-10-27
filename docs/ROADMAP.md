# StratCom Roadmap

_Last updated: 2026-10-27, M1 implemented (exit criteria partly pending)._

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
- ⏳ Hashes across 4 runtimes: Node and Chromium verified locally (identical); Firefox and WebKit run in
  CI (`e2e/determinism.spec.ts`) and have not yet been run.
- Deviation: the det-check is an e2e spec plus `?detcheck` page flag instead of a separate
  `tools/det-check` package. It needs no extra tooling.

## M2: Camera, terrain, selection, movement

**Goal:** it feels like an RTS.

- RTS camera: edge/WASD pan, zoom-to-cursor, rotate. **Strategic zoom** with an `IconLayer`
  that takes over from meshes when zoomed out
- Heightmap terrain (procedural test map), chunked mesh with LOD, splat texturing
- Selection: click, box, shift-add, double-click-same-type, control groups
- Move command, grid A\* per movement class, deterministic separation steering
- `docs/networking.md` drafted early, so commands are designed to be serializable from the start

**Exit:** select and move 500 units across hilly terrain. Zooming out to the full map switches
smoothly to icons.

## M3: Factions, units and game flow

**Goal:** the faction selector and a real menu flow.

- `UnitDef`/`WeaponDef` schemas, a ruleset compiler (string ids to numeric ids), and a ruleset hash
- About 6 placeholder units per faction: commander, engineer, extractor, generator, factory,
  and 1–2 combat units
- Preact screens: Main Menu → **Skirmish Setup** (1v1: map, your faction and colour, AI
  opponent's faction) → **Faction Select** → Loading → In-Game → Results
- Skirmish Setup uses the **slot model** (`human | ai | open | closed`, faction, team, colour),
  showing only a 1v1 layout for now
- Terminal HUD skins: green phosphor for the Directorate, amber for the Scrapborn. Self-hosted
  OFL fonts
- `docs/content-authoring.md`: how to add a unit or a faction

**Exit:** pick either faction, start a 1v1, and spawn the correct commander. The HUD is
skinned for your faction.

## M4: Economy and construction

- Salvage and Power flow economy with storage and proportional stalling
- Extractors on deposits, generators, wreck/debris **reclaim**
- Build commands with a placement ghost, footprints, build queues, factories, assist

**Exit:** build a working base from your commander. Stalls slow everything proportionally.

## M5: Combat and victory

- Weapons (ballistic, beam, area damage), projectiles, targeting priorities
- Death leaves wrecks that can be reclaimed. Commander-kill victory condition and the Results
  screen
- Fog of war (per-team vision grid) and a minimap
- Debug "hotseat" mode to control both sides for testing

**Exit:** a full match can be won by destroying the enemy commander.

## M6: Skirmish AI (1v1)

- The AI is a **virtual player that only issues commands**, through the same path as human
  input. That keeps it deterministic, and it works unchanged in online and team games later
- Data-driven build orders per faction, economy management, scouting, attack waves, base defense
- Difficulty levels: Easy and Normal

**Exit:** the AI beats a passive player and loses to a competent one, and full matches run
end to end.

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

The game is data-driven, so content can be produced alongside engine work:

- Real unit models (glTF + meshopt, KTX2 textures) through `tools/asset-pipeline`
- Map format v1, map tools, and eventually an editor
- Music, SFX, voice lines
- Asset licensing decision (for example CC BY-SA 4.0), separate from the AGPL code license

## Later

A third faction · air and naval layers · tech tiers 2–4 · balance passes · accounts and
ranked play · WebGPU renderer (behind the ADR-0004 boundary) · WASM for hot sim systems if
profiling demands it

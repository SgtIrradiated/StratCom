# Performance

Budgets come from [ADR-0007](adr/0007-simulation-tick-rate.md) and the [roadmap](ROADMAP.md):
**2,000 units at 60 fps; under 25 ms per sim tick** (50 ms available at 20 Hz).

## How to measure

- **Sim only (Node):** step `createTestMatch(2000)` with `scriptedCommands` and time each
  `step()`. This is the cheapest check and is browser-independent.
- **In the browser:** open `/?bench=2000` (dev server or production build). The bottom-right
  panel shows fps, draw calls, mean and worst sim tick, and the state hash. The tick figures
  come from the worker, so they include no rendering cost.
- **Determinism:** `pnpm build && pnpm test:e2e` runs `e2e/determinism.spec.ts` in Chromium,
  Firefox and WebKit against the Node result, for both the pinned test scenario and the
  real-content skirmish scenario. Firefox and WebKit need `pnpm exec playwright install
firefox webkit`; WebKit also needs host libraries (`sudo pnpm exec playwright install-deps
webkit`) that are often missing under WSL.

## Baselines

| Date            | Machine / runtime                                    | Scenario                                                                                              | Result                                                                                                                     |
| --------------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| 2026-10-27      | WSL2, Node 20.19, Vitest (V8), one run               | 2,000 units, 400 ticks                                                                                | tick avg **0.29 ms**, worst 15.6 ms (JIT warm-up on the first ticks)                                                       |
| 2026-10-27      | Headless Chromium in the sim worker (`/?bench=2000`) | 2,000 units, 8 s                                                                                      | tick avg **0.37 ms**, max 2.4 ms                                                                                           |
| 2026-10-27 (M2) | WSL2, Node 20.19, 720 warm ticks                     | 2,000 units, hills, flow fields, separation, 2 players re-ordering every 40 ticks                     | tick avg **1.18 ms**, worst 11 ms (the tick where both players' flow fields are computed)                                  |
| 2026-10-27 (M3) | WSL2, Node 20.19 (Vitest), 720 warm ticks            | Same as M2 (separation now handles structures)                                                        | tick avg **1.08 ms**, worst 14 ms: no regression                                                                           |
| 2026-10-27 (M4) | WSL2, Node 20.19 (Vitest), 720 warm ticks, 3 runs    | Same as M2, with order queues and the economy step                                                    | tick avg **1.25–1.36 ms** (M3 build, same runs: 1.11–1.20 ms); the economy step: 0.06 ms                                   |
| 2026-10-27 (M5) | CachyOS, Node 24.22 (Vitest), 720 warm ticks, 2 runs | Same as M2, but every test unit is armed (beam or cannon) and about 1,000 of 2,000 die; fog of war on | tick avg **0.84–0.86 ms**, worst 8 ms. Same machine, M4 code: 0.97–1.01 ms (movement only). Vision: about 0.05 ms per tick |

### Match start-up (M3)

Measured in Node on the same machine, warm, 1v1 with each faction's starting force (19 units):

| Map            | Size    | `createSkirmishSetup` (terrain, plateaus, placement) | `new Simulation` (nav grids) |
| -------------- | ------- | ---------------------------------------------------- | ---------------------------- |
| Ashfall Basin  | 2,048 m | 10.5 ms                                              | 1.3 ms                       |
| Rustbelt Ridge | 2,048 m | 7.0 ms                                               | 1.4 ms                       |
| Glassed Flats  | 1,280 m | 2.7 ms                                               | 0.7 ms                       |

Loading time is dominated by the renderer, the worker start and the first snapshot, not by
match setup. The real-content determinism scenario (`runSkirmishDetScenario`, 1,200 ticks,
4 players building bases since M4) takes about 2 s in Node.

**Not yet measured:** frame rate on a real GPU. Headless Chromium here uses SwiftShader
(software GL) and showed about 16 fps at 2,000 units; that says nothing about GPU hardware.
The 60 fps exit criterion needs a run of `/?bench=2000` on a machine with a GPU; record the
result in the table above.

## Notes

- The sim's costly systems so far are flow-field searches (one per move order and movement
  class) and separation. The M4 economy step is one pass over the entities (about 0.06 ms
  at 2,000 units); placing or removing a structure makes the affected flow fields recompute
  once. Re-measure at each milestone.
- M5 combat stays cheap because targeting is staggered (a weapon without a target searches
  every 5th tick) on a 64 m grid, and vision stamps cached discs every 4th tick, once per
  team, cell and radius. Damage is one sorted pass over the units hit that tick.
- Order queues are read length-first, because indexing past the end of an empty JS array is
  a slow path in V8. That fix, together with checking the structure-occupancy grid only when
  a move is blocked, took the first M4 build from about 1.6 ms to 1.3 ms per tick.
- The real ruleset has three movement classes, so a skirmish builds three navigation grids,
  and a mixed-class move order runs up to three flow-field searches.
- Draw calls scale with unit _types_ (one `InstancedMesh` each), not with unit count.

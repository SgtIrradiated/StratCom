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
  Firefox and WebKit against the Node result.

## Baselines

| Date       | Machine / runtime                                    | Scenario               | Result                                                               |
| ---------- | ---------------------------------------------------- | ---------------------- | -------------------------------------------------------------------- |
| 2026-10-27 | WSL2, Node 20.19, Vitest (V8), one run               | 2,000 units, 400 ticks | tick avg **0.29 ms**, worst 15.6 ms (JIT warm-up on the first ticks) |
| 2026-10-27 | Headless Chromium in the sim worker (`/?bench=2000`) | 2,000 units, 8 s       | tick avg **0.37 ms**, max 2.4 ms                                     |

**Not yet measured:** frame rate on a real GPU. Headless Chromium here uses SwiftShader
(software GL) and showed about 16 fps at 2,000 units; that says nothing about GPU hardware.
The 60 fps exit criterion needs a run of `/?bench=2000` on a machine with a GPU; record the
result in the table above.

## Notes

- Movement is the only costly system in M1 (no separation, pathfinding or targeting yet), so
  these numbers will rise as M2–M5 land. Re-measure at each milestone.
- Draw calls scale with unit _types_ (one `InstancedMesh` each), not with unit count.

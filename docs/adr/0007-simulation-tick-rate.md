# 0007. 20 Hz simulation tick, 2-tick network turns

- **Status:** Accepted
- **Date:** 2026-10-05

## Context

Supreme Commander simulates at 10 Hz and Spring/BAR at 30 Hz. A higher rate gives smoother
movement and more precise projectiles, but costs CPU, and in JavaScript the CPU budget is the
limiting factor at 2,000 units.

## Decision

- The simulation runs at **20 ticks per second** (50 ms; `TICK_RATE` in `@stratcom/sim`).
- Network turns batch **2 ticks** (100 ms).
- Rendering runs at display rate and interpolates between the two most recent snapshots.

## Consequences

- Each tick has a 50 ms budget, and we target under 25 ms at 2,000 units to leave headroom on
  slower machines.
- Fast projectiles need swept collision tests instead of point checks.
- Changing the tick rate later invalidates replays and balance values tuned per tick. Express
  gameplay values per second and convert them with `TICK_RATE`.

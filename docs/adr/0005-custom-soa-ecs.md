# 0005. Custom structure-of-arrays ECS

- **Status:** Accepted (implemented in M1)
- **Date:** 2026-10-05

## Context

The simulation must handle 2,000+ units at 20 Hz in JavaScript, hash its full state cheaply,
and transfer snapshots to the main thread. Iteration order must be deterministic.

## Decision

Write a minimal entity-component-system in `@stratcom/sim/ecs`:

- Generational entity ids (index plus generation), so stale references are detected.
- Components stored as **structure-of-arrays typed arrays** (`Float64Array` for positions,
  `Uint32Array` for ids/flags), indexed by entity index.
- Queries iterate in ascending entity index. That order is deterministic and cache-friendly.
- Systems are plain functions `(world, ctx) => void`, run in the fixed order in PLAN.md §4.4.

Third-party ECS libraries such as bitECS were considered. We avoid them so that iteration
order, storage layout and hashing stay under our control, and because the core is only a few
hundred lines.

## Consequences

- State hashing and snapshots are linear scans over typed arrays.
- No per-entity object allocation in hot loops, so garbage-collection pauses stay low.
- Variable-length data (order queues, paths) needs side tables, designed carefully in M1.

## Implementation notes (M1)

- Entity id = 20-bit slot index + 12-bit generation; generations start at 1 so id 0 means
  "none". Capacity is therefore at most 2^20 live entities.
- Freed slots go on a LIFO free list, and the free list is part of the state hash, so slot
  reuse is covered by desync detection.
- Variable-length data (order queues, paths) is still open; M2 adds the first side table for
  paths.

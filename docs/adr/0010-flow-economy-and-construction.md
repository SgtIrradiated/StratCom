# 0010. Flow economy, construction and structures in the simulation

- **Status:** Accepted
- **Date:** 2026-10-27

## Context

M4 adds the Supreme Commander / Beyond All Reason economy from PLAN.md §2: salvage and power
arrive continuously and drain while things are built, and a shortfall slows every build
proportionally. It also adds structures that builders place on the map, factories with
queues, and reclaim. These rules live in the deterministic simulation (ADR-0002), are driven
only by commands (ADR-0003), and must stay N-player and faction-agnostic (ADR-0006).

Questions to settle: how cost is charged, how a stall is shared out, what a building site is,
how factories hold their work, how structures interact with pathfinding, and what is neutral.

## Decision

- **Pay as you build.** Nothing is charged up front. Each tick a job with build power `r`
  (the sum of its builders' `buildRate`) wants `step = r·dt / buildTime` progress, capped at
  what is left, and draws `step × cost` of each resource. Commands are therefore never
  rejected for affordability; a player with nothing simply builds at zero speed.
- **One stall factor per player.** For each resource the factor is
  `min(1, (stored + income) / demand)`. The player's factor is the smaller of the two, and
  every job of that player progresses at `step × factor`. Then
  `stored = clamp(stored + income − spent, 0, capacity)`; income over capacity is lost.
  Capacity is the sum of `storage*` over finished units. Using the minimum of both resources
  means a power stall also stops salvage spending, so nothing is drained for progress that
  does not happen.
- **A site is a real entity.** A mobile builder walks into `buildRange` of the site, then
  spawns the structure with `progress = 0`. Unfinished units do nothing: no income, storage
  or building. Builders given the same order adopt the site the first one placed, and assist
  orders add build power to whatever the target is building. All jobs are resolved
  from entity ids each tick, so stale references are harmless.
- **Factories do not spawn frames.** A factory keeps a production queue (unit type ids) and a
  progress value for its head. When the head completes, the unit spawns in front of the
  factory and drives to the rally point. This keeps half-built tanks out of separation and
  pathfinding.
- **Structures block pathing.** Placing a structure marks its footprint in an occupancy grid
  and clears those cells in every movement class's navigation grid; removing it restores the
  terrain passability. A grid version counter makes flow fields recompute lazily (and moves
  goals off newly blocked cells). Work orders share flow fields through a small,
  insertion-ordered cache that only ever saves work. Units caught inside a new footprint may
  move freely until they leave it.
- **Placement is a pure module** (`placement.ts`) shared by the sim and the client's ghost:
  grid snapping, footprint rotation by facing, slope limit (`BUILD_MAX_SLOPE`), occupancy,
  and deposits. Extractors (`placement: "deposit"`) snap onto the nearest deposit; other
  structures may not cover one. Deposits sit on cell corners, so deposit structures need even
  footprints (the ruleset compiler enforces it).
- **Neutral features are entities** with `kind = feature`, owner `NEUTRAL_OWNER` and a type
  indexing `ruleset.features`. They do not take part in separation or block anything.
  `progress` holds the fraction of their salvage left. Reclaim yields
  `buildRate × 10` salvage per second, times the reclaimer's faction `reclaimMultiplier`
  (the Scrapborn twist, as data). Players can dismantle their own structures for their
  salvage cost.
- **The state hash covers all of it:** entity kind and progress, order queues, production
  queues, rally points and every player's economy figures. The pinned hashes were repinned
  for this. A positions-only hash of the old determinism scenario is unchanged, which shows
  movement did not change.

## Consequences

- Balance is all data: costs, build times, build rates, ranges, storage and income rates.
- Every job of a player slows by the same factor, with no priorities. BAR-style build
  priorities, or pausing a job, would be a later addition to this model.
- Cancelling a factory's head or stopping a factory discards that unit's progress, and what
  it cost. Dismantling refunds salvage only. Both are simple, and may be revisited for feel.
- Structures that block navigation make flow fields depend on game state, not just terrain.
  Recomputation is bounded by how often structures appear, which is rare next to unit moves.
- Snapshots grew: kind, progress, the per-player economy (`ECON_STRIDE` figures per slot) and
  a small structured-cloned list of factory queues.
- The `MAX_PLAYERS` (16) cap on slots comes from the fixed-size economy arrays.

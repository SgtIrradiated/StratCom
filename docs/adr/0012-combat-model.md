# 0012. Combat model: weapons, damage, death, vision and victory

- **Status:** Accepted (implemented in M5)
- **Date:** 2026-10-27

## Context

M5 adds combat to a simulation that must stay deterministic (ADR-0002), run 2,000 units
inside the tick budget (ADR-0007), and work unchanged for N players and teams (M9). The
content already described weapons (`WeaponDef`: kind, damage, range, reload, area,
projectile speed) and gave units health and vision. The engine read none of it.

`Simulation` was also a single 1,267-line class. Adding combat to it would have made two
desync bugs easy to write: per-entity state that is not cleared when a slot is reused, and
state that is left out of the hash.

## Decision

**Systems and a slot lifecycle.** The simulation is split into systems
(`packages/sim/src/systems/`) that share a `SimContext`. Every system that keeps per-entity
state registers it as a `SlotState`. The context then clears it whenever a slot is reused
and mixes it into the state hash, in registration order. The tick order is commands,
movement, separation, combat, work and economy, damage and death, victory, then vision.

**Damage is queued and applied once.** Weapons call `HealthSystem.damage()`. Damage is
applied late in the tick, in ascending slot order, so the order in which units fire never
matters, and two units can kill each other on the same tick. A unit at or below 0 hp is
removed through the same path as everything else: its slot is freed, along with a
structure's cells.

**Wrecks are generated content.** The ruleset compiler appends one feature,
`<unit>__wreck`, for every unit whose `wreck` is not `false`. It is worth
`salvageFraction` (default 0.5) of the unit's salvage cost. The sim spawns it with the dead
unit's build progress as its remaining fraction, so a half-built site leaves half a wreck.
The sim never learns what a wreck is: it is a feature like any other.

**Targeting is staggered and grid-based.** A second spatial grid with 64 m buckets holds
the units, and `SpatialGrid.forEachNear` answers queries of any radius. A weapon keeps a
valid target. Without one, it looks only every 5th tick (offset by slot), so the search
cost spreads evenly across ticks. Priority is armed units, then other mobile units, then
structures, then nearest, then lowest slot: a total order. An attack order's target
overrides this whenever it is in range.

**Projectiles live outside the ECS.** Shots with `projectileSpeed > 0` go into a fixed
pool of 8,192 projectiles. The pool is structure-of-arrays with a LIFO free list, and it is
hashed. Projectiles fly in a straight line to where the target was when they were fired, so
slow shells miss units that move away. When the pool is full, a shot lands at once. Rapid
fire would otherwise churn entity generations and fill the entity capacity. Instant weapons
(no `projectileSpeed`) hit on the spot. Area damage hits every hostile unit whose edge lies
inside the area.

**One alliance test.** `SimContext.hostile(a, b)` (both players, different teams) is the
only enemy check. Weapons and area damage never hit allies. The M9 alliance and
friendly-fire rules change this function and nothing else.

**Vision is simulation state.** Each team has a 32 m vision grid. Each cell is visible or
explored, and the grid is recomputed every 4 ticks from cached discs. Allies share vision
because it is kept per team. Weapons fire only at what their team sees, so a weapon that
outranges its own sight needs a spotter. Vision is also what a fair M6 AI must read. The
grid is hashed.

**Victory is a match rule.** `MatchSetup.rules.victory` is `assassination` (the default) or
`annihilation`. Under assassination, a player is defeated when their last commander dies.
A player who started without a commander is defeated when they have nothing left. A
defeated player's units are destroyed through the normal death path. The match is over
when every undefeated player is on one team. If nobody is left, it is a draw. A setup with
only one team never ends this way.

**The client filters what a player sees.** The simulation knows everything; in lockstep,
every peer does. `FogView` (client) turns a snapshot into one team's view: enemies while
seen, remembered enemy structures, and features on explored ground. Rendering and picking
both use that view.

## Consequences

- Combat adds about 0.05–0.1 ms per tick at 2,000 units in Node. Targeting stays bounded by
  the stagger, and vision by the disc cache.
- Things not modelled yet: terrain blocking line of fire, target leading, turret arcs
  (`C2` adds turret visuals), build priorities and repair priorities. Each can be added
  inside its own system.
- Fog of war in lockstep is presentation only: a modified client can show the whole map.
  Hiding state from peers needs a different network model and is out of scope.
- Event output (`fire`, `death`) is presentation only. It is not hashed, and it is capped
  between snapshots, so effects can be dropped without changing the match.
- The pinned determinism hashes were repinned for combat, for victory state, and for
  vision. The system split before them changed no hash.

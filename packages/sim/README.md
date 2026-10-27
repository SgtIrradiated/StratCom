# @stratcom/sim

The deterministic game simulation. Given the same `MatchSetup` and the same ordered stream of
player commands, it produces **bit-identical state on every machine and browser**. Lockstep
multiplayer, replays, and desync detection all rely on this property.

## Status

| Module                                           | State                                   |
| ------------------------------------------------ | --------------------------------------- |
| `math/prng` — `Prng` (xoshiro128\*\*)            | ✅ M0, verified against the C reference |
| `math/hash` — `StateHasher` (MurmurHash3_x86_32) | ✅ M0, verified against the C reference |
| `TICK_RATE` / `TICK_MS`                          | ✅ M0 (20 Hz, ADR-0007)                 |
| `math/trig`, `math/vec` — `sin`, `cos`, `atan2`  | ✅ M1, polynomial, ~1e-9 accurate       |
| `ecs/` — `World` (SoA, generational ids)         | ✅ M1 (ADR-0005)                        |
| `Simulation` — `step`, `stateHash`, snapshots    | ✅ M1: command ingest + movement only   |
| `detcheck` — cross-runtime determinism scenario  | ✅ M1 (`e2e/determinism.spec.ts`)       |
| `terrain` — heightmap, height sampling, raycast  | ✅ M2                                   |
| `navigation` — nav grids, flow fields, LOS       | ✅ M2 (one field per move command)      |
| `spatialGrid` + separation steering              | ✅ M2                                   |
| Economy, combat, fog                             | M4+ (see `docs/ROADMAP.md`)             |

## Rules (enforced by ESLint and `tsconfig.json`)

- No DOM, no Node built-ins, no renderer or UI imports. The tsconfig has no `DOM` lib and no
  `@types/node`, so host APIs do not even type-check.
- No `Math.random`, no transcendental `Math.*` functions (`sin`, `cos`, `atan2`, `pow`, …), no `**`.
  Use `@stratcom/sim/math`.
- No `Date`, `performance`, timers, or other clock reads. Time is the tick counter.
- No `for…in`; `sort()` always takes an explicit, total comparator (tiebreak on entity id).

The rationale is in [ADR-0002](../../docs/adr/0002-deterministic-float-simulation.md).

## Imports

```ts
import { Prng, Simulation, StateHasher, TICK_RATE } from "@stratcom/sim";
import { Prng } from "@stratcom/sim/math"; // math only
```

## Using the simulation

```ts
const sim = new Simulation(setup); // MatchSetup: seed, map, N player slots, unit types, units
sim.step(commands); // exactly one tick; commands are validated, never trusted
sim.stateHash(); // 32-bit hash of the full state (desync detection)
sim.writeSnapshot(buffers); // fills reusable typed arrays for the renderer
```

`createTestMatch(n)` and `scriptedCommands()` build the stress scenario used by tests,
`?bench=N` and the determinism check. If `detcheck.test.ts` fails after a sim change, the
change altered simulation behaviour: update the pinned hashes only if that is intended.

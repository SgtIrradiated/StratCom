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
| `Simulation` — `step`, `stateHash`, snapshots    | ✅ M1; systems and `SimContext` in M5   |
| `detcheck` — cross-runtime determinism scenario  | ✅ M1 (`e2e/determinism.spec.ts`)       |
| `terrain` — heightmap, height sampling, raycast  | ✅ M2                                   |
| `navigation` — nav grids, flow fields, LOS       | ✅ M2 (one field per move command)      |
| `spatialGrid` + separation steering              | ✅ M2; structures never move (M3)       |
| `SimRuleset` — rules by numeric id               | ✅ M3 (ADR-0009)                        |
| `skirmish` — `createSkirmishSetup`, map plateaus | ✅ M3                                   |
| `runSkirmishDetScenario` — real-content detcheck | ✅ M3; builds bases since M4            |
| `economy` — flow economy, stall factor           | ✅ M4 (ADR-0010)                        |
| `placement` — snapping, footprints, deposits     | ✅ M4, shared with the client ghost     |
| Construction, factories, reclaim, features       | ✅ M4 (ADR-0010)                        |
| `systems/combat`, `projectiles` — weapons        | ✅ M5 (ADR-0012)                        |
| `systems/health` — damage, death, wrecks, repair | ✅ M5                                   |
| `systems/victory` — defeat and match result      | ✅ M5 (assassination, annihilation)     |
| `systems/visibility` — fog of war per team       | ✅ M5, weapons need sight               |

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
const setup = createSkirmishSetup({
  seed,
  map: getMap("ashfall_basin"),
  ruleset: RULESET,
  players,
});
const sim = new Simulation(setup); // MatchSetup: seed, terrain, N player slots, ruleset, units
sim.step(commands); // exactly one tick; commands are validated, never trusted
sim.stateHash(); // 32-bit hash of the full state (desync detection)
sim.writeSnapshot(buffers); // fills reusable typed arrays for the renderer
sim.economy(slot); // stored, capacity, income, spending, demand, stall factor
sim.matchStatus(); // each player's kills, losses and defeat; whether a team has won
```

Inside, `Simulation` runs one system per step of the tick (`src/systems/`), sharing a
`SimContext`. A system that keeps per-entity state registers it as a `SlotState`, so it is
cleared when a slot is reused and included in the state hash (ADR-0012).

`createSkirmishSetup` turns lobby settings into a `MatchSetup`: it generates the map with
flattened start plateaus and deposit pads, places deposits and debris, and spawns each
player's commander and starting force with the faction's starting resources. It is pure, so
every peer derives the same setup.

Commands (`commands.ts`): `move`, `stop`, `build`, `reclaim`, `assist`, `produce`, `rally`.
Work orders hold entity ids and are re-resolved every tick. How construction, factories,
reclaim and the stall factor work is in
[ADR-0010](../../docs/adr/0010-flow-economy-and-construction.md); `construction.test.ts`
shows each rule on a small flat test map.

`createTestMatch(n)` and `scriptedCommands()` build the stress scenario used by tests,
`?bench=N` and the determinism check. It runs on the fixed `TEST_RULESET`, so content
rebalances never move the pinned hashes. If `detcheck.test.ts` fails after a sim change, the
change altered simulation behaviour: update the pinned hashes only if that is intended.

## Dependencies

`@stratcom/shared`, and `@stratcom/data` for content types and the skirmish scenario.

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
| ECS world, systems, commands, snapshots          | M1+ (see `docs/ROADMAP.md`)             |

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
import { Prng, StateHasher, TICK_RATE } from "@stratcom/sim";
import { Prng } from "@stratcom/sim/math"; // math only
```

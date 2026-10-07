# 0002. Deterministic floating-point simulation

- **Status:** Accepted
- **Date:** 2026-10-05

## Context

Lockstep multiplayer (ADR-0003), replays and desync detection require every client to compute
**bit-identical** simulation state from the same inputs, across V8 (Chrome, Node),
SpiderMonkey (Firefox) and JavaScriptCore (Safari).

ECMAScript numbers are IEEE-754 doubles. The spec requires `+ - * /`, `%`, `Math.sqrt`,
`Math.fround`, `Math.round`, `Math.floor`, `Math.ceil`, `Math.trunc`, `Math.abs`, `Math.min`,
`Math.max`, `Math.sign`, `Math.imul` and integer bit operations to give exact,
correctly-rounded results. Transcendental functions (`Math.sin`, `cos`, `tan`, `atan2`, `exp`,
`log`, `pow`/`**`, `hypot`, `cbrt`, …) are **implementation-approximated** and do differ
between engines.

Fixed-point arithmetic would also be deterministic, but it is awkward in JavaScript (64-bit
intermediate products need splitting or BigInt) and makes gameplay code much harder to read.

## Decision

The simulation uses ordinary doubles, restricted to the exactly-specified subset above.

1. Transcendental math comes only from `@stratcom/sim/math`, our own implementations built
   on the exact subset (polynomials or lookup tables).
2. Randomness comes only from the seeded `Prng` (xoshiro128\*\*) stored in simulation state.
3. The sim never reads the clock, the host, or I/O. Time is the tick counter.
4. Iteration order is always explicit: arrays or `Map`s, never `for…in`, and `sort()` always
   takes a total comparator with an entity-id tiebreak.
5. State is hashed with `StateHasher` (MurmurHash3_x86_32 over exact bit patterns).
   Clients exchange hashes periodically, and a mismatch produces a desync report.

Enforcement:

- ESLint: `no-restricted-properties` (banned `Math.*`), `no-restricted-globals` (`Date`,
  `performance`, timers, …), `no-restricted-syntax` (`**`, `for…in`, comparator-less
  `sort`), scoped to `packages/sim/src`.
- `packages/sim/tsconfig.json` has no DOM lib and no `@types/node`.
- From M1, CI runs `tools/det-check`, which runs scripted matches in Node, Chromium, Firefox
  and WebKit and requires identical hashes.
- Reference-vector tests pin `Prng` and `StateHasher` to their C reference implementations.

## Consequences

- Gameplay code reads like normal TypeScript.
- Contributors must learn the rules. The lint messages point to this ADR.
- If an engine ever violates IEEE-754 for the allowed subset, det-check will catch it. The
  fallback is to switch `@stratcom/sim/math` to fixed-point behind the same API.
- WASM (if adopted for hot systems later) must follow the same rules. WASM floats are also
  deterministic apart from NaN bit patterns, which we never hash intentionally.

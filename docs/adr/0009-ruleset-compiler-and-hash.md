# 0009. Ruleset compiler, numeric ids and the ruleset hash

- **Status:** Accepted
- **Date:** 2026-10-27

## Context

ADR-0006 put all content in `@stratcom/data` and promised a compiler that turns string ids
into dense numeric ids, plus a hash that lobbies compare. M3 adds the first real units,
weapons, movement classes and maps, so we have to decide where compilation happens, what the
simulation depends on, and how the hash is computed so that every engine agrees on it.

Constraints:

- The dependency direction is `shared ← data ← sim`. `data` cannot use `StateHasher` from the
  sim.
- The compiled ruleset crosses the worker boundary via `postMessage`, so it must be plain data.
- The pinned determinism hashes (`detcheck.test.ts`) should not change every time a unit is
  rebalanced.

## Decision

- **`compileRuleset` lives in `@stratcom/data`.** It parses every movement class, weapon,
  unit and faction with zod, checks every cross-reference, and collects _all_ problems into one
  `RulesetError` instead of stopping at the first. Numeric ids are array positions in
  authoring order (content-pack order, then file order). `RULESET` is compiled once when the
  module loads.
- **The sim depends on a structural `SimRuleset`** (`movementClasses`, `units` with
  `mobile`, `movementClass`, `radius`, `speed`, `turnRate`). `CompiledRuleset` satisfies it.
  Tests, `?bench` and the pinned determinism scenario keep using the tiny `TEST_RULESET`, so
  their hashes stay stable through balance changes.
- **Ruleset hash = FNV-1a 32 over `JSON.stringify` of the compiled body.** Every object is
  built with a fixed key order, and ECMAScript specifies number-to-string conversion exactly,
  so the string is identical in every engine. `fnv1a32` lives in `@stratcom/shared` because
  it is integer-only and has no domain knowledge.
- **A second determinism scenario covers real content.** `runSkirmishDetScenario` runs a
  4-player match on a real map with `RULESET` and is compared across Node and every browser
  engine (`e2e/determinism.spec.ts`). It is not pinned, because content changes move it.

## Consequences

- Reordering units or packs changes numeric ids and the hash. That is intended: it changes
  replays and network compatibility as well.
- Display text (names, descriptions) is part of the hash. A typo fix makes old and new
  clients incompatible. If that becomes annoying (translations, for example), split the hash
  input into gameplay and presentation parts.
- FNV-1a is not collision-resistant against deliberate attack. That is acceptable for a
  compatibility check between cooperating clients. Anti-cheat is out of scope (lockstep
  validation handles state, ADR-0003).
- New sim systems that need more unit stats (health and weapons in M5, economy in M4) add
  fields to `SimRuleset` and `TEST_RULESET`, and repin `detcheck.test.ts` deliberately.

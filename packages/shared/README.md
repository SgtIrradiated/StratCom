# @stratcom/shared

Tiny, dependency-free utilities used by every other workspace package.

| Export              | Purpose                                            |
| ------------------- | -------------------------------------------------- |
| `assert(cond, msg)` | Narrowing invariant check; throws `AssertionError` |
| `assertNever(x)`    | Exhaustiveness check for discriminated unions      |
| `Brand<T, Name>`    | Nominal types (e.g. `EntityId` vs `PlayerId`)      |

**Dependency rule:** this package imports nothing from the workspace. Keep it small; anything
domain-specific belongs in `sim`, `data`, or an app.

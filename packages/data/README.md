# @stratcom/data

Data-driven game content, validated with [zod](https://zod.dev) schemas. **Content is data:**
adding a faction, unit or map must never require engine changes.

## Status

| Content                                       | State                           |
| --------------------------------------------- | ------------------------------- |
| `FactionDef` schema + two launch factions     | ✅ M0 (identity and theme only) |
| Unit and weapon definitions, ruleset compiler | M3                              |
| Map format                                    | M2 (test map), v1 later         |

## Adding a faction

1. Create `src/factions/<id>.ts` exporting an object that `satisfies FactionDef`.
2. Append it to `RAW_FACTIONS` in `src/factions/index.ts`.
3. If it introduces a new `uiSkin`, add the matching stylesheet in `apps/client`.
4. Run `pnpm test`. The registry validates every faction when the module loads.

## Dependency rule

Depends only on `@stratcom/shared` and `zod`. Must not import the simulation, apps, three.js
or Node built-ins.

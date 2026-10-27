# @stratcom/data

Data-driven game content, validated with [zod](https://zod.dev) schemas. **Content is data:**
adding a faction, unit or map must never require engine changes (ADR-0006).

## Status

| Content                                                                | State                     |
| ---------------------------------------------------------------------- | ------------------------- |
| `FactionDef`: identity, theme, team colours, commander, starting force | ✅ M3                     |
| `UnitDef`, `WeaponDef`, `MovementClassDef`                             | ✅ M3                     |
| Two content packs: 7–8 units and 3–5 weapons per faction               | ✅ M3 (placeholder stats) |
| `MapDef` (procedural map format v0) and three skirmish maps            | ✅ M3                     |
| `compileRuleset`: cross-checks, numeric ids, ruleset hash              | ✅ M3 (ADR-0009)          |
| Authored heightmaps (map format v1)                                    | Content track             |

## Public API

```ts
import { FACTIONS, MAPS, RULESET, getFaction, getMap, rulesetUnit } from "@stratcom/data";

RULESET.units[3]; // CompiledUnit with numeric cross-references
RULESET.hash; // 32-bit fingerprint of all content
compileRuleset({ movementClasses, packs }); // throws RulesetError listing every problem
```

`RULESET` is compiled once when the module loads, so bad content fails at start-up, never
mid-match. It is plain data and can be posted to the sim worker.

## Adding content

See [docs/content-authoring.md](../../docs/content-authoring.md) for units, weapons,
factions and maps.

## Dependency rule

Depends only on `@stratcom/shared` and `zod`. Must not import the simulation, apps, three.js
or Node built-ins.

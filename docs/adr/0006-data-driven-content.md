# 0006. Data-driven content validated with zod

- **Status:** Accepted
- **Date:** 2026-10-05

## Context

Factions must be easy to add (a third faction is planned), and balance changes should not
touch engine code. Bad data should fail loudly at start-up, not mid-match.

## Decision

- All content (factions, units, weapons, maps) lives in `@stratcom/data` as typed objects
  that `satisfies` a **zod** schema.
- Registries validate everything when the module loads and cross-check references (duplicate
  ids, and from M3 unknown weapon/unit ids).
- From M3, a ruleset compiler converts string ids to dense numeric ids for the simulation and
  produces a **ruleset hash**. The lobby requires identical hashes from all players.
- Asymmetry between factions is expressed in data (stats, rosters, economy modifiers), never
  in `if (faction === …)` branches in engine code.

## Consequences

- Adding a faction means adding a data file. UI such as the faction selector is generated
  from the registry.
- zod adds about 60 kB to the client bundle. That is acceptable, and the schemas double as
  documentation.
- Modding support later is mostly a loader question, because the format already exists.

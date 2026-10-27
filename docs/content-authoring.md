# Content authoring

All game content lives in [`packages/data`](../packages/data) as typed TypeScript objects
checked by [zod](https://zod.dev) schemas ([ADR-0006](adr/0006-data-driven-content.md)).
Engine code never mentions a faction or unit by id, so everything below is a data change.
Run `pnpm test` afterwards: the ruleset compiles when the module loads, and any problem fails
the tests with a list of everything that is wrong.

```
packages/data/src/
  schema/              zod schemas: FactionDef, UnitDef, WeaponDef, MovementClassDef, MapDef,
                       FeatureDef
  factions/<id>/       one content pack per faction
    faction.ts           the FactionDef
    units.ts             its units and weapons
  factions/index.ts    CONTENT_PACKS: the list of packs, in display order
  movement.ts          movement classes shared by all factions
  features.ts          neutral debris (reclaimable), shared by all maps
  maps/index.ts        skirmish maps
  ruleset.ts           compileRuleset(): validation, numeric ids, ruleset hash
```

## Add a unit

1. Open `src/factions/<faction>/units.ts` and add an entry to the units array. A mobile unit:

   ```ts
   {
     id: "dir_sentry",                // lower_snake_case, unique across all factions
     faction: "directorate",          // must match the pack it is in
     name: "Sentry Walker",
     description: "One or two sentences for tooltips and the roster.",
     role: "land",                    // commander | engineer | land | economy | factory | defense
     cost: { salvage: 70, power: 800, buildTime: 10 },   // build time in seconds
     health: 700,
     radius: 2,                       // collision and selection radius, metres
     vision: 300,                     // metres
     movement: { class: "legged", speed: 7, turnRate: 3.5 },  // m/s, rad/s
     weapons: ["dir_laser_carbine"],  // weapon ids
     visual: { size: [3, 4, 3], icon: "triangle" },      // placeholder box (m), zoom icon
   },
   ```

   A structure has no `movement` and needs a `footprint` in terrain cells instead, e.g.
   `footprint: { x: 2, z: 2 }`. Economy figures go in `economy`
   (`salvagePerSec`, `powerPerSec`, `storageSalvage`, `storagePower`); they apply only once
   the unit is finished.

2. Make it buildable: add its id to the `builds` list of a factory or engineer of the same
   faction. Units cannot build another faction's units; the compiler rejects that. Mobile
   builders build structures, and structures (factories) build mobile units.

Building and economy fields (ADR-0010):

| Field                | Meaning                                                                                                                                   |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `cost.salvage/power` | Total drawn while it is built, a little every tick, not up front                                                                          |
| `cost.buildTime`     | Seconds for a builder with `buildRate` 1. Builders on the same job add their rates                                                        |
| `buildRate`          | Build power; required (> 0) for anything with `builds`. Also sets reclaim speed (10 salvage/s per point)                                  |
| `buildRange`         | Mobile builders: how close (edge to edge, metres) they must get. Default 10                                                               |
| `placement`          | Structures: `ground` (default) or `deposit` for extractors, which must sit on a salvage deposit and need an even footprint (2 × 2, 4 × 4) |
| `economy.storage*`   | Storage capacity; a player's capacity is the sum over their finished units. Income beyond it is lost                                      |

Each faction's starting resources must fit in its commander's storage (a test checks this). 3. Optionally add it to the faction's `startingUnits`. 4. Run `pnpm test`. The unit appears on the faction-select roster and in the HUD build panel
without any UI changes.

Values are **per second**, never per tick. The simulation converts them with `TICK_RATE`.

## Add a weapon

Add an entry to the weapons array in the same `units.ts`:

```ts
{ id: "dir_pulse_rifle", name: "Pulse Rifle", kind: "beam", damage: 30, range: 200, reload: 0.5 }
```

`kind` is `ballistic`, `beam`, `flame` or `artillery`. Give projectile weapons a
`projectileSpeed` (m/s) and splash weapons an `areaRadius` (m). Weapons fire from M5 on;
until then they show in the UI only.

## Add a faction

1. Copy `src/factions/scrapborn/` to `src/factions/<id>/` and rename the ids inside.
   Prefix unit and weapon ids with a short faction tag (`dir_`, `scr_`).
2. In `faction.ts`, set `commanderUnit` to a mobile unit with `role: "commander"`, pick a
   `startingResources` budget, and choose a theme: `phosphor` and `accent` colours, at least
   8 distinct `teamColors`, and a `uiSkin`.
3. Append the pack to `CONTENT_PACKS` in `src/factions/index.ts`.
4. If you reuse `terminal-clean` or `terminal-rust`, no client changes are needed: the
   faction card, roster, colour picker and HUD all come from the registry. A new `uiSkin`
   value needs a matching `.skin-<name>` block in `apps/client/src/styles/terminal.css`.

`reclaimMultiplier` (default 1) scales the salvage the faction gets from reclaiming
debris and wrecks; the Scrapborn have 1.5.

Keep names original (docs/PLAN.md §2): no Vault, Pip-Boy, Nuka, Brotherhood, Enclave or
other Bethesda names.

## Add a map

Maps are procedural for now (map format v0): append to `RAW_MAPS` in `src/maps/index.ts`.

```ts
{
  id: "dustbowl",
  name: "Dustbowl",
  description: "One line for the setup screen.",
  cells: 192, cellSize: 8,                  // 1,536 m square
  terrain: { seed: 9, amplitude: 60, wavelength: 450 },
  startPositions: [{ x: 0.2, z: 0.2 }, { x: 0.8, z: 0.8 }],   // 0…1, slot order
  plateauRadius: 70,                        // flattened base area, metres (optional)
}
```

Economy fields (all optional):

```ts
  startDeposits: 4,                         // deposits in an arc behind each commander
  deposits: [{ x: 0.5, z: 0.5 }],           // field deposits, 0…1; each gets a flat pad
  debris: [                                 // reclaimable debris, scattered per map seed
    { x: 0.5, z: 0.5, radius: 90, count: 10, feature: "scrap_heap" },
  ],
```

Deposits snap to terrain-cell corners. Debris never lands on a start plateau, near a
deposit, or on ground some movement class cannot reach.

Put the two 1v1 positions first: slots 0 and 1 use them. Each start position is flattened
into a base site. `createSkirmishSetup` places every starting unit on ground its movement
class can cross; the sim test `skirmish.test.ts` checks this for every map and slot.

## Add a feature (debris)

Features are neutral, shared by every faction and map, and live in `src/features.ts`:

```ts
{
  id: "rusted_bus",
  name: "Rusted Bus",
  description: "One sentence for tooltips.",
  salvage: 120,                             // salvage from reclaiming all of it
  radius: 5,                                // builders reclaim from this far out, metres
  visual: { size: [3, 3, 11], color: "#6b5a44" },
},
```

Scatter it on maps through their `debris` fields.

## The ruleset hash

`RULESET.hash` fingerprints all compiled content ([ADR-0009](adr/0009-ruleset-compiler-and-hash.md)).
Any change, including a name or a description, changes it. The main menu and HUD show it; in
online play (M8) all players must have the same hash.

The pinned determinism hashes in `packages/sim/src/detcheck.test.ts` use a separate test
ruleset, so content changes never require repinning them.

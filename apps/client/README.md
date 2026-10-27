# @stratcom/client

The browser client: boot, menus, HUD, input and rendering. Built with
[Vite](https://vite.dev) and [three.js](https://threejs.org) (WebGL2).

```sh
pnpm dev          # from the repo root; http://localhost:5173
pnpm dev:server   # optional, in a second terminal; /api, /healthz and /ws are proxied to it
```

## Layout

| Path           | Contents                                                                         |
| -------------- | -------------------------------------------------------------------------------- |
| `src/main.ts`  | Entry point: capability check, then the menus (or `?bench` / `?detcheck`)        |
| `src/screens/` | Preact screens and the `router.ts` state machine (menu → … → results)            |
| `src/game/`    | `GameSession` (one running match), slot model, loading, pure HUD model           |
| `src/styles/`  | Terminal UI and the per-faction skins (`terminal-clean`, `terminal-rust`)        |
| `src/boot/`    | Capability detection (WebGL2, workers, cross-origin isolation)                   |
| `src/sim/`     | `SimClient` (main-thread handle) and `simWorker.ts` (runs `Simulation` at 20 Hz) |
| `src/bench/`   | `?bench=N` flag and the performance panel                                        |
| `src/render/`  | **The only place three.js may be imported** (ADR-0004). Exposes `GameRenderer`   |
| `src/input/`   | `InputController` (mouse, keyboard, edge pan, placement mode), pure `Selection`  |
|                | logic and pure `orders.ts` (right-click context orders, placement preview)       |
| `src/ui/`      | Shared Preact components, theme, map preview, unit schematic, boot error panel   |
| `public/`      | Static files copied as-is (favicon now; fonts, models and maps later)            |

Planned additions are in `docs/PLAN.md` §5: `net/` (M8).

## Game flow

Main Menu → Skirmish Setup (map, 1v1 slots, AI faction and colour) → Faction Select (cards,
dossier, commander schematic, roster, colour) → Loading (real steps: ruleset, terrain,
renderer, worker, first snapshot) → In-Game → Results. Enter and Escape are the primary and
back actions on every menu screen. In a match, Escape opens the pause menu (resume,
surrender, quit) and C centres the camera on your commander.

## Controls

Left click / drag: select (Shift adds, double-click selects all of that type on screen).
Right click: context order. Units move; builders on debris reclaim it, and on your own
unfinished structure, factory or builder they assist it; factories set their rally point.
Shift + right click queues the order. X: stop. WASD / arrows / screen edge: pan. Q / E or
middle-drag: rotate. Wheel: zoom to cursor; zoomed far out, models give way to strategic
icons. Ctrl+1–9 stores a control group, 1–9 recalls it (twice to centre the camera).

Building: select a builder and click a structure in the build panel to get a placement
ghost (green: buildable, red: not). Left click places it, Shift + left click places it and
keeps placing (queued), R rotates, right click or Esc cancels. With a factory selected,
clicking a unit queues one (Shift: five) and right-clicking removes one.

## Fonts

VT323 and Share Tech Mono (SIL OFL 1.1) are bundled from `@fontsource` and served from our
own origin, so they work under COEP and offline.

## Debug flags

- `?bench=N`: run N units and show fps, draw calls, sim tick cost and the state hash.
- `?detcheck`: run both determinism scenarios and publish the hashes on `<html data-detcheck>`.

`<html data-screen>` names the current screen; e2e tests wait on it. In a match,
`data-units` counts the local player's units and structures, `data-placing` holds the
structure type being placed, and `data-ghost` says whether the ghost is `valid`.

## Rules

- three.js stays inside `src/render`. Everything else uses the interfaces in `render/types.ts`.
- The client never mutates simulation state. It only sends commands through `SimClient`.
- Build DOM with `textContent`, never `innerHTML` with data.

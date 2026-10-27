# @stratcom/client

The browser client: boot, menus, HUD, input and rendering. Built with
[Vite](https://vite.dev) and [three.js](https://threejs.org) (WebGL2).

```sh
pnpm dev          # from the repo root; http://localhost:5173
pnpm dev:server   # optional, in a second terminal; /api, /healthz and /ws are proxied to it
```

## Layout

| Path          | Contents                                                                         |
| ------------- | -------------------------------------------------------------------------------- |
| `src/main.ts` | Entry point and boot sequence                                                    |
| `src/boot/`   | Capability detection (WebGL2, workers, cross-origin isolation)                   |
| `src/sim/`    | `SimClient` (main-thread handle) and `simWorker.ts` (runs `Simulation` at 20 Hz) |
| `src/bench/`  | `?bench=N` flag and the performance panel                                        |
| `src/render/` | **The only place three.js may be imported** (ADR-0004). Exposes `GameRenderer`   |
| `src/ui/`     | DOM/HUD. Plain DOM in M0; Preact screens from M3                                 |
| `public/`     | Static files copied as-is (favicon now; fonts, models and maps later)            |

Planned additions are in `docs/PLAN.md` §5: `screens/`, `input/` and `net/`.

## Debug flags

- `?bench=N`: run N units and show fps, draw calls, sim tick cost and the state hash.
- `?detcheck`: run the determinism scenario and publish the hashes on `<html data-detcheck>`.

## Rules

- three.js stays inside `src/render`. Everything else uses the interfaces in `render/types.ts`.
- The client never mutates simulation state. It only sends commands through `SimClient`.
- Build DOM with `textContent`, never `innerHTML` with data.

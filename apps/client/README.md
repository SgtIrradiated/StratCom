# @stratcom/client

The browser client: boot, menus, HUD, input and rendering. Built with
[Vite](https://vite.dev) and [three.js](https://threejs.org) (WebGL2).

```sh
pnpm dev          # from the repo root; http://localhost:5173
pnpm dev:server   # optional, in a second terminal; /api, /healthz and /ws are proxied to it
```

## Layout

| Path          | Contents                                                                       |
| ------------- | ------------------------------------------------------------------------------ |
| `src/main.ts` | Entry point and boot sequence                                                  |
| `src/boot/`   | Capability detection (WebGL2, workers, cross-origin isolation)                 |
| `src/render/` | **The only place three.js may be imported** (ADR-0004). Exposes `GameRenderer` |
| `src/ui/`     | DOM/HUD. Plain DOM in M0; Preact screens from M3                               |
| `public/`     | Static files copied as-is (favicon now; fonts, models and maps later)          |

Planned additions are in `docs/PLAN.md` §5: `screens/`, `input/`, `worker/` (sim worker) and
`net/`.

## Rules

- three.js stays inside `src/render`. Everything else uses the interfaces in `render/types.ts`.
- The client never mutates simulation state. It only sends commands (from M1).
- Build DOM with `textContent`, never `innerHTML` with data.

# @stratcom/server

A single Node process that serves:

| Route          | Purpose                                                                | Since |
| -------------- | ---------------------------------------------------------------------- | ----- |
| `GET /healthz` | Liveness probe for Docker and uptime monitors                          | M0    |
| `GET /*`       | The built client (`apps/client/dist`) with cache and COOP/COEP headers | M0    |
| `/api/*`       | Lobby REST API                                                         | M8    |
| `/ws`          | Lockstep relay (WebSocket)                                             | M8    |

## Commands

```sh
pnpm dev:server   # from the repo root: tsx watch, pretty logs, port 8080
pnpm build        # builds the client, then bundles the server to apps/server/dist/main.js
pnpm start        # runs the bundled server and serves the built client
```

## Configuration (environment variables)

| Variable      | Default          | Notes                                                   |
| ------------- | ---------------- | ------------------------------------------------------- |
| `HOST`        | `0.0.0.0`        |                                                         |
| `PORT`        | `8080`           |                                                         |
| `LOG_LEVEL`   | `info`           | `fatal` · `error` · `warn` · `info` · `debug` · `trace` |
| `NODE_ENV`    | `development`    | `production` turns off pretty logs                      |
| `CLIENT_DIST` | `../client/dist` | Directory containing the built client                   |

Invalid values stop the server at start-up with a message naming the variable.

## Design notes

- `buildApp()` (in `src/app.ts`) builds the app without listening on a port, so tests use
  `app.inject()`.
- The build bundles workspace packages (TypeScript source) into `dist/main.js` with esbuild.
  npm dependencies stay external.
- The server will be able to run `@stratcom/sim` headlessly (replay validation) because the
  simulation has no browser dependencies.

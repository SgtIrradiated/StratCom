# syntax=docker/dockerfile:1
#
# StratCom production image: one Node process serving the client, API and (later) the relay.
# Build from the repository root:  docker build -f deploy/Dockerfile -t stratcom .

ARG NODE_VERSION=24

# ---- build ------------------------------------------------------------------
FROM node:${NODE_VERSION}-alpine AS build
WORKDIR /repo
RUN corepack enable

# Install dependencies first, using only manifests, so this layer is cached across code changes.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/client/package.json apps/client/
COPY apps/server/package.json apps/server/
COPY packages/shared/package.json packages/shared/
COPY packages/sim/package.json packages/sim/
COPY packages/data/package.json packages/data/
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

COPY . .
RUN pnpm build \
 && pnpm --filter @stratcom/server deploy --prod /out

# ---- runtime ----------------------------------------------------------------
FROM node:${NODE_VERSION}-alpine AS runtime
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8080 \
    CLIENT_DIST=/app/public
WORKDIR /app

COPY --from=build --chown=node:node /out/node_modules ./node_modules
COPY --from=build --chown=node:node /out/package.json ./package.json
COPY --from=build --chown=node:node /repo/apps/server/dist ./dist
COPY --from=build --chown=node:node /repo/apps/client/dist ./public

USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/healthz" >/dev/null || exit 1
CMD ["node", "--enable-source-maps", "dist/main.js"]

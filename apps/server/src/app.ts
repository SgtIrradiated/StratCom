import { existsSync } from "node:fs";
import { sep } from "node:path";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyInstance } from "fastify";
import type { ServerConfig } from "./config";

/** Headers added to every response. COOP/COEP enable SharedArrayBuffer (docs/PLAN.md §8). */
export const SECURITY_HEADERS = {
  "cross-origin-opener-policy": "same-origin",
  "cross-origin-embedder-policy": "require-corp",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
} as const;

/**
 * Builds the HTTP application without starting it, so tests can drive it with
 * `app.inject()` and no open port.
 */
export async function buildApp(config: ServerConfig): Promise<FastifyInstance> {
  const prettyLogs = !config.production && process.stdout.isTTY;
  const app = Fastify({
    logger: {
      level: config.logLevel,
      ...(prettyLogs ? { transport: { target: "pino-pretty" } } : {}),
    },
  });

  app.addHook("onRequest", async (_request, reply) => {
    reply.headers(SECURITY_HEADERS);
  });

  // Polled every few seconds by Docker/uptime monitors, so keep it out of the request log.
  app.get("/healthz", { logLevel: "warn" }, () => ({
    status: "ok",
    uptimeSeconds: Math.round(process.uptime()),
  }));

  if (existsSync(config.clientDist)) {
    await app.register(fastifyStatic, {
      root: config.clientDist,
      // Vite content-hashes everything under /assets, so it can be cached forever.
      // index.html must always be revalidated so clients pick up new builds.
      setHeaders(reply, filePath) {
        const hashed = filePath.includes(`${sep}assets${sep}`);
        reply.header("cache-control", hashed ? "public, max-age=31536000, immutable" : "no-cache");
      },
    });
  } else {
    app.log.warn(
      { clientDist: config.clientDist },
      "Client build not found; only the API is served. Run `pnpm build` first.",
    );
  }

  return app;
}

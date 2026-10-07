import { fileURLToPath } from "node:url";
import { z } from "zod";

const Env = z.object({
  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  /** Directory holding the built client. Defaults to apps/client/dist in the repo. */
  CLIENT_DIST: z.string().optional(),
});

export interface ServerConfig {
  host: string;
  port: number;
  logLevel: z.infer<typeof Env>["LOG_LEVEL"];
  production: boolean;
  clientDist: string;
}

/**
 * Reads configuration from environment variables. Throws a readable error listing every
 * invalid variable, so a misconfigured container fails at start-up instead of at runtime.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const parsed = Env.safeParse(env);
  if (!parsed.success) {
    throw new Error(`Invalid server configuration:\n${z.prettifyError(parsed.error)}`);
  }
  const e = parsed.data;
  return {
    host: e.HOST,
    port: e.PORT,
    logLevel: e.LOG_LEVEL,
    production: e.NODE_ENV === "production",
    // Works from both src/ (tsx) and dist/ (bundled): both sit two levels below apps/.
    clientDist: e.CLIENT_DIST ?? fileURLToPath(new URL("../../client/dist", import.meta.url)),
  };
}

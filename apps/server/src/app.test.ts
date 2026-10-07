import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "./app";
import { loadConfig, type ServerConfig } from "./config";

function testConfig(overrides: Partial<ServerConfig> = {}): ServerConfig {
  return { ...loadConfig({ LOG_LEVEL: "fatal", NODE_ENV: "test" }), ...overrides };
}

describe("server app", () => {
  let dist: string;
  let app: FastifyInstance;

  beforeAll(async () => {
    dist = mkdtempSync(join(tmpdir(), "stratcom-dist-"));
    mkdirSync(join(dist, "assets"));
    writeFileSync(join(dist, "index.html"), "<!doctype html><title>t</title>");
    writeFileSync(join(dist, "assets", "main-abc123.js"), "console.log(1)");
    app = await buildApp(testConfig({ clientDist: dist }));
  });

  afterAll(async () => {
    await app.close();
    rmSync(dist, { recursive: true, force: true });
  });

  it("answers health checks", async () => {
    const res = await app.inject("/healthz");
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: "ok" });
  });

  it("sends cross-origin isolation headers on every response", async () => {
    for (const url of ["/healthz", "/", "/does-not-exist"]) {
      const res = await app.inject(url);
      expect(res.headers["cross-origin-opener-policy"]).toBe("same-origin");
      expect(res.headers["cross-origin-embedder-policy"]).toBe("require-corp");
    }
  });

  it("serves index.html with revalidation", async () => {
    const res = await app.inject("/");
    expect(res.statusCode).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-cache");
  });

  it("serves hashed assets as immutable", async () => {
    const res = await app.inject("/assets/main-abc123.js");
    expect(res.statusCode).toBe(200);
    expect(res.headers["cache-control"]).toContain("immutable");
  });

  it("still serves the API when no client build exists", async () => {
    const apiOnly = await buildApp(testConfig({ clientDist: join(dist, "missing") }));
    expect((await apiOnly.inject("/healthz")).statusCode).toBe(200);
    expect((await apiOnly.inject("/")).statusCode).toBe(404);
    await apiOnly.close();
  });
});

describe("loadConfig", () => {
  it("applies defaults", () => {
    expect(loadConfig({})).toMatchObject({ host: "0.0.0.0", port: 8080, production: false });
  });

  it("rejects invalid values with a readable message", () => {
    expect(() => loadConfig({ PORT: "abc" })).toThrow(/Invalid server configuration[\s\S]*PORT/);
  });
});

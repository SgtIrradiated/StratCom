// Bundles the server into dist/main.js.
//
// Workspace packages (@stratcom/*) ship as TypeScript source, so they are bundled in.
// npm dependencies stay external and are installed normally (`pnpm deploy` in Docker).
import { build } from "esbuild";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const external = Object.keys(pkg.dependencies ?? {}).filter((n) => !n.startsWith("@stratcom/"));

await build({
  entryPoints: [new URL("../src/main.ts", import.meta.url).pathname],
  outfile: new URL("../dist/main.js", import.meta.url).pathname,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  sourcemap: true,
  external,
  logLevel: "info",
});

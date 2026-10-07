import { defineConfig } from "vite";

// Cross-origin isolation is required for SharedArrayBuffer (zero-copy sim snapshots, see
// docs/PLAN.md §8). It is enabled from day one so nothing that breaks it can creep in unnoticed.
const crossOriginIsolation = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
};

const SERVER = "http://127.0.0.1:8080";

export default defineConfig({
  build: {
    target: "es2023",
    sourcemap: true,
    // three.js is ~600 kB minified (~155 kB gzip) and changes far less often than game
    // code, so it gets its own long-cacheable chunk.
    chunkSizeWarningLimit: 700,
    rolldownOptions: {
      output: {
        codeSplitting: { groups: [{ name: "three", test: /node_modules[\\/]three[\\/]/ }] },
      },
    },
  },
  server: {
    headers: crossOriginIsolation,
    // Lets `pnpm dev` (client) talk to `pnpm dev:server` without CORS.
    proxy: { "/api": SERVER, "/healthz": SERVER, "/ws": { target: SERVER, ws: true } },
  },
  preview: {
    headers: crossOriginIsolation,
  },
});

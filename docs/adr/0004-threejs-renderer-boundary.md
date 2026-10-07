# 0004. three.js behind a renderer boundary

- **Status:** Accepted
- **Date:** 2026-10-05

## Context

We need a WebGL2 renderer with glTF, KTX2, instancing and post-processing support, without
writing an engine from scratch. We also want to be able to move to WebGPU later.

## Decision

- Use **three.js** (`WebGLRenderer`). It is mature, has a small API surface, and ships a
  WebGPU renderer we can move to later.
- three.js may be imported **only** under `apps/client/src/render/` (ESLint
  `no-restricted-imports`). The rest of the client talks to the renderer through interfaces
  in `render/types.ts` (`GameRenderer`, and later `UnitLayer`, `TerrainLayer`, `IconLayer`,
  `FxLayer`).
- The renderer reads simulation snapshots and never writes simulation state.
- three.js is emitted as a separate, long-cacheable bundle chunk.

## Consequences

- Swapping to `WebGPURenderer`, or replacing three.js, is confined to one folder.
- Some three.js convenience (such as raycasting against scene objects from input code) has to
  go through renderer interfaces. Unit picking will use sim-side spatial queries anyway.
- Babylon.js and raw WebGL were rejected: Babylon is heavier and more opinionated, and raw
  WebGL would cost months of infrastructure work (PLAN.md §4.1).

import type { InstancedMesh } from "three";

/**
 * Sets `mesh` to draw its first `count` instances and queues only those for upload.
 * Instance buffers are sized for the whole match capacity (thousands), so re-sending them
 * whole every frame costs megabytes per frame across all layers, which software WebGL
 * (SwiftShader on CI machines) feels badly. With `count` 0 nothing is uploaded.
 */
export function commitInstances(mesh: InstancedMesh, count: number): void {
  mesh.count = count;
  if (count === 0) return;
  for (const attr of [mesh.instanceMatrix, mesh.instanceColor]) {
    if (!attr) continue;
    attr.clearUpdateRanges();
    attr.addUpdateRange(0, count * attr.itemSize);
    attr.needsUpdate = true;
  }
}

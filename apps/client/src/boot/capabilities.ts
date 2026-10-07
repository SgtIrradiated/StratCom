/** Result of the start-up hardware/browser capability probe. */
export interface Capabilities {
  webgl2: boolean;
  workers: boolean;
  /** True when COOP/COEP headers are in effect, so SharedArrayBuffer is usable. */
  crossOriginIsolated: boolean;
  maxTextureSize: number;
}

/** Problems that make the game unplayable. Empty when the browser is supported. */
export function blockingProblems(caps: Capabilities): string[] {
  const problems: string[] = [];
  if (!caps.webgl2) problems.push("WebGL2 is not available. Update your browser or GPU drivers.");
  if (!caps.workers) problems.push("Web Workers are not available.");
  if (caps.webgl2 && caps.maxTextureSize < 4096) {
    problems.push(`GPU max texture size ${caps.maxTextureSize} is below the required 4096.`);
  }
  return problems;
}

/** Probes the browser. Creates a throwaway WebGL2 context, then releases it. */
export function detectCapabilities(): Capabilities {
  const gl = document.createElement("canvas").getContext("webgl2");
  const maxTextureSize = gl ? (gl.getParameter(gl.MAX_TEXTURE_SIZE) as number) : 0;
  gl?.getExtension("WEBGL_lose_context")?.loseContext();
  return {
    webgl2: gl !== null,
    workers: typeof Worker !== "undefined",
    crossOriginIsolated: globalThis.crossOriginIsolated,
    maxTextureSize,
  };
}

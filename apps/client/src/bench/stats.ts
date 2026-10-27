import type { SimStats } from "../sim/protocol";

/** Parses `?bench=N` from a query string. Returns the unit count, or undefined if absent. */
export function parseBenchCount(search: string): number | undefined {
  const raw = new URLSearchParams(search).get("bench");
  if (raw === null) return undefined;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 20_000) : undefined;
}

/** Live performance readout: frame rate, sim tick cost, draw calls and the state hash. */
export class StatsPanel {
  readonly element = document.createElement("pre");
  private frames = 0;
  private windowStart = 0;
  private fps = 0;
  private sim: SimStats | undefined;

  constructor() {
    this.element.className = "stats-panel";
  }

  /** Records the latest sim-side figures. */
  setSim(stats: SimStats): void {
    this.sim = stats;
  }

  /** Call once per rendered frame. Refreshes the text about twice a second. */
  frame(nowMs: number, drawCalls: number): void {
    this.frames++;
    if (nowMs - this.windowStart < 500) return;
    this.fps = (this.frames * 1000) / (nowMs - this.windowStart);
    this.frames = 0;
    this.windowStart = nowMs;
    const s = this.sim;
    this.element.textContent = [
      `fps        ${this.fps.toFixed(1)}`,
      `draw calls ${drawCalls}`,
      `units      ${s?.entityCount ?? "-"}`,
      `tick avg   ${s ? s.avgTickMs.toFixed(2) : "-"} ms`,
      `tick max   ${s ? s.maxTickMs.toFixed(2) : "-"} ms`,
      `hash       ${s ? s.hash.toString(16).padStart(8, "0") : "-"}`,
    ].join("\n");
  }
}

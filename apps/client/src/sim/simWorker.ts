import {
  Simulation,
  TICK_MS,
  createSnapshotBuffers,
  scriptedCommands,
  snapshotTransferList,
} from "@stratcom/sim";
import type { MatchSetup, PlayerCommand, SnapshotBuffers } from "@stratcom/sim";
import type { FromWorker, ToWorker } from "./protocol";

/**
 * Sim worker: owns the `Simulation`, runs it at a fixed 20 Hz and posts double-buffered
 * snapshots (transferred, not copied). The main thread hands each buffer back with a
 * `recycle` message once it has consumed it; if both buffers are out, the worker keeps
 * simulating and skips posting rather than allocating.
 */

/** Wall-clock catch-up cap so a stalled tab doesn't simulate a burst of seconds at once. */
const MAX_CATCH_UP_TICKS = 5;
const STATS_INTERVAL_TICKS = 20;

let sim: Simulation | undefined;
let script: MatchSetup | undefined;
let free: SnapshotBuffers[] = [];
let pending: PlayerCommand[] = [];
let paused = false;
let accumulator = 0;
let last = 0;
let timer: ReturnType<typeof setInterval> | undefined;
let sumMs = 0;
let maxMs = 0;
let sampled = 0;

const post = (msg: FromWorker, transfer: ArrayBuffer[] = []): void => {
  (self as unknown as Worker).postMessage(msg, transfer);
};

function frame(): void {
  if (!sim || paused) return;
  const now = performance.now();
  accumulator = Math.min(accumulator + (now - last), MAX_CATCH_UP_TICKS * TICK_MS);
  last = now;
  while (accumulator >= TICK_MS) {
    accumulator -= TICK_MS;
    const commands = pending;
    pending = [];
    if (script) commands.push(...scriptedCommands(script, sim.tick));
    const t0 = performance.now();
    sim.step(commands);
    const dt = performance.now() - t0;
    sumMs += dt;
    maxMs = Math.max(maxMs, dt);
    sampled++;

    const buffers = free.pop();
    if (buffers) {
      sim.writeSnapshot(buffers);
      post({ type: "snapshot", snapshot: buffers }, snapshotTransferList(buffers));
    }
    if (sampled === STATS_INTERVAL_TICKS) {
      post({
        type: "stats",
        stats: {
          avgTickMs: sumMs / sampled,
          maxTickMs: maxMs,
          hash: sim.stateHash(),
          entityCount: sim.entityCount,
        },
      });
      sumMs = maxMs = sampled = 0;
    }
  }
}

self.onmessage = (event: MessageEvent<ToWorker>): void => {
  const msg = event.data;
  try {
    switch (msg.type) {
      case "init": {
        sim = new Simulation(msg.setup);
        script = msg.scripted ? msg.setup : undefined;
        const capacity = msg.setup.capacity ?? msg.setup.initialUnits.length + 4096;
        free = Array.from({ length: msg.snapshotCount }, () => createSnapshotBuffers(capacity));
        accumulator = 0;
        last = performance.now();
        clearInterval(timer);
        // Slightly faster than the tick so the accumulator, not timer jitter, sets the pace.
        timer = setInterval(frame, TICK_MS / 2);
        post({ type: "ready" });
        break;
      }
      case "commands":
        pending.push(...msg.commands);
        break;
      case "recycle":
        free.push(msg.snapshot);
        break;
      case "pause":
        paused = msg.paused;
        last = performance.now();
        break;
    }
  } catch (err) {
    post({ type: "error", message: err instanceof Error ? err.message : String(err) });
  }
};

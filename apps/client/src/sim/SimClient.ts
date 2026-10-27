import { snapshotTransferList } from "@stratcom/sim";
import type { MatchSetup, PlayerCommand, SnapshotBuffers } from "@stratcom/sim";
import type { FromWorker, SimStats, ToWorker } from "./protocol";

/** Number of snapshot buffer sets in flight: one being drawn, one being written. */
const SNAPSHOT_BUFFERS = 3;

/** Handlers for events from the sim worker. */
export interface SimClientEvents {
  onSnapshot(snapshot: SnapshotBuffers, receivedAtMs: number): void;
  onStats?(stats: SimStats): void;
  onError?(message: string): void;
}

/**
 * Main-thread handle to the sim worker. The UI sends commands through it and receives
 * snapshots; it never touches simulation state (docs/architecture.md, key invariant 1).
 */
export class SimClient {
  private readonly worker: Worker;

  /** @param scripted Drive the match with the built-in scripted commands (demo and bench). */
  constructor(setup: MatchSetup, events: SimClientEvents, scripted = false) {
    this.worker = new Worker(new URL("./simWorker.ts", import.meta.url), { type: "module" });
    this.worker.onmessage = (e: MessageEvent<FromWorker>): void => {
      const msg = e.data;
      if (msg.type === "snapshot") events.onSnapshot(msg.snapshot, performance.now());
      else if (msg.type === "stats") events.onStats?.(msg.stats);
      else if (msg.type === "error") events.onError?.(msg.message);
    };
    this.worker.onerror = (e): void => events.onError?.(e.message);
    this.send({ type: "init", setup, snapshotCount: SNAPSHOT_BUFFERS, scripted });
  }

  /** Queues commands for the next tick. */
  sendCommands(commands: PlayerCommand[]): void {
    this.send({ type: "commands", commands });
  }

  /** Pauses or resumes the simulation clock. Snapshots stop while paused. */
  setPaused(paused: boolean): void {
    this.send({ type: "pause", paused });
  }

  /** Returns a consumed snapshot to the worker so it can be refilled. */
  recycle(snapshot: SnapshotBuffers): void {
    this.send({ type: "recycle", snapshot }, snapshotTransferList(snapshot));
  }

  /** Stops the worker. */
  dispose(): void {
    this.worker.terminate();
  }

  private send(msg: ToWorker, transfer: Transferable[] = []): void {
    this.worker.postMessage(msg, transfer);
  }
}

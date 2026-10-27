import { describe, expect, it } from "vitest";
import { ECON_STRIDE, MAX_PLAYERS } from "./economy";
import { createSnapshotBuffers, snapshotTransferList } from "./snapshot";

describe("snapshot buffers", () => {
  it("transfers every typed array, each with its own buffer", () => {
    const s = createSnapshotBuffers(64);
    const arrays = Object.values(s).filter((v) => ArrayBuffer.isView(v));
    const transfer = snapshotTransferList(s);
    expect(new Set(transfer).size).toBe(transfer.length);
    expect(transfer).toHaveLength(arrays.length);
    for (const a of arrays) expect(transfer).toContain(a.buffer);
  });

  it("sizes per-entity arrays by capacity and the economy by player slots", () => {
    const s = createSnapshotBuffers(64);
    expect(s.ids).toHaveLength(64);
    expect(s.progress).toHaveLength(64);
    expect(s.economy).toHaveLength(MAX_PLAYERS * ECON_STRIDE);
    expect(s.production).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";
import { fnv1a32, hashHex } from "./hash";

describe("fnv1a32", () => {
  it("matches the published FNV-1a test vectors", () => {
    expect(fnv1a32("")).toBe(0x811c9dc5);
    expect(fnv1a32("a")).toBe(0xe40c292c);
    expect(fnv1a32("foobar")).toBe(0xbf9cf968);
  });

  it("formats as 8 hex digits", () => {
    expect(hashHex(0xbeef)).toBe("0000beef");
    expect(hashHex(fnv1a32("a"))).toBe("e40c292c");
  });
});

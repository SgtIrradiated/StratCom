/**
 * 32-bit FNV-1a hash of a string's UTF-16 code units. Integer-only (`Math.imul`), so it is
 * identical in every JS engine. Used for content fingerprints such as the ruleset hash; it is
 * not a cryptographic hash.
 */
export function fnv1a32(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Formats a 32-bit hash as 8 lowercase hex digits, e.g. `"0a1b2c3d"`. */
export function hashHex(hash: number): string {
  return (hash >>> 0).toString(16).padStart(8, "0");
}

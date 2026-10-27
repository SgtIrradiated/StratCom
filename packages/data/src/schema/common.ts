import { z } from "zod";

/** Stable machine id: lowercase snake_case. Used in replays, the protocol and cross-references. */
export const ContentId = z.string().regex(/^[a-z][a-z0-9_]*$/, "lowercase snake_case");

/** A `#rrggbb` colour. */
export const HexColor = z.string().regex(/^#[0-9a-f]{6}$/i, "expected a #rrggbb colour");

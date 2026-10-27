import { z } from "zod";
import { ContentId, HexColor } from "./common";

/**
 * A neutral map feature: wreckage and debris that builders reclaim for salvage. Features
 * belong to no faction, never move and do not block movement or construction.
 */
export const FeatureDef = z.object({
  id: ContentId,
  name: z.string().min(1),
  /** One sentence for tooltips. */
  description: z.string().min(1),
  /** Salvage recovered by reclaiming it completely (before faction bonuses). */
  salvage: z.number().positive(),
  /** Reach radius in metres: builders reclaim from this far out. */
  radius: z.number().positive().max(16),
  visual: z.object({
    /** Placeholder box size in metres: width (x), height (y), length (z). */
    size: z.tuple([z.number().positive(), z.number().positive(), z.number().positive()]),
    color: HexColor,
  }),
});
/** A validated feature. */
export type FeatureDef = z.infer<typeof FeatureDef>;
/** A feature as authored. */
export type FeatureInput = z.input<typeof FeatureDef>;

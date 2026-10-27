import { z } from "zod";
import { ContentId } from "./common";

/** A start position in normalised map coordinates (0…1 on each axis). */
export const StartPosition = z.object({
  x: z.number().min(0.02).max(0.98),
  z: z.number().min(0.02).max(0.98),
});
export type StartPosition = z.infer<typeof StartPosition>;

/**
 * A procedural skirmish map (map format v0). The sim generates the heightmap from these
 * parameters, so a map is a few numbers rather than a file. Map format v1 with authored
 * heightmaps is on the content track.
 */
export const MapDef = z.object({
  id: ContentId,
  name: z.string().min(1),
  description: z.string().min(1),
  /** Cells per side. The map is `cells × cellSize` metres square. */
  cells: z.number().int().min(64).max(512),
  cellSize: z.number().positive().max(32),
  terrain: z.object({
    /** Noise seed. Changing it changes the map, not just the match. */
    seed: z.number().int().min(0).max(0x7fffffff),
    /** Peak-to-trough height in metres. */
    amplitude: z.number().min(0).max(400),
    /** Wavelength of the broadest hills, in metres. */
    wavelength: z.number().positive(),
  }),
  /**
   * Start positions in slot order. Put opposing 1v1 spots first: slots 0 and 1 use the first
   * two. The length is the map's maximum player count.
   */
  startPositions: z.array(StartPosition).min(2).max(8),
  /** Radius in metres of the flattened base area around each start. */
  plateauRadius: z.number().min(0).max(200).default(70),
});
/** A validated map (defaults applied). */
export type MapDef = z.infer<typeof MapDef>;
/** A map as authored, before defaults are applied. */
export type MapInput = z.input<typeof MapDef>;

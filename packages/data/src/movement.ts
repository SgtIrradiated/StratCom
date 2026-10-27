import type { MovementClassDef } from "./schema/unit";

/**
 * Movement classes shared by every faction. Each one costs a navigation grid per match, so
 * keep the list short.
 */
export const RAW_MOVEMENT_CLASSES: readonly MovementClassDef[] = [
  /** Tanks and crawlers: about 31°. */
  { id: "tracked", name: "Tracked", maxSlope: 0.6 },
  /** Trucks and buggies: about 24°. */
  { id: "wheeled", name: "Wheeled", maxSlope: 0.45 },
  /** Walkers: about 40°. */
  { id: "legged", name: "Legged", maxSlope: 0.85 },
];

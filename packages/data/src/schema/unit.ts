import { z } from "zod";
import { ContentId } from "./common";

/** Terrain a class of units can cross. Each class gets its own navigation grid in the sim. */
export const MovementClassDef = z.object({
  id: ContentId,
  name: z.string().min(1),
  /** Steepest passable slope, as rise over run. */
  maxSlope: z.number().positive().max(4),
});
export type MovementClassDef = z.infer<typeof MovementClassDef>;

/** How a weapon delivers damage. Projectile behaviour arrives with combat in M5. */
export const WeaponKind = z.enum(["ballistic", "beam", "flame", "artillery"]);
export type WeaponKind = z.infer<typeof WeaponKind>;

/** A weapon. Units reference weapons by id; several units may share one. */
export const WeaponDef = z.object({
  id: ContentId,
  name: z.string().min(1),
  kind: WeaponKind,
  /** Damage per shot. */
  damage: z.number().positive(),
  /** Maximum range in metres. */
  range: z.number().positive(),
  /** Seconds between shots. */
  reload: z.number().positive(),
  /** Splash radius in metres; 0 hits only the target. */
  areaRadius: z.number().min(0).default(0),
  /** Projectile speed in metres per second. Omit for instant-hit weapons (beams). */
  projectileSpeed: z.number().positive().optional(),
});
export type WeaponDef = z.infer<typeof WeaponDef>;
/** A weapon as authored, before defaults are applied. */
export type WeaponInput = z.input<typeof WeaponDef>;

/** What a unit is for. Drives HUD grouping and, from M6, AI decisions. */
export const UnitRole = z.enum(["commander", "engineer", "land", "economy", "factory", "defense"]);
export type UnitRole = z.infer<typeof UnitRole>;

/** Strategic-zoom icon shape. */
export const IconShape = z.enum(["circle", "square", "triangle", "diamond", "star", "hexagon"]);
export type IconShape = z.infer<typeof IconShape>;

/**
 * A unit or structure. Units with `movement` are mobile; units without it are structures and
 * must declare a `footprint`.
 */
export const UnitDef = z
  .object({
    id: ContentId,
    /** Owning faction id. The faction's roster is every unit that names it here. */
    faction: ContentId,
    name: z.string().min(1),
    /** One or two sentences for tooltips and the faction-select roster. */
    description: z.string().min(1),
    role: UnitRole,
    tech: z.number().int().min(1).max(4).default(1),
    cost: z.object({
      salvage: z.number().min(0),
      power: z.number().min(0),
      /** Seconds for one builder with no assist. */
      buildTime: z.number().positive(),
    }),
    health: z.number().positive(),
    /** Collision and selection radius in metres. */
    radius: z.number().positive().max(32),
    /** Sight radius in metres (fog of war from M5). */
    vision: z.number().positive(),
    movement: z
      .object({
        /** Movement class id. */
        class: ContentId,
        /** Top speed in metres per second. */
        speed: z.number().positive(),
        /** Turn rate in radians per second. */
        turnRate: z.number().positive(),
      })
      .optional(),
    /** Structure footprint in terrain cells. */
    footprint: z
      .object({ x: z.number().int().min(1).max(16), z: z.number().int().min(1).max(16) })
      .optional(),
    weapons: z.array(ContentId).default([]),
    /** Unit ids this unit can construct (structures for engineers, units for factories). */
    builds: z.array(ContentId).default([]),
    economy: z
      .object({
        salvagePerSec: z.number().min(0).default(0),
        powerPerSec: z.number().min(0).default(0),
        storageSalvage: z.number().min(0).default(0),
        storagePower: z.number().min(0).default(0),
      })
      .default({ salvagePerSec: 0, powerPerSec: 0, storageSalvage: 0, storagePower: 0 }),
    visual: z.object({
      /** Placeholder box size in metres: width (x), height (y), length (z). */
      size: z.tuple([z.number().positive(), z.number().positive(), z.number().positive()]),
      icon: IconShape,
    }),
  })
  .superRefine((u, ctx) => {
    if (!u.movement && !u.footprint) {
      ctx.addIssue({ code: "custom", message: "structures (no movement) need a footprint" });
    }
    if (u.movement && u.footprint) {
      ctx.addIssue({ code: "custom", message: "mobile units must not have a footprint" });
    }
  });
/** A validated unit (defaults applied). */
export type UnitDef = z.infer<typeof UnitDef>;
/** A unit as authored, before defaults are applied. */
export type UnitInput = z.input<typeof UnitDef>;

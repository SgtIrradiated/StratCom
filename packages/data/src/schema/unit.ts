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

/**
 * How a weapon looks and is described. The simulation reads only the numbers: a weapon
 * without `projectileSpeed` hits instantly (beams, flame); one with it fires a projectile
 * that lands where the target was, so slow shells can miss a moving unit. `areaRadius`
 * damages every hostile unit around the impact point.
 */
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

/**
 * Where a structure may stand: anywhere buildable (`ground`), or centred on a salvage
 * deposit (`deposit`, for extractors).
 */
export const Placement = z.enum(["ground", "deposit"]);
export type Placement = z.infer<typeof Placement>;

/** Most weapons one unit may carry. The simulation keeps fixed-size weapon state per unit. */
export const MAX_UNIT_WEAPONS = 4;

/**
 * What a destroyed unit leaves behind: a wreck worth `salvageFraction` of its salvage cost
 * (scaled by how far it was built), or nothing (`false`).
 */
export const WreckDef = z.union([
  z.literal(false),
  z.object({ salvageFraction: z.number().min(0).max(1).default(0.5) }),
]);
export type WreckDef = z.infer<typeof WreckDef>;

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
    weapons: z.array(ContentId).max(MAX_UNIT_WEAPONS).default([]),
    /** The wreck it leaves when destroyed. Defaults to half its salvage cost. */
    wreck: WreckDef.default({ salvageFraction: 0.5 }),
    /** Unit ids this unit can construct (structures for engineers, units for factories). */
    builds: z.array(ContentId).default([]),
    /**
     * Build power. A builder with `buildRate` 1 finishes a unit in its `cost.buildTime`
     * seconds; assisting builders add their rates. Also sets reclaim speed. Required (> 0)
     * for anything with `builds`.
     */
    buildRate: z.number().min(0).max(100).default(0),
    /** How far, in metres from its own edge to the target's edge, a mobile builder reaches. */
    buildRange: z.number().positive().max(200).default(10),
    /** Structures only: where it may be placed. */
    placement: Placement.default("ground"),
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
    if (u.builds.length > 0 && u.buildRate <= 0) {
      ctx.addIssue({ code: "custom", message: "units with builds need a buildRate above 0" });
    }
    if (u.placement === "deposit") {
      if (u.movement) {
        ctx.addIssue({ code: "custom", message: "only structures can need a deposit" });
      } else if (u.footprint && (u.footprint.x % 2 !== 0 || u.footprint.z % 2 !== 0)) {
        // Deposits sit on cell corners, so only an even footprint can be centred on one.
        ctx.addIssue({ code: "custom", message: "deposit structures need an even footprint" });
      }
    }
  });
/** A validated unit (defaults applied). */
export type UnitDef = z.infer<typeof UnitDef>;
/** A unit as authored, before defaults are applied. */
export type UnitInput = z.input<typeof UnitDef>;

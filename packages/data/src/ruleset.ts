import { assert, fnv1a32 } from "@stratcom/shared";
import type { z } from "zod";
import type { ContentPack } from "./factions/index";
import { FactionDef } from "./schema/faction";
import { FeatureDef } from "./schema/feature";
import {
  MovementClassDef,
  UnitDef,
  WeaponDef,
  type IconShape,
  type Placement,
  type UnitRole,
  type WeaponKind,
} from "./schema/unit";

/** A movement class with its numeric id. */
export interface CompiledMovementClass {
  index: number;
  id: string;
  name: string;
  maxSlope: number;
}

/** A weapon with its numeric id. Times are seconds; `projectileSpeed` 0 means instant hit. */
export interface CompiledWeapon {
  index: number;
  id: string;
  name: string;
  kind: WeaponKind;
  damage: number;
  range: number;
  reload: number;
  areaRadius: number;
  projectileSpeed: number;
}

/**
 * A unit with every cross-reference resolved to a numeric id. Structures have
 * `mobile: false`, `movementClass: -1` and zero speed.
 */
export interface CompiledUnit {
  index: number;
  id: string;
  /** Index into {@link CompiledRuleset.factions}. */
  faction: number;
  name: string;
  description: string;
  role: UnitRole;
  tech: number;
  cost: { salvage: number; power: number; buildTime: number };
  health: number;
  radius: number;
  vision: number;
  mobile: boolean;
  /** Index into {@link CompiledRuleset.movementClasses}, or -1 for structures. */
  movementClass: number;
  speed: number;
  turnRate: number;
  /** Footprint in cells; 0 × 0 for mobile units. */
  footprint: { x: number; z: number };
  weapons: readonly number[];
  builds: readonly number[];
  /** Build power; 0 for units that cannot build. */
  buildRate: number;
  /** Metres from this unit's edge to its target's edge. */
  buildRange: number;
  placement: Placement;
  economy: {
    salvagePerSec: number;
    powerPerSec: number;
    storageSalvage: number;
    storagePower: number;
  };
  visual: { size: readonly [number, number, number]; icon: IconShape };
}

/** The simulation-relevant part of a faction, with numeric ids. */
export interface CompiledFaction {
  index: number;
  id: string;
  /** Unit index of the commander. */
  commanderUnit: number;
  startingUnits: readonly { unit: number; count: number }[];
  startingResources: { salvage: number; power: number };
  reclaimMultiplier: number;
  /** Unit indices of everything this faction can field, in authoring order. */
  roster: readonly number[];
}

/** A neutral feature (debris, later wrecks) with its numeric id. */
export interface CompiledFeature {
  index: number;
  id: string;
  name: string;
  description: string;
  salvage: number;
  radius: number;
  visual: { size: readonly [number, number, number]; color: string };
}

/**
 * Validated, cross-referenced content with dense numeric ids, ready for the simulation.
 * Plain data, so it can be posted to the sim worker. `hash` fingerprints all of it: the
 * lobby (M8) requires every player to have the same hash.
 */
export interface CompiledRuleset {
  hash: number;
  movementClasses: readonly CompiledMovementClass[];
  weapons: readonly CompiledWeapon[];
  units: readonly CompiledUnit[];
  factions: readonly CompiledFaction[];
  features: readonly CompiledFeature[];
}

/** Raw content for {@link compileRuleset}. Everything is validated, so `unknown` is fine. */
export interface RulesetSource {
  movementClasses: readonly unknown[];
  /** Neutral features; optional so faction-only tests can leave it out. */
  features?: readonly unknown[];
  packs: readonly Pick<ContentPack, "faction" | "units" | "weapons">[];
}

/** Thrown by {@link compileRuleset}; `problems` lists every issue found, not just the first. */
export class RulesetError extends Error {
  constructor(readonly problems: readonly string[]) {
    super(`Invalid ruleset (${problems.length} problem(s)):\n- ${problems.join("\n- ")}`);
    this.name = "RulesetError";
  }
}

/**
 * The registry compiler (docs/PLAN.md §6.1). Validates every definition with zod, checks
 * every cross-reference (unknown ids, units built across factions, commanders that cannot
 * move, …), assigns numeric ids in authoring order and computes the ruleset hash.
 *
 * @throws {RulesetError} listing every problem found.
 */
export function compileRuleset(source: RulesetSource): CompiledRuleset {
  const problems: string[] = [];
  const parse = <T>(schema: z.ZodType<T>, raw: unknown, what: string): T | undefined => {
    const result = schema.safeParse(raw);
    if (result.success) return result.data;
    for (const issue of result.error.issues) {
      const path = issue.path.length > 0 ? ` at ${issue.path.join(".")}` : "";
      problems.push(`${what}${path}: ${issue.message}`);
    }
    return undefined;
  };
  const label = (raw: unknown, kind: string, i: number): string => {
    const id = (raw as { id?: unknown } | null)?.id;
    return typeof id === "string" ? `${kind} "${id}"` : `${kind} #${i}`;
  };
  const defined = <T>(xs: (T | undefined)[]): T[] => xs.filter((x): x is T => x !== undefined);

  const moves = defined(
    source.movementClasses.map((m, i) => parse(MovementClassDef, m, label(m, "movement class", i))),
  );
  const factions = defined(
    source.packs.map((p, i) => parse(FactionDef, p.faction, label(p.faction, "faction", i))),
  );
  const weapons = defined(
    source.packs.flatMap((p) =>
      p.weapons.map((w, i) => parse(WeaponDef, w, label(w, "weapon", i))),
    ),
  );
  const features = defined(
    (source.features ?? []).map((f, i) => parse(FeatureDef, f, label(f, "feature", i))),
  );
  const units = defined(
    source.packs.flatMap((p, pi) =>
      p.units.map((u, i) => {
        const unit = parse(UnitDef, u, label(u, "unit", i));
        const packFaction = (p.faction as { id?: unknown }).id;
        if (unit && unit.faction !== packFaction) {
          problems.push(
            `unit "${unit.id}" is in content pack #${pi} but belongs to faction "${unit.faction}"`,
          );
        }
        return unit;
      }),
    ),
  );

  const index = (xs: readonly { id: string }[], kind: string): Map<string, number> => {
    const map = new Map<string, number>();
    xs.forEach((x, i) => {
      if (map.has(x.id)) problems.push(`duplicate ${kind} id "${x.id}"`);
      else map.set(x.id, i);
    });
    return map;
  };
  const moveIx = index(moves, "movement class");
  const factionIx = index(factions, "faction");
  const weaponIx = index(weapons, "weapon");
  const unitIx = index(units, "unit");
  index(features, "feature");
  const ref = (map: Map<string, number>, id: string, kind: string, from: string): number => {
    const i = map.get(id);
    if (i === undefined) problems.push(`${from} references unknown ${kind} "${id}"`);
    return i ?? -1;
  };

  const compiledUnits: CompiledUnit[] = units.map((u, i) => {
    const from = `unit "${u.id}"`;
    const faction = ref(factionIx, u.faction, "faction", from);
    const builds = u.builds.map((b) => ref(unitIx, b, "unit", from));
    for (const b of u.builds) {
      const target = units[unitIx.get(b) ?? -1];
      if (target && target.faction !== u.faction) {
        problems.push(`${from} builds "${b}" from another faction`);
      }
      // Mobile builders place structures; structures (factories) turn out mobile units.
      if (target && (target.movement === undefined) === (u.movement === undefined)) {
        problems.push(
          u.movement
            ? `${from} is mobile, so it can only build structures, not "${b}"`
            : `${from} is a structure, so it can only build mobile units, not "${b}"`,
        );
      }
    }
    return {
      index: i,
      id: u.id,
      faction,
      name: u.name,
      description: u.description,
      role: u.role,
      tech: u.tech,
      cost: { salvage: u.cost.salvage, power: u.cost.power, buildTime: u.cost.buildTime },
      health: u.health,
      radius: u.radius,
      vision: u.vision,
      mobile: u.movement !== undefined,
      movementClass: u.movement ? ref(moveIx, u.movement.class, "movement class", from) : -1,
      speed: u.movement?.speed ?? 0,
      turnRate: u.movement?.turnRate ?? 0,
      footprint: { x: u.footprint?.x ?? 0, z: u.footprint?.z ?? 0 },
      weapons: u.weapons.map((w) => ref(weaponIx, w, "weapon", from)),
      builds,
      buildRate: u.buildRate,
      buildRange: u.buildRange,
      placement: u.placement,
      economy: {
        salvagePerSec: u.economy.salvagePerSec,
        powerPerSec: u.economy.powerPerSec,
        storageSalvage: u.economy.storageSalvage,
        storagePower: u.economy.storagePower,
      },
      visual: { size: u.visual.size, icon: u.visual.icon },
    };
  });

  const compiledFactions: CompiledFaction[] = factions.map((f, i) => {
    const from = `faction "${f.id}"`;
    const ownUnit = (id: string, purpose: string): number => {
      const u = ref(unitIx, id, "unit", from);
      const def = compiledUnits[u];
      if (def && def.faction !== i) problems.push(`${from} ${purpose} "${id}" is not its own unit`);
      if (def && !def.mobile) problems.push(`${from} ${purpose} "${id}" cannot move`);
      return u;
    };
    const commanderUnit = ownUnit(f.commanderUnit, "commander");
    if (compiledUnits[commanderUnit] && compiledUnits[commanderUnit].role !== "commander") {
      problems.push(`${from} commander "${f.commanderUnit}" does not have the commander role`);
    }
    const roster = compiledUnits.filter((u) => u.faction === i).map((u) => u.index);
    if (roster.length === 0) problems.push(`${from} has no units`);
    return {
      index: i,
      id: f.id,
      commanderUnit,
      startingUnits: f.startingUnits.map((s) => ({
        unit: ownUnit(s.unit, "starting unit"),
        count: s.count,
      })),
      startingResources: { salvage: f.startingResources.salvage, power: f.startingResources.power },
      reclaimMultiplier: f.reclaimMultiplier,
      roster,
    };
  });

  if (problems.length > 0) throw new RulesetError(problems);

  const body = {
    movementClasses: moves.map((m, i) => ({
      index: i,
      id: m.id,
      name: m.name,
      maxSlope: m.maxSlope,
    })),
    weapons: weapons.map((w, i) => ({
      index: i,
      id: w.id,
      name: w.name,
      kind: w.kind,
      damage: w.damage,
      range: w.range,
      reload: w.reload,
      areaRadius: w.areaRadius,
      projectileSpeed: w.projectileSpeed ?? 0,
    })),
    units: compiledUnits,
    factions: compiledFactions,
    features: features.map((f, i) => ({
      index: i,
      id: f.id,
      name: f.name,
      description: f.description,
      salvage: f.salvage,
      radius: f.radius,
      visual: { size: f.visual.size, color: f.visual.color },
    })),
  };
  // Every object above is built with a fixed key order and JSON number formatting is exactly
  // specified, so this string, and the hash, is identical in every engine.
  return { hash: fnv1a32(JSON.stringify(body)), ...body };
}

/** Looks up a compiled unit by string id. Throws if unknown. */
export function rulesetUnit(ruleset: CompiledRuleset, id: string): CompiledUnit {
  const unit = ruleset.units.find((u) => u.id === id);
  assert(unit, `Unknown unit "${id}"`);
  return unit;
}

/** Looks up a compiled feature by string id. Throws if unknown. */
export function rulesetFeature(ruleset: CompiledRuleset, id: string): CompiledFeature {
  const feature = ruleset.features.find((f) => f.id === id);
  assert(feature, `Unknown feature "${id}"`);
  return feature;
}

/** Looks up a compiled faction by string id. Throws if unknown. */
export function rulesetFaction(ruleset: CompiledRuleset, id: string): CompiledFaction {
  const faction = ruleset.factions.find((f) => f.id === id);
  assert(faction, `Unknown faction "${id}"`);
  return faction;
}

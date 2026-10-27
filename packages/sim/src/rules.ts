import type { Vec2 } from "./commands";
import type { Terrain } from "./terrain";

/** Fixed simulation rate in ticks per second (ADR-0007). */
export const TICK_RATE = 20;

/** Duration of one simulation tick in milliseconds. */
export const TICK_MS = 1000 / TICK_RATE;

/** Terrain a class of units can cross. Each class gets its own navigation grid. */
export interface MovementClassDef {
  /** Steepest passable slope, as rise over run. */
  maxSlope: number;
}

/** Most weapons one unit type may carry; weapon state is kept per unit in fixed strides. */
export const MAX_WEAPONS = 4;

/** What the simulation needs to know about one weapon. */
export interface WeaponStats {
  /** Damage per shot, to the target or to every hostile unit in the area. */
  damage: number;
  /** Metres from the shooter's centre to the target's edge. */
  range: number;
  /** Seconds between shots. */
  reload: number;
  /** Splash radius in metres; 0 hits only the target. */
  areaRadius: number;
  /** Metres per second; 0 hits instantly. */
  projectileSpeed: number;
}

/** What the simulation needs to know about one unit type. */
export interface UnitTypeStats {
  /** False for structures: they never move and are not pushed by separation. */
  mobile: boolean;
  /** Index into `SimRuleset.movementClasses`; ignored (conventionally -1) when immobile. */
  movementClass: number;
  /** Collision radius in metres, used for separation, targeting and hits. */
  radius: number;
  /** Maximum health. */
  health: number;
  /** Sight radius in metres: what its team sees around it (fog of war). */
  vision: number;
  /** Weapon ids (indices into `SimRuleset.weapons`), at most {@link MAX_WEAPONS}. */
  weapons: readonly number[];
  /** Feature type spawned when it is destroyed, or -1 for none. */
  wreckFeature: number;
  /** Losing every commander defeats a player. */
  commander: boolean;
  /** Top speed in metres per second. */
  speed: number;
  /** Maximum turn rate in radians per second. */
  turnRate: number;
  /** Total salvage and power drawn while it is built, and seconds to build at build rate 1. */
  cost: { readonly salvage: number; readonly power: number; readonly buildTime: number };
  /** Structures: footprint in terrain cells at facing 0. Zero for mobile units. */
  footprint: { readonly x: number; readonly z: number };
  /** Structures: `deposit` means it must be centred on a salvage deposit. */
  placement: "ground" | "deposit";
  /** Unit type ids it can build: structures for mobile builders, units for factories. */
  builds: readonly number[];
  /** Build power; 0 if it cannot build. Also scales reclaim speed. */
  buildRate: number;
  /** Mobile builders: reach in metres, edge to edge. */
  buildRange: number;
  /** Production and storage while complete. Rates per second. */
  economy: {
    readonly salvagePerSec: number;
    readonly powerPerSec: number;
    readonly storageSalvage: number;
    readonly storagePower: number;
  };
}

/** What the simulation needs to know about one feature type (debris, wrecks). */
export interface FeatureTypeStats {
  /** Reach radius in metres. */
  radius: number;
  /** Salvage recovered by reclaiming it completely. */
  salvage: number;
}

/**
 * The rules the simulation runs on, indexed by numeric id. `CompiledRuleset` from
 * `@stratcom/data` satisfies this; tests and benchmarks can pass a minimal literal.
 */
export interface SimRuleset {
  movementClasses: readonly MovementClassDef[];
  units: readonly UnitTypeStats[];
  features: readonly FeatureTypeStats[];
  weapons: readonly WeaponStats[];
}

/** One player slot. Slots and teams are N-wide; nothing assumes two players. */
export interface PlayerSetup {
  /** 0 … `MAX_PLAYERS - 1`. */
  slot: number;
  team: number;
  factionId: string;
  /** CSS hex colour, e.g. "#c0392b". */
  color: string;
  /** Stored resources at tick 0 (clamped to storage on the first tick). Defaults to none. */
  startingResources?: { salvage: number; power: number };
  /** Multiplier on salvage from reclaiming features. Defaults to 1. */
  reclaimMultiplier?: number;
}

/** A unit present at tick 0. */
export interface InitialUnit {
  slot: number;
  /** Unit type id: an index into `SimRuleset.units`. */
  type: number;
  x: number;
  z: number;
  heading?: number;
}

/** A neutral feature present at tick 0. */
export interface InitialFeature {
  /** Feature type id: an index into `SimRuleset.features`. */
  type: number;
  x: number;
  z: number;
  heading?: number;
}

/** Everything that defines a match besides the command stream. */
export interface MatchSetup {
  seed: number;
  /** Ground heightmap; also defines the map extent in metres. */
  terrain: Terrain;
  players: readonly PlayerSetup[];
  ruleset: SimRuleset;
  initialUnits: readonly InitialUnit[];
  /** Neutral debris. Spawned after the units, so unit entity ids come first. */
  features?: readonly InitialFeature[];
  /** Salvage deposits in metres, on cell corners. Extractors must sit on one. */
  deposits?: readonly Vec2[];
  /** Entity capacity; defaults to the initial unit and feature count plus 4096. */
  capacity?: number;
  /** Match rules from the lobby. */
  rules?: MatchRules;
}

/** Lobby rules that change how a match plays out. */
export interface MatchRules {
  /** How players are defeated; defaults to `assassination`. */
  victory?: "assassination" | "annihilation";
}

/** Default entity capacity for a setup. */
export function setupCapacity(setup: MatchSetup): number {
  return setup.capacity ?? setup.initialUnits.length + (setup.features?.length ?? 0) + 4096;
}

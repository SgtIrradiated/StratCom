/**
 * Flow economy (docs/PLAN.md §2, ADR-0010): resources arrive and drain continuously, every
 * tick. Builders draw salvage and power in proportion to the build progress they make; when
 * a player cannot cover this tick's demand, every one of their builds slows by the same
 * factor.
 */

/** Player slots run from 0 to `MAX_PLAYERS - 1`. */
export const MAX_PLAYERS = 16;

/**
 * Offsets of one player's economy figures in the simulation's economy array and in snapshots.
 * Rates (income, spent, demand) are per second.
 */
export const Econ = {
  salvage: 0,
  power: 1,
  salvageCapacity: 2,
  powerCapacity: 3,
  salvageIncome: 4,
  powerIncome: 5,
  salvageSpent: 6,
  powerSpent: 7,
  salvageDemand: 8,
  powerDemand: 9,
  /** Fraction of demand met last tick, in [0, 1]; 1 when nothing was demanded. */
  efficiency: 10,
} as const;

/** Number of figures per player. */
export const ECON_STRIDE = 11;

/** One player's economy, as read from a snapshot. Rates are per second. */
export interface PlayerEconomy {
  salvage: number;
  power: number;
  salvageCapacity: number;
  powerCapacity: number;
  salvageIncome: number;
  powerIncome: number;
  salvageSpent: number;
  powerSpent: number;
  salvageDemand: number;
  powerDemand: number;
  efficiency: number;
}

/** Reads one player's figures from a flat array laid out with {@link Econ}. */
export function readEconomy(values: ArrayLike<number>, slot: number): PlayerEconomy {
  const o = slot * ECON_STRIDE;
  const at = (k: number): number => values[o + k] ?? 0;
  return {
    salvage: at(Econ.salvage),
    power: at(Econ.power),
    salvageCapacity: at(Econ.salvageCapacity),
    powerCapacity: at(Econ.powerCapacity),
    salvageIncome: at(Econ.salvageIncome),
    powerIncome: at(Econ.powerIncome),
    salvageSpent: at(Econ.salvageSpent),
    powerSpent: at(Econ.powerSpent),
    salvageDemand: at(Econ.salvageDemand),
    powerDemand: at(Econ.powerDemand),
    efficiency: at(Econ.efficiency),
  };
}

/**
 * The share of `demand` a player can pay this tick from `stored` plus this tick's
 * `income`, in [0, 1]. No demand means no constraint.
 */
export function stallFactor(stored: number, income: number, demand: number): number {
  if (demand <= 0) return 1;
  const f = (stored + income) / demand;
  return f >= 1 ? 1 : f <= 0 ? 0 : f;
}

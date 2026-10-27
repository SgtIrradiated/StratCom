import type { SimContext, SlotState } from "../context";
import { EntityKind, NEUTRAL_OWNER } from "../ecs/world";
import { MAX_PLAYERS } from "../economy";
import type { StateHasher } from "../math/hash";
import type { MatchRules } from "../rules";
import type { HealthSystem } from "./health";

/**
 * How a player is defeated. `assassination`: when their last commander dies (players who
 * started without one fall back to annihilation). `annihilation`: when they have no units
 * or structures left.
 */
export type VictoryRule = NonNullable<MatchRules["victory"]>;

/** One player's standing, as returned by {@link VictorySystem.status}. */
export interface PlayerStatus {
  slot: number;
  /** The player's team number, as in the setup. */
  team: number;
  defeated: boolean;
  /** Tick on which they were defeated, or -1. */
  defeatedAt: number;
  kills: number;
  losses: number;
}

/** The state of the match, as returned by {@link VictorySystem.status}. */
export interface MatchStatus {
  /** True once at most one team has undefeated players. */
  over: boolean;
  /**
   * The winning team number (as in the setup) once the match is over, or -1 for a draw
   * (everyone defeated on the same tick) or while it is still running.
   */
  winnerTeam: number;
  /** Every player in the setup, in setup order. */
  players: PlayerStatus[];
}

/**
 * Defeat and victory (docs/PLAN.md §4.4, after death). Runs after damage is applied. A
 * defeated player's remaining units are destroyed through the normal death path, so they
 * leave wrecks and count as losses. The match is over when the undefeated players are all
 * on one team; matches set up with a single team never end this way.
 */
export class VictorySystem implements SlotState {
  private readonly rule: VictoryRule;
  /** 1 if the player started with a commander, so assassination applies to them. */
  private readonly hadCommander = new Uint8Array(MAX_PLAYERS);
  /** Tick of defeat per player slot, or -1. */
  private readonly defeatedAt = new Int32Array(MAX_PLAYERS).fill(-1);
  /** Scratch counts per player slot. */
  private readonly units = new Uint32Array(MAX_PLAYERS);
  private readonly commanders = new Uint32Array(MAX_PLAYERS);
  private over = false;
  /** Dense team index of the winner, or -1. */
  private winner = -1;

  constructor(
    private readonly ctx: SimContext,
    private readonly health: HealthSystem,
  ) {
    this.rule = ctx.setup.rules?.victory ?? "assassination";
    for (const u of ctx.setup.initialUnits) {
      if (ctx.rules.units[u.type]?.commander === true) this.hadCommander[u.slot] = 1;
    }
    ctx.register(this);
  }

  // SlotState: all of this state is per player, not per entity slot.
  reset(): void {
    // Nothing per entity slot.
  }

  hashSlot(): void {
    // Nothing per entity slot.
  }

  hashGlobal(h: StateHasher): void {
    for (const p of this.ctx.setup.players) h.u32((this.defeatedAt[p.slot] ?? -1) + 1);
    h.u32(this.over ? 1 : 0).u32(this.winner + 1);
  }

  /** True once the match is decided. */
  get isOver(): boolean {
    return this.over;
  }

  /** Every player's standing and the result, if any. */
  status(): MatchStatus {
    const ctx = this.ctx;
    const teamNumber = (dense: number): number =>
      ctx.setup.players.find((p) => ctx.teamOf[p.slot] === dense)?.team ?? -1;
    return {
      over: this.over,
      winnerTeam: this.winner >= 0 ? teamNumber(this.winner) : -1,
      players: ctx.setup.players.map((p) => ({
        slot: p.slot,
        team: p.team,
        defeated: (this.defeatedAt[p.slot] ?? -1) >= 0,
        defeatedAt: this.defeatedAt[p.slot] ?? -1,
        ...this.health.playerStats(p.slot),
      })),
    };
  }

  /** Defeats players who lost, destroys what they had left, and decides the match. */
  run(): void {
    if (this.over) return;
    const ctx = this.ctx;
    const w = ctx.world;
    const units = ctx.rules.units;
    this.units.fill(0);
    this.commanders.fill(0);
    for (let i = 0; i < w.highWater; i++) {
      if (w.alive[i] === 0 || w.kind[i] !== EntityKind.unit) continue;
      const p = w.owner[i] ?? 0;
      this.units[p] = (this.units[p] ?? 0) + 1;
      if (units[w.type[i] ?? 0]?.commander === true) {
        this.commanders[p] = (this.commanders[p] ?? 0) + 1;
      }
    }

    let fell = false;
    for (const p of ctx.setup.players) {
      if ((this.defeatedAt[p.slot] ?? -1) >= 0) continue;
      const assassinated =
        this.rule === "assassination" &&
        this.hadCommander[p.slot] === 1 &&
        this.commanders[p.slot] === 0;
      if (!assassinated && this.units[p.slot] !== 0) continue;
      this.defeatedAt[p.slot] = ctx.tick;
      fell = true;
    }
    if (!fell) return;

    // Everything a defeated player had left is destroyed, in slot order.
    for (let i = 0; i < w.highWater; i++) {
      if (w.alive[i] === 0 || w.kind[i] !== EntityKind.unit) continue;
      if ((this.defeatedAt[w.owner[i] ?? 0] ?? -1) === ctx.tick) {
        this.health.destroy(i, NEUTRAL_OWNER);
      }
    }

    if (ctx.teamCount < 2) return;
    const standing = new Set<number>();
    for (const p of ctx.setup.players) {
      if ((this.defeatedAt[p.slot] ?? -1) < 0) standing.add(ctx.teamOf[p.slot] ?? 0);
    }
    if (standing.size > 1) return;
    this.over = true;
    this.winner = standing.size === 1 ? ([...standing][0] ?? -1) : -1;
  }
}

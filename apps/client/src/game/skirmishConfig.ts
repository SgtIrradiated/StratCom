import type { FactionDef, MapDef } from "@stratcom/data";
import type { PlayerSetup } from "@stratcom/sim";

/**
 * Who fills a slot. `open` waits for a player to join (online lobby, M8); `closed` is unused.
 * Only `human` and `ai` slots take part in the match.
 */
export type SlotKind = "human" | "ai" | "open" | "closed";

/** One seat in a skirmish (docs/PLAN.md §7). The slot number is its array index. */
export interface SlotConfig {
  kind: SlotKind;
  factionId: string;
  /** Slots with the same team number are allies. */
  team: number;
  /** `#rrggbb` player colour. */
  color: string;
}

/**
 * A skirmish as set up on the menu screens. The same slot model will back FFA, team games
 * and the online lobby; only the screens limit it to 1v1 for now.
 */
export interface SkirmishConfig {
  mapId: string;
  /** Match seed. */
  seed: number;
  /** One entry per map start position. */
  slots: readonly SlotConfig[];
}

/** Content the skirmish helpers validate against. */
export interface SkirmishContent {
  factions: readonly FactionDef[];
  maps: readonly MapDef[];
}

/** True for slots that field a player in the match. */
export function isActive(slot: SlotConfig): boolean {
  return slot.kind === "human" || slot.kind === "ai";
}

/** The first colour of `faction`'s palette not in `taken`, falling back to its first colour. */
export function pickColor(faction: FactionDef, taken: Iterable<string>): string {
  const used = new Set([...taken].map((c) => c.toLowerCase()));
  const colors = faction.theme.teamColors;
  return colors.find((c) => !used.has(c.toLowerCase())) ?? colors[0] ?? "#ffffff";
}

/**
 * The default 1v1: you in slot 0 with the first faction, an AI in slot 1 with the second (or
 * the first, if only one exists), every other start position closed.
 */
export function defaultSkirmish(content: SkirmishContent, seed: number): SkirmishConfig {
  const map = content.maps[0];
  const [first, second = first] = content.factions;
  if (!map || !first || !second) throw new Error("skirmish needs at least one map and faction");
  const humanColor = pickColor(first, []);
  const slots: SlotConfig[] = map.startPositions.map((_, i) => ({
    kind: i === 0 ? "human" : i === 1 ? "ai" : "closed",
    factionId: i === 1 ? second.id : first.id,
    team: i,
    color: i === 0 ? humanColor : i === 1 ? pickColor(second, [humanColor]) : "#808080",
  }));
  return { mapId: map.id, seed, slots };
}

/**
 * Switches map, keeping existing slots where the new map has start positions. Extra start
 * positions become closed slots; slots beyond the new map's capacity are dropped.
 */
export function withMap(
  config: SkirmishConfig,
  map: MapDef,
  content: SkirmishContent,
): SkirmishConfig {
  const fallback = content.factions[0]?.id ?? "";
  const slots = map.startPositions.map(
    (_, i): SlotConfig =>
      config.slots[i] ?? { kind: "closed", factionId: fallback, team: i, color: "#808080" },
  );
  return { ...config, mapId: map.id, slots };
}

/** Replaces one slot's fields. */
export function withSlot(
  config: SkirmishConfig,
  index: number,
  patch: Partial<SlotConfig>,
): SkirmishConfig {
  return {
    ...config,
    slots: config.slots.map((s, i) => (i === index ? { ...s, ...patch } : s)),
  };
}

/**
 * Changes a slot's faction. If its colour is not in the new faction's palette, it gets the
 * first free one from that palette, so faction and colour stay visually coherent.
 */
export function withFaction(
  config: SkirmishConfig,
  index: number,
  faction: FactionDef,
): SkirmishConfig {
  const slot = config.slots[index];
  if (!slot) return config;
  const palette = faction.theme.teamColors.map((c) => c.toLowerCase());
  const color = palette.includes(slot.color.toLowerCase())
    ? slot.color
    : pickColor(
        faction,
        config.slots.filter((s, i) => i !== index && isActive(s)).map((s) => s.color),
      );
  return withSlot(config, index, { factionId: faction.id, color });
}

/** Slot number of the local human player, or -1 if there is none. */
export function localSlot(config: SkirmishConfig): number {
  return config.slots.findIndex((s) => s.kind === "human");
}

/** Problems that prevent the match from starting. Empty when the config is playable. */
export function validateSkirmish(config: SkirmishConfig, content: SkirmishContent): string[] {
  const problems: string[] = [];
  const map = content.maps.find((m) => m.id === config.mapId);
  if (!map) problems.push(`Unknown map "${config.mapId}".`);
  else if (config.slots.length > map.startPositions.length) {
    problems.push(`${map.name} has only ${map.startPositions.length} start positions.`);
  }
  const active = config.slots.filter(isActive);
  if (active.length < 2) problems.push("At least two players are needed.");
  const humans = config.slots.filter((s) => s.kind === "human").length;
  if (humans !== 1) problems.push("Exactly one local player is needed.");
  if (new Set(active.map((s) => s.team)).size < 2) problems.push("Every player is on one team.");
  const colors = active.map((s) => s.color.toLowerCase());
  if (new Set(colors).size !== colors.length) problems.push("Two players share a colour.");
  for (const s of active) {
    if (!content.factions.some((f) => f.id === s.factionId)) {
      problems.push(`Unknown faction "${s.factionId}".`);
    }
  }
  return problems;
}

/** The sim's player list: one entry per active slot, keeping slot numbers. */
export function toPlayers(config: SkirmishConfig): PlayerSetup[] {
  return config.slots.flatMap((s, slot) =>
    isActive(s) ? [{ slot, team: s.team, factionId: s.factionId, color: s.color }] : [],
  );
}

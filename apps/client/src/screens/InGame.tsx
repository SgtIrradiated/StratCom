import { RULESET, getFaction, getMap, rulesetFaction } from "@stratcom/data";
import { hashHex } from "@stratcom/shared";
import type { JSX } from "preact";
import { useEffect, useReducer, useState } from "preact/hooks";
import type { GameSession } from "../game/GameSession";
import { buildOptions, formatClock, summarizeSelection } from "../game/hudModel";
import { localSlot, type SkirmishConfig } from "../game/skirmishConfig";
import { Panel, StatRow, TermButton } from "../ui/components";
import type { MatchResult } from "./router";

/** HUD refresh interval. The 3D view runs at display rate; text doesn't need to. */
const HUD_REFRESH_MS = 150;

/**
 * The in-game HUD, skinned for the local faction: status bar, selection panel, build panel
 * and the pause menu. It reads the session and never touches simulation state; orders go
 * through the session's input path as commands.
 */
export function InGame(props: {
  session: GameSession;
  config: SkirmishConfig;
  onEnd: (result: MatchResult) => void;
  onQuit: () => void;
}): JSX.Element {
  const { session, config } = props;
  const [, refresh] = useReducer((n: number) => n + 1, 0);
  const [paused, setPaused] = useState(false);
  const me = localSlot(config);
  const faction = getFaction(config.slots[me]?.factionId ?? "");
  const compiled = rulesetFaction(RULESET, faction.id);
  const map = getMap(config.mapId);

  useEffect(() => {
    const timer = setInterval(refresh, HUD_REFRESH_MS);
    return () => {
      clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    session.setPaused(paused);
  }, [session, paused]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.code === "Escape") {
        setPaused((p) => !p);
        e.preventDefault();
      } else if (e.code === "KeyC" && !paused && !e.repeat) {
        session.focusType(compiled.commanderUnit);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [session, paused, compiled.commanderUnit]);

  const snapshot = session.snapshot;
  const groups = snapshot ? summarizeSelection(snapshot, session.selection.ids) : [];
  const builds = buildOptions(RULESET, groups);
  const selectedCount = groups.reduce((n, g) => n + g.count, 0);
  const single = groups.length === 1 && groups[0]?.count === 1 ? groups[0] : undefined;
  const unit = single ? RULESET.units[single.type] : undefined;

  const surrender = (): void => {
    props.onEnd({ outcome: "surrender", ticks: session.tick, rulesetHash: RULESET.hash });
  };

  return (
    <div class="screen hud" data-testid="hud">
      <header class="hud-top panel">
        <span class="hud-faction">
          {faction.shortName.toUpperCase()} // {faction.commanderTitle.toUpperCase()}
        </span>
        <span class="hud-map">{map.name}</span>
        <span class="hud-clock" title="Match time">
          T+{formatClock(session.tick)}
        </span>
        <span class="hud-resources" title="Income and spending arrive with the economy in M4">
          <span class="res salvage">SALVAGE {compiled.startingResources.salvage}</span>
          <span class="res power">POWER {compiled.startingResources.power}</span>
        </span>
        <TermButton
          onClick={() => {
            setPaused(true);
          }}
          hotkey="Esc"
        >
          Menu
        </TermButton>
      </header>

      <Panel
        title={selectedCount > 0 ? `SELECTED · ${selectedCount}` : "SELECTION"}
        class="hud-selection"
      >
        {selectedCount === 0 && (
          <div class="muted">
            Drag to select. Right-click to move. [C] finds your {faction.commanderTitle}.
          </div>
        )}
        {unit && (
          <div class="unit-card">
            <div class="unit-name">{unit.name}</div>
            <div class="muted small">{unit.description}</div>
            <StatRow label="Hull" value={unit.health.toLocaleString("en")} />
            {unit.mobile && <StatRow label="Speed" value={`${unit.speed} m/s`} />}
            <StatRow label="Vision" value={`${unit.vision} m`} />
            {unit.weapons.map((w) => {
              const weapon = RULESET.weapons[w];
              return weapon ? (
                <StatRow
                  key={weapon.id}
                  label={weapon.name}
                  value={`${weapon.damage} dmg · ${weapon.range} m · ${weapon.reload}s`}
                />
              ) : null;
            })}
          </div>
        )}
        {!unit && selectedCount > 0 && (
          <ul class="selection-groups">
            {groups.map((g) => (
              <li key={g.type}>
                <button
                  type="button"
                  class="list-item"
                  title="Select only these"
                  onClick={() => {
                    session.selectOnlyType(g.type);
                  }}
                >
                  <span class="count">{g.count}×</span> {RULESET.units[g.type]?.name}
                </button>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="ORDERS" class="hud-orders">
        <div class="orders-row">
          <span class="order">MOVE [RMB]</span>
          <span class="order">STOP [X]</span>
          <span class="order">GROUP [Ctrl+1–9]</span>
        </div>
        {builds.length > 0 && (
          <>
            <div class="muted small">Construction comes online in M4.</div>
            <div class="build-grid">
              {builds.map((b) => {
                const def = RULESET.units[b];
                return def ? (
                  <button
                    key={def.id}
                    type="button"
                    class="build-option"
                    disabled
                    title={`${def.name}: ${def.description} (${def.cost.salvage} salvage, ${def.cost.power} power)`}
                  >
                    {def.name}
                  </button>
                ) : null;
              })}
            </div>
          </>
        )}
      </Panel>

      <div class="hud-hash muted small">ruleset {hashHex(RULESET.hash)}</div>

      {paused && (
        <div class="pause-overlay" role="dialog" aria-modal="true" aria-label="Paused">
          <Panel title="PAUSED" class="pause-menu">
            <div class="menu-list">
              <TermButton
                primary
                onClick={() => {
                  setPaused(false);
                }}
                hotkey="Esc"
              >
                Resume
              </TermButton>
              <TermButton onClick={surrender} testId="pause-surrender">
                Surrender
              </TermButton>
              <TermButton onClick={props.onQuit}>Quit to main menu</TermButton>
            </div>
          </Panel>
        </div>
      )}
    </div>
  );
}

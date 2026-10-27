import { getFaction, getMap } from "@stratcom/data";
import { hashHex } from "@stratcom/shared";
import type { JSX } from "preact";
import { formatClock } from "../game/hudModel";
import { isActive, localSlot, type SkirmishConfig } from "../game/skirmishConfig";
import { Panel, StatRow, TermButton } from "../ui/components";
import type { MatchResult } from "./router";

const HEADLINE: Record<MatchResult["outcome"], string> = {
  victory: "VICTORY",
  defeat: "DEFEAT",
  surrender: "WITHDRAWAL",
};

/** After-action report. */
export function Results(props: {
  config: SkirmishConfig;
  result: MatchResult;
  onMenu: () => void;
  onRematch: () => void;
}): JSX.Element {
  const { config, result } = props;
  const me = localSlot(config);
  return (
    <div class="screen results-screen">
      <Panel title="AFTER-ACTION REPORT" class="results-panel">
        <div class="headline" data-testid="results-outcome">
          {HEADLINE[result.outcome]}
        </div>
        <StatRow label="Theatre" value={getMap(config.mapId).name} />
        <StatRow label="Duration" value={formatClock(result.ticks)} />
        {config.slots.map((s, i) =>
          isActive(s) ? (
            <StatRow
              key={i}
              label={i === me ? "You" : `Slot ${i + 1} (AI)`}
              value={<span style={{ color: s.color }}>{getFaction(s.factionId).name}</span>}
            />
          ) : null,
        )}
        <StatRow label="Ruleset" value={hashHex(result.rulesetHash)} />
        <p class="muted small">
          Victory by destroying the enemy commander arrives with combat in M5.
        </p>
      </Panel>
      <footer class="screen-actions">
        <TermButton onClick={props.onMenu} hotkey="Esc" testId="results-menu">
          Main menu
        </TermButton>
        <TermButton primary onClick={props.onRematch} hotkey="Enter">
          Rematch setup
        </TermButton>
      </footer>
    </div>
  );
}

import { RULESET, getFaction, getMap, rulesetFaction } from "@stratcom/data";
import { hashHex } from "@stratcom/shared";
import { snapshotEconomy, type PlayerEconomy, type SnapshotBuffers } from "@stratcom/sim";
import type { JSX } from "preact";
import { useEffect, useReducer, useState } from "preact/hooks";
import type { GameSession } from "../game/GameSession";
import {
  buildMenu,
  formatAmount,
  formatClock,
  formatRate,
  formatSpending,
  summarizeSelection,
  type BuildOption,
} from "../game/hudModel";
import { localSlot, type SkirmishConfig } from "../game/skirmishConfig";
import { Panel, StatRow, TermButton } from "../ui/components";
import type { MatchResult } from "./router";

/** HUD refresh interval. The 3D view runs at display rate; text doesn't need to. */
const HUD_REFRESH_MS = 150;

/** Units added per click on a production button with Shift held. */
const SHIFT_PRODUCE = 5;

/**
 * The in-game HUD, skinned for the local faction: status bar with live resources, selection
 * panel, build panel and the pause menu. It reads the session and never touches simulation
 * state; orders go to the simulation as commands.
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
  const selected = session.selection.ids;
  const groups = snapshot ? summarizeSelection(snapshot, selected) : [];
  const builds = snapshot ? buildMenu(RULESET, snapshot, selected, me) : [];
  const selectedCount = groups.reduce((n, g) => n + g.count, 0);
  const single = groups.length === 1 && groups[0]?.count === 1 ? groups[0] : undefined;
  const unit = single ? RULESET.units[single.type] : undefined;
  const singleIndex = snapshot && single ? indexOfSelected(snapshot, selected) : -1;
  const economy = snapshot ? snapshotEconomy(snapshot, me) : undefined;

  const onBuild = (option: BuildOption, e: MouseEvent): void => {
    if (option.mode === "place") {
      session.beginPlacement(option.type);
      return;
    }
    const sign = e.type === "contextmenu" ? -1 : 1;
    session.issue({
      t: "produce",
      slot: me,
      units: [...selected],
      unitType: option.type,
      count: sign * (e.shiftKey ? SHIFT_PRODUCE : 1),
    });
  };

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
        {economy && <Resources economy={economy} />}
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
        {unit && snapshot && (
          <div class="unit-card">
            <div class="unit-name">{unit.name}</div>
            <div class="muted small">{unit.description}</div>
            {(snapshot.progress[singleIndex] ?? 1) < 1 && (
              <Progress
                label="Under construction"
                value={snapshot.progress[singleIndex] ?? 0}
                testId="construction-progress"
              />
            )}
            <ProductionQueue snapshot={snapshot} id={snapshot.ids[singleIndex] ?? 0} />
            {unit.economy.salvagePerSec > 0 && (
              <StatRow label="Salvage" value={`${formatRate(unit.economy.salvagePerSec)}/s`} />
            )}
            {unit.economy.powerPerSec > 0 && (
              <StatRow label="Power" value={`${formatRate(unit.economy.powerPerSec)}/s`} />
            )}
            {unit.buildRate > 0 && <StatRow label="Build rate" value={`×${unit.buildRate}`} />}
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
          <span class="order">MOVE / RECLAIM / ASSIST [RMB]</span>
          <span class="order">QUEUE [Shift]</span>
          <span class="order">STOP [X]</span>
          <span class="order">GROUP [Ctrl+1–9]</span>
        </div>
        {session.placing !== undefined && (
          <div class="placing-hint" data-testid="placing-hint">
            PLACING {RULESET.units[session.placing]?.name.toUpperCase()} · [LMB] place · [Shift]
            keep placing · [R] rotate · [RMB]/[Esc] cancel
          </div>
        )}
        {builds.length > 0 && (
          <div class="build-grid">
            {builds.map((option) => {
              const def = RULESET.units[option.type];
              if (!def) return null;
              const hint =
                option.mode === "place"
                  ? "Click, then place it on the map"
                  : "Click to queue (Shift: 5), right-click to remove";
              return (
                <button
                  key={`${option.mode}-${def.id}`}
                  type="button"
                  class={`build-option${session.placing === option.type ? " active" : ""}`}
                  data-testid={`build-${def.id}`}
                  title={`${def.name}: ${def.description}\n${hint}`}
                  onClick={(e) => {
                    onBuild(option, e);
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    if (option.mode === "produce") onBuild(option, e);
                  }}
                >
                  <span class="build-name">{def.name}</span>
                  <span class="build-cost">
                    <span class="res salvage">{def.cost.salvage}</span>{" "}
                    <span class="res power">{def.cost.power}</span>
                  </span>
                  {option.queued > 0 && <span class="build-queued">{option.queued}</span>}
                </button>
              );
            })}
          </div>
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

/** Salvage and power: stored / capacity, income and spending, and a stall warning. */
function Resources(props: { economy: PlayerEconomy }): JSX.Element {
  const e = props.economy;
  const stalled = e.efficiency < 0.999;
  const line = (
    kind: "salvage" | "power",
    stored: number,
    capacity: number,
    income: number,
    spent: number,
  ): JSX.Element => (
    <span
      class={`res ${kind}`}
      data-testid={`res-${kind}`}
      title={`${kind === "salvage" ? "Salvage" : "Power"}: stored / storage, income, spending per second`}
    >
      {kind.toUpperCase()} {formatAmount(stored)}
      <span class="muted">/{formatAmount(capacity)}</span>{" "}
      <span class="income">{formatRate(income)}</span>{" "}
      <span class="spending">{formatSpending(spent)}</span>
    </span>
  );
  return (
    <span class="hud-resources">
      {line("salvage", e.salvage, e.salvageCapacity, e.salvageIncome, e.salvageSpent)}
      {line("power", e.power, e.powerCapacity, e.powerIncome, e.powerSpent)}
      {stalled && (
        <span
          class="stall"
          data-testid="stall"
          title="Not enough resources: every build runs at this speed"
        >
          STALL {Math.round(e.efficiency * 100)}%
        </span>
      )}
    </span>
  );
}

/** A labelled progress bar. */
function Progress(props: { label: string; value: number; testId?: string }): JSX.Element {
  const pct = Math.floor(props.value * 100);
  return (
    <div class="progress" data-testid={props.testId}>
      <div class="progress-label">
        {props.label} <span class="progress-pct">{pct}%</span>
      </div>
      <div class="progress-track">
        <div class="progress-fill" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/** A factory's production queue, collapsed into runs of the same type. */
function ProductionQueue(props: { snapshot: SnapshotBuffers; id: number }): JSX.Element | null {
  const info = props.snapshot.production.find((p) => p.id === props.id);
  if (!info) return null;
  const runs: { type: number; count: number }[] = [];
  for (const t of info.queue) {
    const last = runs[runs.length - 1];
    if (last?.type === t) last.count++;
    else runs.push({ type: t, count: 1 });
  }
  const head = RULESET.units[info.queue[0] ?? -1];
  return (
    <div class="production" data-testid="production-queue">
      <Progress label={`Producing ${head?.name ?? ""}`} value={info.progress} />
      <div class="muted small">
        Queue: {runs.map((r) => `${r.count}× ${RULESET.units[r.type]?.name ?? "?"}`).join(", ")}
      </div>
    </div>
  );
}

/** Snapshot index of the first selected entity, or -1. */
function indexOfSelected(snapshot: SnapshotBuffers, selected: ReadonlySet<number>): number {
  for (let i = 0; i < snapshot.count; i++) if (selected.has(snapshot.ids[i] ?? 0)) return i;
  return -1;
}

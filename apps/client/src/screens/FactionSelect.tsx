import { FACTIONS, RULESET, getFaction, getMap, rulesetFaction } from "@stratcom/data";
import type { CompiledUnit } from "@stratcom/data";
import type { JSX } from "preact";
import { useEffect } from "preact/hooks";
import {
  isActive,
  localSlot,
  withFaction,
  withSlot,
  type SkirmishConfig,
} from "../game/skirmishConfig";
import { Panel, StatRow, Swatch, TermButton } from "../ui/components";
import { Schematic } from "../ui/Schematic";

const ROLE_LABEL: Record<CompiledUnit["role"], string> = {
  commander: "CMD",
  engineer: "ENG",
  land: "LND",
  economy: "ECO",
  factory: "FAC",
  defense: "DEF",
};

const weaponName = (i: number): string => RULESET.weapons[i]?.name ?? "?";

/**
 * Faction select, generated entirely from the faction registry: adding a content pack makes
 * a new card appear. The whole screen re-skins to the highlighted faction. Arrow keys cycle
 * factions.
 */
export function FactionSelect(props: {
  config: SkirmishConfig;
  onChange: (config: SkirmishConfig) => void;
  onBack: () => void;
  onNext: () => void;
}): JSX.Element {
  const { config, onChange } = props;
  const me = localSlot(config);
  const slot = config.slots[me];
  const faction = getFaction(slot?.factionId ?? FACTIONS[0]?.id ?? "");
  const compiled = rulesetFaction(RULESET, faction.id);
  const commander = RULESET.units[compiled.commanderUnit];
  const taken = config.slots
    .filter((s, i) => i !== me && isActive(s))
    .map((s) => s.color.toLowerCase());
  const opponents = config.slots.filter((s, i) => i !== me && isActive(s));

  const choose = (id: string): void => {
    onChange(withFaction(config, me, getFaction(id)));
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      const i = FACTIONS.findIndex((f) => f.id === faction.id);
      const step = e.key === "ArrowRight" ? 1 : FACTIONS.length - 1;
      const next = FACTIONS[(i + step) % FACTIONS.length];
      if (next) choose(next.id);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  });

  return (
    <div class="screen faction-screen">
      <h2 class="screen-title">SELECT FACTION</h2>
      <div class="faction-cards" role="radiogroup" aria-label="Faction">
        {FACTIONS.map((f) => (
          <button
            key={f.id}
            type="button"
            role="radio"
            aria-checked={f.id === faction.id}
            class={`faction-card skin-${f.theme.uiSkin}${f.id === faction.id ? " selected" : ""}`}
            style={{ "--phosphor": f.theme.phosphor, "--accent": f.theme.accent }}
            onClick={() => {
              choose(f.id);
            }}
            data-testid={`faction-${f.id}`}
          >
            <span class="card-name">{f.name}</span>
            <span class="card-tagline">“{f.tagline}”</span>
            <span class="card-meta">Commander: {f.commanderTitle}</span>
          </button>
        ))}
      </div>

      <div class="faction-detail">
        <Panel title="DOSSIER" class="dossier">
          <p class="lore">{faction.lore}</p>
          <div class="muted">Starting force</div>
          <ul class="log">
            {commander && <li>1× {commander.name}</li>}
            {compiled.startingUnits.map((s) => (
              <li key={s.unit}>
                {s.count}× {RULESET.units[s.unit]?.name}
              </li>
            ))}
          </ul>
          <StatRow
            label="Stores"
            value={`${compiled.startingResources.salvage} salvage · ${compiled.startingResources.power} power`}
          />
        </Panel>

        <Panel title={`COMMANDER · ${faction.commanderTitle.toUpperCase()}`} class="commander">
          {commander && (
            <>
              <Schematic
                size={commander.visual.size}
                color={faction.theme.phosphor}
                label={commander.name}
              />
              <StatRow label="Hull" value={commander.health.toLocaleString("en")} />
              <StatRow label="Speed" value={`${commander.speed} m/s`} />
              <StatRow label="Vision" value={`${commander.vision} m`} />
              <StatRow label="Armament" value={commander.weapons.map(weaponName).join(", ")} />
            </>
          )}
        </Panel>

        <Panel title="ROSTER" class="roster">
          <table class="roster-table">
            <tbody>
              {compiled.roster.map((u) => {
                const unit = RULESET.units[u];
                if (!unit) return null;
                return (
                  <tr key={unit.id} title={unit.description}>
                    <td class="role">{ROLE_LABEL[unit.role]}</td>
                    <td>{unit.name}</td>
                    <td class="num">{unit.cost.salvage}</td>
                    <td class="num">{unit.cost.power}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div class="muted small">Cost columns: salvage, power.</div>
        </Panel>
      </div>

      <footer class="screen-actions">
        <TermButton onClick={props.onBack} hotkey="Esc">
          Back
        </TermButton>
        <div class="colour-pick" role="radiogroup" aria-label="Your colour">
          <span class="muted">Colour</span>
          {faction.theme.teamColors.map((c) => (
            <Swatch
              key={c}
              color={c}
              selected={c.toLowerCase() === slot?.color.toLowerCase()}
              disabled={taken.includes(c.toLowerCase())}
              onClick={() => {
                onChange(withSlot(config, me, { color: c }));
              }}
            />
          ))}
        </div>
        <span class="muted opponents">
          vs {opponents.map((o) => getFaction(o.factionId).shortName).join(", ")} on{" "}
          {getMap(config.mapId).name}
        </span>
        <TermButton primary onClick={props.onNext} hotkey="Enter" testId="faction-deploy">
          Deploy
        </TermButton>
      </footer>
    </div>
  );
}

import { FACTIONS, MAPS, RULESET, getFaction, getMap } from "@stratcom/data";
import type { JSX } from "preact";
import { useMemo } from "preact/hooks";
import {
  isActive,
  validateSkirmish,
  withFaction,
  withMap,
  withSlot,
  type SkirmishConfig,
} from "../game/skirmishConfig";
import { Panel, Swatch, TermButton } from "../ui/components";
import { MapPreview } from "../ui/MapPreview";

/** Slots shown while the UI is limited to 1v1 (FFA and teams arrive in M9). */
const VISIBLE_SLOTS = 2;

const CONTENT = { factions: FACTIONS, maps: MAPS };

/** Skirmish setup: map choice and the slot table, limited to a 1v1 layout for now. */
export function SkirmishSetup(props: {
  config: SkirmishConfig;
  phosphor: string;
  onChange: (config: SkirmishConfig) => void;
  onBack: () => void;
  onNext: () => void;
}): JSX.Element {
  const { config, onChange } = props;
  const map = getMap(config.mapId);
  const problems = validateSkirmish(config, CONTENT);
  const markerKey = config.slots.map((s) => (isActive(s) ? s.color : "")).join();
  const markers = useMemo(
    () => config.slots.map((s) => ({ color: isActive(s) ? s.color : undefined })),
    // markerKey captures every input, so the expensive preview redraws only on real changes.
    [markerKey],
  );
  // Hatch the ground the most slope-limited movement class cannot cross.
  const strictest = RULESET.movementClasses.reduce<
    (typeof RULESET.movementClasses)[number] | undefined
  >((best, m) => (best && best.maxSlope <= m.maxSlope ? best : m), undefined);
  const metres = map.cells * map.cellSize;

  return (
    <div class="screen setup-screen">
      <h2 class="screen-title">SKIRMISH SETUP</h2>
      <div class="setup-grid">
        <Panel title="THEATRE OF OPERATIONS" class="map-list">
          {MAPS.map((m) => (
            <button
              key={m.id}
              type="button"
              class={`list-item${m.id === map.id ? " selected" : ""}`}
              aria-pressed={m.id === map.id}
              onClick={() => {
                onChange(withMap(config, m, CONTENT));
              }}
            >
              <span class="item-name">{m.name}</span>
              <span class="item-meta">
                {((m.cells * m.cellSize) / 1000).toFixed(1)} km · {m.startPositions.length} players
              </span>
            </button>
          ))}
          <p class="description">{map.description}</p>
        </Panel>

        <Panel title={`${map.name.toUpperCase()} · ${metres} M`} class="map-panel">
          <MapPreview
            map={map}
            markers={markers}
            phosphor={props.phosphor}
            maxSlope={strictest?.maxSlope ?? 1}
          />
          <div class="muted small">
            Hatched ground is too steep for {strictest?.name.toLowerCase() ?? "some"} units.
          </div>
        </Panel>

        <Panel title="COMBATANTS" class="slots-panel">
          <table class="slots">
            <thead>
              <tr>
                <th>#</th>
                <th>Player</th>
                <th>Faction</th>
                <th>Team</th>
                <th>Colour</th>
              </tr>
            </thead>
            <tbody>
              {config.slots.slice(0, VISIBLE_SLOTS).map((slot, i) => {
                const faction = getFaction(slot.factionId);
                const taken = config.slots
                  .filter((s, j) => j !== i && isActive(s))
                  .map((s) => s.color.toLowerCase());
                return (
                  <tr key={i} data-testid={`slot-${i}`}>
                    <td>{i + 1}</td>
                    <td>{slot.kind === "human" ? "You" : "AI · dormant until M6"}</td>
                    <td>
                      {slot.kind === "human" ? (
                        <span title="Chosen on the next screen">{faction.shortName}</span>
                      ) : (
                        <select
                          value={slot.factionId}
                          aria-label={`Slot ${i + 1} faction`}
                          onChange={(e) => {
                            onChange(withFaction(config, i, getFaction(e.currentTarget.value)));
                          }}
                        >
                          {FACTIONS.map((f) => (
                            <option key={f.id} value={f.id}>
                              {f.shortName}
                            </option>
                          ))}
                        </select>
                      )}
                    </td>
                    <td>{slot.team + 1}</td>
                    <td class="swatches">
                      {slot.kind === "human" ? (
                        <Swatch color={slot.color} selected title="Chosen on the next screen" />
                      ) : (
                        faction.theme.teamColors.slice(0, 4).map((c) => (
                          <Swatch
                            key={c}
                            color={c}
                            selected={c.toLowerCase() === slot.color.toLowerCase()}
                            disabled={taken.includes(c.toLowerCase())}
                            onClick={() => {
                              onChange(withSlot(config, i, { color: c }));
                            }}
                          />
                        ))
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p class="muted small">
            1v1 for now. The slot model already supports FFA and team games; the screens for them
            arrive in M9.
          </p>
          {problems.length > 0 && (
            <ul class="problems" role="alert">
              {problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
      <footer class="screen-actions">
        <TermButton onClick={props.onBack} hotkey="Esc">
          Back
        </TermButton>
        <TermButton
          primary
          disabled={problems.length > 0}
          onClick={props.onNext}
          hotkey="Enter"
          testId="setup-next"
        >
          Choose faction
        </TermButton>
      </footer>
    </div>
  );
}

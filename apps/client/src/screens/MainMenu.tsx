import { FACTIONS, RULESET } from "@stratcom/data";
import { hashHex } from "@stratcom/shared";
import { TICK_RATE } from "@stratcom/sim";
import type { JSX } from "preact";
import type { Capabilities } from "../boot/capabilities";
import { Panel, TermButton } from "../ui/components";

/** Main menu: start a skirmish; the other entries light up in later milestones. */
export function MainMenu(props: {
  caps: Capabilities;
  notice: string | undefined;
  onSkirmish: () => void;
}): JSX.Element {
  return (
    <div class="screen main-menu">
      <div class="title-block">
        <h1 class="game-title">STRATCOM</h1>
        <div class="subtitle">STRATEGIC COMMAND TERMINAL · PRE-ALPHA M3</div>
      </div>
      {props.notice && (
        <div class="notice" role="alert">
          {props.notice}
        </div>
      )}
      <nav class="menu-list" aria-label="Main menu">
        <TermButton primary onClick={props.onSkirmish} hotkey="Enter" testId="menu-skirmish">
          Skirmish
        </TermButton>
        <TermButton disabled onClick={() => undefined} title="Online play arrives in M8">
          Multiplayer · M8
        </TermButton>
        <TermButton disabled onClick={() => undefined} title="Replays arrive in M8">
          Replays · M8
        </TermButton>
        <TermButton disabled onClick={() => undefined} title="Settings arrive in M7">
          Settings · M7
        </TermButton>
      </nav>
      <Panel title="SYSTEM CHECK" class="system-check">
        <ul class="log">
          <li>Renderer: WebGL2, max texture {props.caps.maxTextureSize}px</li>
          <li>Simulation: {TICK_RATE} Hz deterministic lockstep core</li>
          <li>Cross-origin isolated: {props.caps.crossOriginIsolated ? "yes" : "no"}</li>
          <li>
            Ruleset {hashHex(RULESET.hash)}: {RULESET.units.length} units, {RULESET.weapons.length}{" "}
            weapons
          </li>
        </ul>
        <div class="muted">Factions on record:</div>
        <ul class="log">
          {FACTIONS.map((f) => (
            <li key={f.id} style={{ color: f.theme.phosphor }}>
              {f.name}: “{f.tagline}”
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}

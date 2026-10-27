import type { JSX } from "preact";
import { Panel, TermButton } from "../ui/components";

/** One completed loading step. */
export interface LoadLine {
  label: string;
  detail: string;
}

/** Loading screen: a terminal log of the real loading steps as they finish. */
export function Loading(props: {
  title: string;
  lines: readonly LoadLine[];
  onCancel: () => void;
}): JSX.Element {
  return (
    <div class="screen loading-screen">
      <Panel title="ESTABLISHING UPLINK" class="loading-panel">
        <div class="loading-title">{props.title}</div>
        <ul class="log" aria-live="polite">
          {props.lines.map((l) => (
            <li key={l.label}>
              <span class="ok">[ OK ]</span> {l.label.padEnd(11, " ")}
              {l.detail}
            </li>
          ))}
          <li class="cursor-line">
            <span class="cursor" aria-hidden="true">
              █
            </span>
          </li>
        </ul>
      </Panel>
      <footer class="screen-actions">
        <TermButton onClick={props.onCancel} hotkey="Esc">
          Abort
        </TermButton>
      </footer>
    </div>
  );
}

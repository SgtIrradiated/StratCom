import type { ComponentChildren, JSX } from "preact";

/** A bordered terminal panel with an optional title bar. */
export function Panel(props: {
  title?: string;
  class?: string;
  children: ComponentChildren;
}): JSX.Element {
  return (
    <section class={`panel ${props.class ?? ""}`}>
      {props.title !== undefined && <header class="panel-title">{props.title}</header>}
      <div class="panel-body">{props.children}</div>
    </section>
  );
}

/** A terminal-style button. `hotkey` is shown as a hint, e.g. `[Esc]`; it is not bound here. */
export function TermButton(props: {
  onClick: () => void;
  children: ComponentChildren;
  disabled?: boolean;
  primary?: boolean;
  hotkey?: string;
  title?: string;
  testId?: string;
}): JSX.Element {
  return (
    <button
      type="button"
      class={`term-button${props.primary ? " primary" : ""}`}
      disabled={props.disabled}
      onClick={props.onClick}
      title={props.title}
      data-testid={props.testId}
    >
      <span class="label">{props.children}</span>
      {props.hotkey && <span class="hotkey">[{props.hotkey}]</span>}
    </button>
  );
}

/** A label / value row in a stat table. */
export function StatRow(props: { label: string; value: ComponentChildren }): JSX.Element {
  return (
    <div class="stat-row">
      <span class="stat-label">{props.label}</span>
      <span class="stat-value">{props.value}</span>
    </div>
  );
}

/** A small colour square, optionally selectable. */
export function Swatch(props: {
  color: string;
  selected?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  title?: string;
}): JSX.Element {
  return (
    <button
      type="button"
      class={`swatch${props.selected ? " selected" : ""}`}
      style={{ background: props.color }}
      disabled={props.disabled}
      onClick={props.onClick}
      title={props.title ?? props.color}
      aria-label={props.title ?? props.color}
      aria-pressed={props.selected}
    />
  );
}

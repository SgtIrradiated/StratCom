import type { FactionDef } from "@stratcom/data";
import type { Capabilities } from "../boot/capabilities";

/**
 * M0 boot overlay. Plain DOM, built with textContent only (no innerHTML), so data can never
 * inject markup. The Preact-based menu and faction-select screens replace this in M3.
 */
export function renderBootPanel(
  root: HTMLElement,
  info: { caps: Capabilities; tickRate: number; factions: readonly FactionDef[] },
): void {
  const panel = el("section", "boot-panel");
  panel.append(el("h1", undefined, "STRATCOM"), el("div", "muted", "PRE-ALPHA // M1 ENGINE CORE"));

  const status = el("ul");
  status.append(
    el("li", undefined, `Renderer: WebGL2, max texture ${info.caps.maxTextureSize}px`),
    el("li", undefined, `Simulation rate: ${info.tickRate} Hz`),
    el("li", undefined, `Cross-origin isolated: ${info.caps.crossOriginIsolated ? "yes" : "no"}`),
  );

  const factions = el("ul");
  for (const f of info.factions) {
    const item = el("li", undefined, `${f.name}: "${f.tagline}"`);
    item.style.color = f.theme.phosphor;
    factions.append(item);
  }

  panel.append(status, el("div", "muted", "Factions on record:"), factions);
  root.replaceChildren(panel);
}

/** Shows unrecoverable start-up problems instead of the game. */
export function renderBootError(root: HTMLElement, problems: readonly string[]): void {
  const panel = el("section", "boot-panel error");
  panel.append(el("h1", undefined, "STRATCOM"), el("div", undefined, "Cannot start:"));
  const list = el("ul");
  for (const p of problems) list.append(el("li", undefined, p));
  panel.append(list);
  root.replaceChildren(panel);
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

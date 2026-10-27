/**
 * Shows unrecoverable start-up problems instead of the game. Plain DOM built with
 * `textContent` only, because it must work even when the UI framework cannot start.
 */
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

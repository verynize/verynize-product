// Glue between the sidebar island and the legacy layer panel (web/app.js, wonder-shell.js).
import { useLayoutEffect, type RefObject } from "react";
import { hideLegacy, legacy, takeOver } from "@/lib/bridge";

/** The element the island renders into: first child of `aside#layer-panel`. */
export function sidebarRoot(): HTMLElement {
  const panel = document.getElementById("layer-panel") ?? document.body;
  let root = document.getElementById("bd-sidebar-root");
  if (!root) {
    root = document.createElement("div");
    root.id = "bd-sidebar-root";
  }
  if (root.parentElement !== panel || panel.firstElementChild !== root) panel.prepend(root);
  return root;
}

/**
 * Hide everything legacy/parity code put into the layer panel (kept in the DOM for code that still
 * references it) and keep the legacy `#layers` list empty: app.js re-renders it on every render and its
 * `.layer-row` buttons would otherwise duplicate the island's rows (tests count `.layer-row.is-hidden`).
 */
export function quarantineLegacyPanel(root: HTMLElement): () => void {
  const panel = root.parentElement;
  if (!panel) return () => {};
  const hideSiblings = () => {
    for (const child of Array.from(panel.children)) if (child !== root) hideLegacy(child);
  };
  hideSiblings();
  const panelObserver = new MutationObserver(hideSiblings);
  panelObserver.observe(panel, { childList: true });

  const list = document.getElementById("layers");
  // Tells app.js render() not to build rows that `clear` would remove at once.
  list?.setAttribute("data-island-owned", "");
  const clear = () => {
    if (list?.firstChild) list.replaceChildren();
  };
  clear();
  const listObserver = new MutationObserver(clear);
  if (list) listObserver.observe(list, { childList: true });
  return () => {
    panelObserver.disconnect();
    listObserver.disconnect();
    list?.removeAttribute("data-island-owned");
  };
}

/**
 * Take over a legacy control id for an island element. The id moves to the island element in the same
 * task as the legacy element is renamed, so legacy code that looks the id up on every render (e.g.
 * `$('#layer-search').value` in app.js) never sees `null`.
 */
export function useTakeOver(id: string, ref: RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (document.getElementById(id) !== el) takeOver(id);
    el.id = id;
  });
}

/**
 * Click a legacy command button. Once another island has taken the id over, legacy render() writes
 * `disabled` onto the island's element instead of the parked original, so the original can be stale;
 * the legacy handlers guard themselves (e.g. delete-page with one page is a no-op).
 */
export function runLegacy(id: string) {
  const el = legacy(id);
  if (!el) return;
  if (el instanceof HTMLButtonElement) el.disabled = false;
  el.click();
}

// Legacy wiring for the chrome island: which legacy ids it takes over and how commands reach them.
import { hideLegacy, legacy, takeOver } from "@/lib/bridge";

/** Main app menu commands (ids kept for tests and legacy shortcuts such as `$('#undo').click()`). */
export const MENU_IDS = [
  "undo",
  "redo",
  "open-project",
  "save-project",
  "export",
  "preview",
  "show-live-preview",
  "project-toggle",
  "templates-open",
  "rectangle",
  "image",
  "add-icon",
  "import",
  "figma-import",
  "trace-bitmap",
  "capture-webpage",
  "import-tokens",
  "rename-page",
  "delete-page",
  "shell-settings",
] as const;

export const ZOOM_IDS = [
  "zoom-in",
  "zoom-out",
  "zoom-fit",
  "zoom-reset",
  "saved-views-open",
] as const;

// Not `eyedropper-tool` / `add-ellipse`: the Wonder toolbar has no such buttons, so no island element would ever
// claim them (they would hold back the UI-ready signal); canvas-interactions.js already creates them `hidden`.
export const TOOL_IDS = [
  "select-tool",
  "scale-tool",
  "pan-tool",
  "add-frame",
  "add-shader",
  "text",
] as const;

const CHROME_IDS = [
  "files-home",
  "document-name",
  "shell-new-file",
  "shell-search",
  "shell-chat",
] as const;

let initialised = false;
export let initialSnap = true;

/** Take over every legacy control the chrome island renders. Runs once, before the first React render. */
export function initLegacy() {
  if (initialised) return;
  initialised = true;
  initialSnap = (document.getElementById("snap") as HTMLInputElement | null)?.checked !== false;
  for (const id of [...MENU_IDS, ...ZOOM_IDS, ...CHROME_IDS, "icon-kind", "snap"]) takeOver(id);
  // The toolbar only mounts in the editor; Home must be able to report UI readiness.
  for (const id of TOOL_IDS) takeOver(id, { deferred: true });
  // The emptied legacy toolbar (wonder-shell.js) is `position:fixed` and nudged right by `agent-chat-open` rules, so it
  // showed as a stray pill over the panels; park it and hand `#canvas-toolbar` to the island toolbar.
  takeOver("canvas-toolbar", { deferred: true });
  const header = document.querySelector<HTMLElement>("header.app-chrome");
  hideLegacy(
    header,
    document.querySelector("#workspace > .canvas-title"),
    document.querySelector("#workspace > footer"),
  );
}

/** Run a legacy command. Legacy render() keeps writing `disabled` onto whatever element owns the id now, so the
 * parked original can be stale; its handlers guard themselves (e.g. undo with an empty history is a no-op). */
export function run(id: string) {
  const el = legacy(id);
  if (!el) return;
  if (el instanceof HTMLButtonElement) el.disabled = false;
  el.click();
}

export function legacySelect(id: string) {
  return legacy<HTMLSelectElement>(id);
}

/** Re-layout the canvas after a panel width change. */
export function relayout() {
  requestAnimationFrame(() => window.dispatchEvent(new Event("resize")));
}

// Legacy wiring for the inspector island.
// The legacy `<form id="inspector">` is detached from the document (app.js keeps a reference and keeps rendering
// into it), so its same-named fields never collide with the island's visible fields. Legacy handlers that still
// matter (precision align, scale, duplicate, delete, colour picker, shader gallery, artwork export) are driven by
// clicking the detached elements.
import { hideLegacy, legacy, takeOver } from "@/lib/bridge";

let form: HTMLFormElement | null = null;
const ROOT_ID = "bd-inspector-root";

/** Prepare `aside#properties` and return the island container. Runs once, after every legacy script. */
export function setupInspector(): HTMLElement {
  const aside = document.getElementById("properties") as HTMLElement;
  // The form stays attached (hidden) until the island's first commit, see detachLegacyForm().
  form = document.getElementById("inspector") as HTMLFormElement | null;
  // Take over the ids tests and other legacy code click; the legacy elements keep their handlers in the dock.
  takeOver("cloud-toggle");
  takeOver("add-token");
  let root = document.getElementById(ROOT_ID);
  if (!root) {
    root = document.createElement("div");
    root.id = ROOT_ID;
  }
  aside.append(root);
  const hideOthers = () => {
    for (const child of Array.from(aside.children)) if (child !== root) hideLegacy(child);
  };
  hideOthers();
  new MutationObserver(hideOthers).observe(aside, { childList: true });
  return root;
}

/**
 * Detach the legacy form once the island has committed its replacements for the ids app.js render() dereferences
 * (`#shader-settings`, `#fill-hex`, …). Detaching earlier leaves a gap — React renders asynchronously — in which a
 * legacy render() hits null.
 */
export function detachLegacyForm() {
  form?.remove();
}

/** An element inside the detached legacy form. */
export function formElement<T extends HTMLElement = HTMLElement>(id: string): T | null {
  return (form?.querySelector<T>(`#${CSS.escape(id)}`) ?? null) as T | null;
}

/** Click a control of the detached legacy form (runs its original handler). */
export function formClick(id: string) {
  formElement(id)?.click();
}

/** Open the legacy colour picker (`#color-dialog`) for the selected layer. */
export function openColorPicker() {
  (form?.elements.namedItem("color") as HTMLElement | null)?.click();
}

/** Status line used by legacy code for short messages. */
export function notify(message: string) {
  const footer = document.querySelector("footer");
  if (footer) footer.textContent = message;
}

/* ---------- Colour variables (legacy `#tokens` rows rendered by app.js) ---------- */
function tokenRow(name: string): HTMLElement | null {
  const list = legacy("tokens");
  if (!list) return null;
  for (const row of Array.from(list.children) as HTMLElement[])
    if (row.querySelector("span")?.textContent === name) return row;
  return null;
}

export function deleteToken(name: string) {
  tokenRow(name)?.querySelector("button")?.click();
}

export async function createColorToken(): Promise<string | null> {
  const button = legacy("add-token");
  return button?.onclick ? await button.onclick.call(button, new PointerEvent("click")) : null;
}

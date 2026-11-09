// Bridge between React islands and the legacy vanilla renderer (web/*.js).
// Legacy modules expose their APIs on `window`; their DOM controls keep the original handlers.
import { useEffect, useEffectEvent, useState, useSyncExternalStore } from "react";

/* ---------- Legacy window APIs (subset used by islands) ---------- */
export type LayerNode = {
  id: string;
  type: "rectangle" | "text" | "frame" | "image" | "shader" | (string & {});
  parentId: string | null;
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  hidden?: boolean;
  locked?: boolean;
  [key: string]: unknown;
};
export type DesignPage = { id: string; name: string; nodes: LayerNode[]; background?: string };
/** An SVG in the file's icon library (`document.icons`); `src` is a base64 `data:image/svg+xml` URL. */
export type DesignIcon = { id: string; name: string; src: string };
export type DesignDocument = {
  version: number;
  name: string;
  activePage: string;
  pages: DesignPage[];
  tokens: Record<string, string>;
  [key: string]: unknown;
};
export type DesignApi = {
  getDocument(): DesignDocument;
  /** Shared deeply frozen commit snapshot; copy before mutation. */
  getSnapshot(): DesignDocument;
  setDocument(doc: DesignDocument): void;
  subscribe(fn: (doc: DesignDocument) => void): () => void;
  getSelection(): string[];
  setSelection(ids: string[]): void;
  updateNodes(
    ids: string[],
    patch: Partial<LayerNode> | ((node: LayerNode) => Partial<LayerNode>),
  ): boolean;
  /** Insert a layer (one undo step) where the user is looking; selects it and returns its id. */
  addNode(type: string, extra?: Partial<LayerNode>): string;
  /** Replace the file's icon library (validated, one undo step); an empty list removes it. */
  setIcons(icons: DesignIcon[]): boolean;
  /** Patch the page `id` (default: the active page; validated, one undo step); `undefined` values remove the key. */
  updatePage(patch: Partial<Omit<DesignPage, "id" | "nodes">>, id?: string): boolean;
  /** Set (or with an empty id clear) the file's thumbnail layer, `document.thumbnailNodeId` (validated, one undo step). */
  setThumbnail(id: string): boolean;
  setActivePage(id: string): void;
  canUndo(): boolean;
  /** Undo history writes made by edits since launch (loading a document is not counted). */
  editCount(): number;
  canRedo(): boolean;
  getCamera(): { x: number; y: number; zoom: number };
  /** Camera and active page of the canvas view. */
  getView?: () => {
    zoom: number;
    scrollLeft: number;
    scrollTop: number;
    page: string;
    x: number;
    y: number;
  };
  screenToWorld?: (x: number, y: number) => { x: number; y: number };
  exportHTML?: () => string;
  /** Editor defaults on every page now (a shared room's copy is prepared whole). */
  prepareAllPages?: () => void;
  setCamera(x: number, y: number, zoom: number): void;
  zoomToFit(): void;
  setTool(tool: string): void;
  getTool(): string;
  commands(): { id: string; label?: string }[];
  runCommand(id: string, arg?: unknown): boolean;
  /** Constraints of a positioned layer ({h, v}: start/end/stretch/center/scale), or null when it has none. */
  getConstraints?: (id: string) => { h: string; v: string } | null;
  /** Change constraints without moving the layers (one undo step). */
  setConstraints?: (ids: string[], constraints: { h?: string; v?: string }) => boolean;
  [key: string]: unknown;
};

/** The shared room a library file is linked to (`fileLibrary.cloudOf`). */
export type FileCloud = {
  server: string;
  roomId: string;
  token?: string;
  detached?: boolean;
  [key: string]: unknown;
};

declare global {
  interface Window {
    design: DesignApi;
    verynize: DesignApi;
    agentWorkspace?: Record<string, (...args: never[]) => unknown>;
    fileLibrary?: Record<string, unknown> & {
      list(): unknown[];
      currentId: string | null;
      findCloud?(server: string, roomId: string): string | null;
      cloudOf?(id: string): FileCloud | null;
      setCloud?(id: string, cloud: FileCloud | null, initializeMetadata?: boolean): void;
      open?(id: string, options?: { cloud?: FileCloud; [key: string]: unknown }): unknown;
      createFromDocument?(
        document: DesignDocument,
        options?: { cloud?: FileCloud; [key: string]: unknown },
      ): Promise<string>;
      ready?(): Promise<unknown>;
      flush?(): Promise<unknown>;
      showHome?(): void;
      applyEditor?(): void;
    };
    appSettings?: { open(section?: string): void; close?(): void };
    appPreferences?: { get(): Record<string, unknown> };
    askText?: (title: string, value?: string) => Promise<string | null>;
  }
}

export const design = (): DesignApi => window.design;

/* ---------- Design store hooks ---------- */
let snapshot: DesignDocument | null = null;
let selectionSnapshot: string[] = [];
const listeners = new Set<() => void>();
let attached = false;
function attach() {
  if (attached || !window.design) return;
  attached = true;
  snapshot = window.design.getSnapshot();
  selectionSnapshot = window.design.getSelection();
  window.design.subscribe((doc) => {
    snapshot = doc;
    const next = window.design.getSelection();
    if (next.join() !== selectionSnapshot.join()) selectionSnapshot = next;
    listeners.forEach((fn) => fn());
  });
}
function subscribe(fn: () => void) {
  attach();
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Current document; re-renders after every legacy render(). */
export function useDesign(): DesignDocument {
  return useSyncExternalStore(subscribe, () => {
    attach();
    return snapshot as DesignDocument;
  });
}

/** Selected layer ids. */
export function useSelection(): string[] {
  return useSyncExternalStore(subscribe, () => {
    attach();
    return selectionSnapshot;
  });
}

export function activePage(doc: DesignDocument): DesignPage {
  return doc.pages.find((p) => p.id === doc.activePage) ?? doc.pages[0];
}

/** Re-render when a body class changes (layout state such as `left-collapsed`, `agent-chat-open`, `files-view`). */
export function useBodyClass(name: string): boolean {
  const [on, setOn] = useState(() => document.body.classList.contains(name));
  useEffect(() => {
    const observer = new MutationObserver(() => setOn(document.body.classList.contains(name)));
    observer.observe(document.body, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, [name]);
  return on;
}

/** Subscribe to a window event (e.g. "app-preferences-changed"). */
export function useWindowEvent(name: string, fn: (event: Event) => void) {
  // Always calls the latest `fn` without re-adding the listener when an inline handler changes identity.
  const onEvent = useEffectEvent(fn);
  useEffect(() => {
    const listener = (event: Event) => onEvent(event);
    window.addEventListener(name, listener);
    return () => window.removeEventListener(name, listener);
  }, [name]);
}

/* ---------- Legacy controls ---------- */
// Legacy scripts bind handlers to elements by id when they load. An island "takes over" an id:
// the legacy element is renamed to `legacy-<id>` and parked in a hidden dock, and the island renders
// its own visible element with the original id that forwards to the legacy element.
const taken = new Map<string, HTMLElement>();
function dock() {
  let d = document.getElementById("bd-legacy-dock");
  if (!d) {
    d = document.createElement("div");
    d.id = "bd-legacy-dock";
    d.hidden = true;
    d.setAttribute("aria-hidden", "true");
    document.body.append(d);
  }
  return d;
}

// The legacy element keeps its id until the island has rendered its own element with that id, so legacy code
// such as render() (`$("#document-name").value = …`) never dereferences null in between.
const pending = new Map<string, HTMLElement>();
let pendingObserver: MutationObserver | null = null;
function claimPending() {
  for (const [id, el] of pending) {
    const owners = document.querySelectorAll(`[id="${CSS.escape(id)}"]`);
    if ([...owners].some((node) => node !== el)) {
      el.id = `legacy-${id}`;
      pending.delete(id);
    }
  }
  if (!pending.size) {
    pendingObserver?.disconnect();
    pendingObserver = null;
  }
  checkUiReady();
}

/**
 * Park a legacy element and hand its id to the island once the island renders it. Returns the legacy element.
 * `deferred`: the island renders the id only on demand (a command inside a closed menu), so the id does not hold
 * back the UI-ready signal.
 */
export function takeOver(
  id: string,
  options: { park?: boolean; deferred?: boolean } = {},
): HTMLElement | null {
  const existing = taken.get(id);
  if (existing) return existing;
  const el = document.getElementById(id);
  if (!el) return null;
  if (options.park !== false) dock().append(el);
  taken.set(id, el);
  pending.set(id, el);
  if (options.deferred) deferred.add(id);
  if (!pendingObserver) {
    pendingObserver = new MutationObserver(claimPending);
    pendingObserver.observe(document.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["id"],
    });
  }
  claimPending();
  return el;
}

/* ---------- UI ready ---------- */
// One-shot signal that the shell's taken-over controls are claimed: every island mounted with mountIsland() has
// committed its first render AND no non-deferred takeOver id is still pending (until claimed, the id resolves to the
// hidden parked legacy element). Then `<html data-ui-ready="true">` is set and `bd:ui-ready` fires on window.
// Content an island renders on demand (menus, dialogs, settings pages) is not part of it.
declare global {
  interface Window {
    /** Diagnostics: what still holds back the UI-ready signal (empty `islands`/`ids` once ready). */
    __bdPendingTakeovers?: () => { islands: string[]; ids: string[]; deferred: string[] };
  }
}
const deferred = new Set<string>();
const mounting = new Set<string>();
let uiReady = false;
let uiReadyStarted = false;
const UI_READY_WARN_MS = 5000;

function blockingIds() {
  return [...pending.keys()].filter((id) => !deferred.has(id));
}

window.__bdPendingTakeovers = () => ({
  islands: [...mounting],
  ids: blockingIds(),
  deferred: [...pending.keys()].filter((id) => deferred.has(id)),
});

function checkUiReady() {
  if (uiReady || !uiReadyStarted || mounting.size || blockingIds().length) return;
  uiReady = true;
  document.documentElement.dataset.uiReady = "true";
  window.dispatchEvent(new Event("bd:ui-ready"));
}

/** mountIsland() calls this before it renders: the island holds back the UI-ready signal until it commits. */
export function registerIsland(name: string) {
  if (uiReady) return;
  mounting.add(name);
  if (uiReadyStarted) return;
  uiReadyStarted = true;
  // Never sets the signal itself; it only names what is stuck so a missing claim is diagnosable.
  setTimeout(() => {
    if (!uiReady)
      console.warn(
        `[bd] UI not ready after ${UI_READY_WARN_MS} ms`,
        JSON.stringify(window.__bdPendingTakeovers?.()),
      );
  }, UI_READY_WARN_MS);
}

const committedWaiters: (() => void)[] = [];
/**
 * Resolves once every island mounted so far has committed its first render. The web app renders the areas its
 * routes own after this, as the router island applies the first location after the other islands on desktop.
 */
export function islandsCommitted(): Promise<void> {
  if (!mounting.size) return Promise.resolve();
  return new Promise((resolve) => committedWaiters.push(resolve));
}

/** mountIsland() calls this once the island's first render has committed. */
export function markIslandCommitted(name: string) {
  if (!mounting.delete(name)) return;
  if (!mounting.size) for (const resolve of committedWaiters.splice(0)) resolve();
  // Island elements usually claim their ids through the MutationObserver; this pass covers the case where none is pending.
  claimPending();
}

/** The legacy element for an id, whether or not it has been taken over. */
export function legacy<T extends HTMLElement = HTMLElement>(id: string): T | null {
  return (taken.get(id) ??
    document.getElementById(`legacy-${id}`) ??
    document.getElementById(id)) as T | null;
}

/** Click a legacy control (runs its original handler). */
export function legacyClick(id: string) {
  legacy(id)?.click();
}

/** Set a legacy form control value and fire `change` (and `input`) like a user edit. */
export function legacySet(
  el: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | null,
  value: string | boolean,
) {
  if (!el) return;
  if (el instanceof HTMLInputElement && el.type === "checkbox") el.checked = Boolean(value);
  else el.value = String(value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

/** Hide legacy DOM that an island replaces visually without removing it (keeps references valid). */
export function hideLegacy(...elements: (Element | null | undefined)[]) {
  for (const el of elements) if (el instanceof HTMLElement) el.dataset.bdHidden = "true";
}

/* ---------- Portals ---------- */
/** Container for Radix portals so menus/popovers/dialogs get the island reset and tokens. */
export function portalContainer(): HTMLElement {
  let el = document.getElementById("bd-portal");
  if (!el) {
    el = document.createElement("div");
    el.id = "bd-portal";
    el.setAttribute("data-bd", "");
    document.body.append(el);
  }
  return el;
}

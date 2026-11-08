// Expanded preview tabs (Wonder PF3 / X5): "Open in a tab ⌘⌥P" and the frame's expand button open a canvas preview
// frame as its own app tab in the title bar. The tab loads the running app fresh in a second iframe (its own page
// state), polls the dev server on its own (closing it or the canvas frame never stops the server) and "Show on
// canvas" returns to the design file with the frame selected; the tab stays open.
//
// Public API: window.previewTab.open(frameId) / close(frameId) / showOnCanvas(frameId) / activate(frameId|null) /
// list(). Body class `preview-tab-view` while a preview tab is the visible tab.
import { useSyncExternalStore } from "react";
import type { LayerNode } from "@/lib/bridge";
import { platform } from "@/lib/platform";

export type PreviewTabStatus = "running" | "starting" | "stopped" | "error";
export type PreviewTab = {
  frameId: string;
  fileId: string | null;
  root: string;
  chatId: string;
  name: string;
  /** Address the iframe loads: the server's base URL (fresh), or a path the user typed. */
  src: string;
  /** Address the page is showing now (follows in-app navigation; drives the path field). */
  url: string;
  status: PreviewTabStatus;
  /** Bumped whenever the app must load again (server came back, reload while stopped). */
  load: number;
};
type State = { tabs: PreviewTab[]; active: string | null };

type PreviewNode = LayerNode & {
  preview?: { root?: string; name?: string; chatId?: string; url?: string };
};
type LivePreview = {
  nodeElement?(id: string): HTMLElement | undefined;
  getNodeId?(): string | null;
  getURL?(): string;
};
type FileLibrary = {
  currentId?: string | null;
  open?(id: string): Promise<unknown>;
  showEditor?(): void;
};

const desktop = () => platform.desktop;
const livePreview = () => (window as unknown as { livePreview?: LivePreview }).livePreview;
const fileLibrary = () => window.fileLibrary as unknown as FileLibrary | undefined;

export const TAB_FRAME_NAME = "verynize-preview-tab";
export const VIEW_CLASS = "preview-tab-view";

let state: State = { tabs: [], active: null };
const listeners = new Set<() => void>();
function set(next: Partial<State>) {
  state = { ...state, ...next };
  document.body.classList.toggle(VIEW_CLASS, !!state.active);
  listeners.forEach((fn) => fn());
  window.dispatchEvent(new Event("bd:preview-tabs"));
  schedulePoll();
}
function patchTab(frameId: string, patch: Partial<PreviewTab>) {
  set({ tabs: state.tabs.map((tab) => (tab.frameId === frameId ? { ...tab, ...patch } : tab)) });
}
export function usePreviewTabs(): State {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => state,
  );
}

export function localURL(value: string): string {
  const url = new URL(value);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
    url.username ||
    url.password
  )
    throw Error("Enter a localhost application URL");
  return url.href;
}

function findNode(frameId: string): PreviewNode | null {
  const doc = window.design?.getDocument();
  for (const page of doc?.pages ?? []) {
    const node = page.nodes.find((candidate) => candidate.id === frameId) as
      | PreviewNode
      | undefined;
    if (node?.preview) return node;
  }
  return null;
}

/** Worktree (or repository) folder name, capitalised as Wonder titles the tab after the chat's worktree ("Dipper"). */
function tabName(node: PreviewNode): string {
  const root = node.preview?.root?.replace(/\/+$/, "") ?? "";
  const folder = root.split("/").pop();
  if (folder) return folder[0].toUpperCase() + folder.slice(1);
  return node.preview?.name || node.name.replace(/ · Preview$/, "") || "Preview";
}

/** State the canvas frame paints (web/live-preview.js `data-preview-state`), used when no root can be polled. */
function canvasStatus(frameId: string): PreviewTabStatus | null {
  const value = livePreview()?.nodeElement?.(frameId)?.dataset.previewState;
  if (value === "running" || value === "starting") return value;
  if (value === "error") return "error";
  if (value === "paused") return "stopped";
  return null;
}
function canvasURL(node: PreviewNode): string {
  const preview = livePreview();
  const url = (preview?.getNodeId?.() === node.id && preview.getURL?.()) || node.preview?.url || "";
  try {
    return url ? localURL(url) : "";
  } catch {
    return "";
  }
}
function fromServer(value: string | undefined): PreviewTabStatus {
  if (value === "running") return "running";
  if (value === "starting") return "starting";
  if (value === "failed") return "error";
  return "stopped";
}

async function refresh(tab: PreviewTab) {
  let status: PreviewTabStatus | null = null;
  let base = "";
  if (tab.root && desktop()?.devServer) {
    try {
      const result = await desktop()!.devServer!.status({ root: tab.root });
      status = fromServer(result.state);
      base = result.url || "";
    } catch {
      status = null;
    }
  }
  if (!status) {
    // No dev server for this root (a plain localhost URL shown on the canvas): follow the canvas frame.
    status = canvasStatus(tab.frameId) ?? tab.status;
    const node = findNode(tab.frameId);
    if (node) base = canvasURL(node);
  }
  const current = state.tabs.find((candidate) => candidate.frameId === tab.frameId);
  if (!current) return;
  const patch: Partial<PreviewTab> = {};
  if (status !== current.status) patch.status = status;
  if (status === "running") {
    if (!current.src && base) {
      try {
        // The server came back (or first load): load the app fresh from its own address.
        patch.src = patch.url = localURL(base);
        patch.load = current.load + 1;
      } catch {
        /* not a localhost address: keep the stopped placeholder */
      }
    }
  } else if (status === "stopped" || status === "error") {
    // The next start loads the server's address again, fresh.
    if (current.src) patch.src = patch.url = "";
  }
  if (Object.keys(patch).length) patchTab(tab.frameId, patch);
}

let timer: number | undefined;
let polling = false;
function schedulePoll() {
  if (!state.tabs.length) {
    window.clearInterval(timer);
    timer = undefined;
    return;
  }
  if (timer !== undefined) return;
  timer = window.setInterval(() => void pollAll(), 1500);
}
async function pollAll() {
  if (polling) return;
  polling = true;
  try {
    await Promise.all(state.tabs.map(refresh));
  } finally {
    polling = false;
  }
}

/** A preview tab replaces the Files home and the Code workspace, like any file tab. */
function leaveOtherViews() {
  const workspace = window.agentWorkspace as { setCodeMode?: (on: boolean) => void } | undefined;
  if (document.body.classList.contains("code-mode")) workspace?.setCodeMode?.(false);
  if (document.body.classList.contains("files-view")) fileLibrary()?.showEditor?.();
}

/** Preview frames of the open design file, with the tab title and status (the file switcher's Previews). */
export function previewFrames(): {
  frameId: string;
  title: string;
  name: string;
  status: PreviewTabStatus;
}[] {
  const doc = window.design?.getDocument();
  const frames: { frameId: string; title: string; name: string; status: PreviewTabStatus }[] = [];
  for (const page of doc?.pages ?? [])
    for (const node of page.nodes as PreviewNode[]) {
      if (!node.preview) continue;
      const tab = state.tabs.find((candidate) => candidate.frameId === node.id);
      frames.push({
        frameId: node.id,
        title: node.name.replace(/ · Preview$/, "") || "Preview",
        name: tab?.name ?? tabName(node),
        status: tab?.status ?? canvasStatus(node.id) ?? "stopped",
      });
    }
  return frames;
}

/** Open (or focus) the tab for a canvas preview frame. Returns false when the frame is unknown. */
export function open(frameId: string): boolean {
  if (typeof frameId !== "string" || !frameId) return false;
  const existing = state.tabs.find((tab) => tab.frameId === frameId);
  const node = findNode(frameId);
  if (!existing && !node) return false;
  leaveOtherViews();
  if (existing) {
    if (node) patchTab(frameId, { name: tabName(node) });
    set({ active: frameId });
    void refresh(state.tabs.find((tab) => tab.frameId === frameId)!);
    return true;
  }
  const preview = node!.preview ?? {};
  const tab: PreviewTab = {
    frameId,
    fileId: fileLibrary()?.currentId ?? null,
    root: preview.root ?? "",
    chatId: preview.chatId ?? "",
    name: tabName(node!),
    src: "",
    url: "",
    status: canvasStatus(frameId) === "running" && !preview.root ? "running" : "stopped",
    load: 0,
  };
  if (tab.status === "running") {
    tab.src = tab.url = canvasURL(node!);
    tab.load = 1;
  }
  set({ tabs: [...state.tabs, tab], active: frameId });
  void refresh(tab);
  return true;
}

/** Close the tab; never stops the dev server. */
export function close(frameId: string): boolean {
  const index = state.tabs.findIndex((tab) => tab.frameId === frameId);
  if (index < 0) return false;
  const tabs = state.tabs.filter((tab) => tab.frameId !== frameId);
  set({ tabs, active: state.active === frameId ? null : state.active });
  return true;
}

/** Make a preview tab the visible tab, or (null) go back to the design file. */
export function activate(frameId: string | null) {
  if (frameId && !state.tabs.some((tab) => tab.frameId === frameId)) return;
  if (frameId) leaveOtherViews();
  if (state.active !== frameId) set({ active: frameId });
}

/** Back to the design file with the frame selected and in view; the tab stays open. */
export async function showOnCanvas(frameId: string) {
  const tab = state.tabs.find((candidate) => candidate.frameId === frameId);
  set({ active: null });
  const library = fileLibrary();
  if (document.body.classList.contains("files-view")) library?.showEditor?.();
  if (tab?.fileId && library?.currentId !== tab.fileId && library?.open) {
    try {
      await library.open(tab.fileId);
    } catch {
      return;
    }
  }
  const doc = window.design.getDocument();
  const page = doc.pages.find((candidate) => candidate.nodes.some((node) => node.id === frameId));
  if (!page) return;
  if (doc.activePage !== page.id) window.design.setActivePage(page.id);
  window.design.setSelection([frameId]);
  const node = page.nodes.find((candidate) => candidate.id === frameId)!;
  const wrap = document.getElementById("canvas-wrap")?.getBoundingClientRect();
  if (wrap) {
    const zoom = Math.max(
      0.02,
      Math.min((wrap.width - 100) / node.w, (wrap.height - 140) / node.h, 1),
    );
    window.design.setCamera(50 - node.x * zoom, 60 - node.y * zoom, zoom);
  }
}

export function getTab(frameId: string) {
  return state.tabs.find((tab) => tab.frameId === frameId) ?? null;
}
/** The page navigated by itself (links, back/forward): only the path field follows. */
export function setTabURL(frameId: string, url: string) {
  const tab = getTab(frameId);
  if (tab && tab.url !== url) patchTab(frameId, { url });
}
/** Load an address (typed path, reload) in the tab's iframe. */
export function loadTab(frameId: string, src?: string) {
  const tab = getTab(frameId);
  if (!tab) return;
  const next = src ?? tab.url ?? tab.src;
  if (next) patchTab(frameId, { src: next, url: next, load: tab.load + 1 });
}

let installed = false;
export function installPreviewTabs() {
  if (installed) return;
  installed = true;
  const api = {
    open,
    close,
    activate,
    showOnCanvas: (frameId: string) => void showOnCanvas(frameId),
    list: () =>
      state.tabs.map(({ frameId, name, status, url }) => ({
        frameId,
        name,
        status,
        url,
        active: state.active === frameId,
      })),
    getActive: () => state.active,
  };
  (window as unknown as { previewTab: typeof api }).previewTab = api;
  // The Files home replaces whatever tab was visible.
  new MutationObserver(() => {
    if (state.active && document.body.classList.contains("files-view")) set({ active: null });
  }).observe(document.body, { attributes: true, attributeFilter: ["class"] });
  // While a preview tab is visible, canvas shortcuts (Delete, arrows, tools, ⌘Z…) must not edit the hidden canvas.
  // Only keys aimed at the page itself or at the tab's own chrome are held back; menus, dialogs and fields keep theirs,
  // and stopping propagation leaves native button activation (Space/Enter) intact.
  window.addEventListener(
    "keydown",
    (event) => {
      if (!state.active || document.body.classList.contains("code-mode") || event.key === "Escape")
        return;
      const target = event.target as HTMLElement | null;
      const page = !target || target === document.body || target === document.documentElement;
      if (!page && !target?.closest("#preview-tab-view")) return;
      if (
        target?.closest(
          "input, textarea, select, [contenteditable=true], [role=menu], [role=dialog]",
        )
      )
        return;
      if (canvasShortcut(event)) event.stopImmediatePropagation();
    },
    true,
  );
}

function canvasShortcut(event: KeyboardEvent): boolean {
  const mac = /Mac|iPhone|iPad/.test(navigator.platform);
  const mod = mac ? event.metaKey : event.ctrlKey;
  // Plain keys (tools, nudges, Delete, opacity digits) only ever mean something to the canvas here.
  if (!mod && !event.altKey) return true;
  if (mod && event.altKey && event.code === "KeyP") return false;
  const key = /^Key[A-Z]$/.test(event.code)
    ? event.code.slice(3).toLowerCase()
    : /^(Digit|Numpad)\d$/.test(event.code)
      ? event.code.at(-1)!
      : event.key.toLowerCase();
  const combo = [
    mod && "mod",
    mac && event.ctrlKey && "ctrl",
    event.altKey && "alt",
    event.shiftKey && "shift",
    key,
  ]
    .filter(Boolean)
    .join("+");
  const commands = (window.design?.commands?.() ?? []) as { keys?: string[] }[];
  return commands.some((command) => command.keys?.includes(combo));
}

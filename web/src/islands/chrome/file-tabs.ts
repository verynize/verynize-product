// Open file tabs in the title bar. The design file shown in the editor is always one of them; opening another file
// (Files home, the file switcher, links) adds its tab instead of replacing the one tab. Closing the shown file's tab
// moves to its neighbour, or to Files when it was the last one. Tab order is kept in localStorage.
import { useSyncExternalStore } from "react";

export type FileSummary = { id: string; name: string; updated: number; archived: boolean };
type Library = {
  readonly currentId: string | null;
  summaries?(): FileSummary[];
  subscribe?(fn: () => void): () => void;
  open?(id: string): Promise<unknown>;
  showHome?(): void;
};

const STORAGE_KEY = "verynize.fileTabs";
const library = () => window.fileLibrary as unknown as Library | undefined;

function read(): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

let ids: string[] = read();
// The shown file whose tab was closed (the last tab, Files took over): no tab until it is opened again.
let closedShown: string | null = null;
// The file a tab switch is loading (web/switch-coordinator.js): its tab looks active at once, like Pen.
let pendingId: string | null = null;
// The tab a load added for its destination: removed again when that load fails or is canceled.
let pendingAdded: string | null = null;
let snapshot: {
  tabs: FileSummary[];
  currentId: string | null;
  hidden: boolean;
  pendingId: string | null;
} = {
  tabs: [],
  currentId: null,
  hidden: false,
  pendingId: null,
};
let snapshotKey = "";
const listeners = new Set<() => void>();

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
  } catch {
    /* storage full: tabs still work for this session */
  }
}

/** Rebuild the visible tabs from the library: drops files that no longer exist, always includes the shown file. */
function update() {
  const lib = library();
  const files = new Map((lib?.summaries?.() ?? []).map((file) => [file.id, file]));
  const currentId = lib?.currentId ?? null;
  if (closedShown && closedShown !== currentId) closedShown = null;
  let next = ids.filter((id) => files.has(id));
  if (currentId && currentId !== closedShown && files.has(currentId) && !next.includes(currentId))
    next = [...next, currentId];
  if (pendingId && files.has(pendingId) && !next.includes(pendingId)) {
    next.push(pendingId);
    pendingAdded = pendingId;
  }
  if (next.join() !== ids.join()) {
    ids = next;
    save();
  }
  const tabs = ids.map((id) => files.get(id)!);
  const hidden = !currentId || !ids.includes(currentId);
  const pending = pendingId !== currentId && files.has(pendingId ?? "") ? pendingId : null;
  const key = JSON.stringify([currentId, hidden, pending, tabs.map((tab) => [tab.id, tab.name])]);
  if (key === snapshotKey) return;
  snapshotKey = key;
  snapshot = { tabs, currentId, hidden, pendingId: pending };
  listeners.forEach((fn) => fn());
}

let installed = false;
function install() {
  if (installed) return;
  const lib = library();
  if (!lib?.subscribe) return;
  installed = true;
  lib.subscribe(update);
  window.addEventListener("switch-loading-change", (event) => {
    const { kind, phase, to } = (event as CustomEvent).detail ?? {};
    if (kind !== "file") return;
    if (phase === "begin") pendingAdded = null;
    else if (phase !== "ready") {
      const added = pendingAdded;
      pendingAdded = null;
      if (
        (phase === "fail" || phase === "cancel") &&
        added &&
        added === to?.fileKey &&
        added !== library()?.currentId
      ) {
        ids = ids.filter((id) => id !== added);
        save();
      }
    }
    pendingId = phase === "begin" ? (to?.fileKey ?? null) : null;
    update();
  });
  window.addEventListener("library-file-opened", () => {
    // Opening a file always gives it a tab, even the one whose tab was just closed.
    closedShown = null;
    update();
  });
  update();
}

export function useFileTabs() {
  return useSyncExternalStore(
    (fn) => {
      install();
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => snapshot,
  );
}

export function openFileTab(id: string) {
  const lib = library();
  if (!lib?.open) return;
  if (lib.currentId === id) {
    closedShown = null;
    (window.fileLibrary as { showEditor?: () => void } | undefined)?.showEditor?.();
    update();
    return;
  }
  lib.open(id).catch((error: unknown) => console.error(error));
}

/** Close a file tab; closing the shown file opens its right (else left) neighbour, or Files when none is left. */
export function closeFileTab(id: string) {
  const index = ids.indexOf(id);
  if (index < 0) return;
  const shown = library()?.currentId === id;
  ids = ids.filter((tab) => tab !== id);
  save();
  if (shown) {
    // Until the neighbour has opened (or for good, when Files takes over) the shown file has no tab.
    closedShown = id;
    const next = ids[index] ?? ids[index - 1];
    if (next) openFileTab(next);
    else library()?.showHome?.();
  }
  update();
}

/** Keep only `id`'s tab. */
export function closeOtherFileTabs(id: string) {
  ids = ids.filter((tab) => tab === id);
  save();
  if (library()?.currentId !== id) openFileTab(id);
  update();
}

/** Move a tab to `index` in the strip (drag to reorder). */
export function moveFileTab(id: string, index: number) {
  const from = ids.indexOf(id);
  if (from < 0) return;
  const next = ids.filter((tab) => tab !== id);
  const to = Math.max(0, Math.min(next.length, index));
  next.splice(to, 0, id);
  if (next.join() === ids.join()) return;
  ids = next;
  save();
  update();
}

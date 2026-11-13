// The file open in the Code workspace editor (one at a time; project memory counts as a file).
import { useSyncExternalStore } from "react";
import { desktop, errorMessage, setStatus, workspace } from "./api";

export type OpenFile = {
  kind: "file" | "memory";
  path: string;
  root: string | null;
  text: string;
  saved: string;
  loading?: boolean;
};
let open: OpenFile | null = null;
const listeners = new Set<() => void>();
const set = (next: OpenFile | null) => {
  open = next;
  workspace()?.setOpenFile?.(
    next && next.kind === "file" ? { path: next.path, text: next.text } : null,
  );
  listeners.forEach((fn) => fn());
};

export function useOpenFile(): OpenFile | null {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => open,
  );
}

const activeRoot = () => workspace()?.getState().activeRoot ?? null;
const dirty = () => !!open && open.text !== open.saved;
const canLeave = () => !dirty() || window.confirm("Discard unsaved file edits?");

export async function openFile(path: string) {
  const api = desktop();
  if (!api?.readFile || (open?.path === path && open.kind === "file") || !canLeave()) return;
  const root = activeRoot();
  set({ kind: "file", path, root, text: "", saved: "", loading: true });
  try {
    const text = await api.readFile(path);
    if (open?.path === path) set({ kind: "file", path, root, text, saved: text });
  } catch (error) {
    if (open?.path === path) set(null);
    setStatus(errorMessage(error));
  }
}

export async function openMemory() {
  const api = desktop();
  if (!api?.readMemory || !canLeave()) return;
  workspace()?.setCodeMode?.(true);
  try {
    const text = await api.readMemory();
    set({ kind: "memory", path: "VERYNIZE.md", root: activeRoot(), text, saved: text });
  } catch (error) {
    setStatus(errorMessage(error));
  }
}

export function editText(text: string) {
  if (open) set({ ...open, text });
}

export async function saveFile() {
  const api = desktop();
  const file = open;
  if (!file || !api) return;
  try {
    if (file.root !== activeRoot()) throw Error("The chat changed; reopen the file to save it");
    if (file.kind === "memory") await api.writeMemory?.(file.text);
    else await api.writeFile?.(file.path, file.text);
    if (open === file || open?.path === file.path) set({ ...(open ?? file), saved: file.text });
    setStatus("Saved");
    window.dispatchEvent(new CustomEvent("code-files-changed", { detail: { root: file.root } }));
  } catch (error) {
    setStatus(errorMessage(error));
  }
}

export function closeFile(force = false) {
  if (!force && !canLeave()) return false;
  set(null);
  return true;
}

/** Root switched (another chat): the open file belonged to the old tree. */
export function rootChanged(root: string | null) {
  if (open && open.root !== root) {
    if (dirty()) setStatus(`Unsaved edits to ${open.path} were discarded when the chat changed`);
    set(null);
  }
}

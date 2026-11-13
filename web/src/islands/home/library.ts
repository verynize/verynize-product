// Typed view of `window.fileLibrary` (owned by web/wonder-shell.js) for the home island.
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { DesignDocument } from "@/lib/bridge";

export type LibraryFile = {
  id: string;
  name: string;
  document: DesignDocument;
  updated: number;
  folder: string | null;
  archived: boolean;
  publication?: { url: string; publicId?: string; revision?: number };
  nativePath?: string;
  /** Cloud-backed file: the room it opens (web/cloud-panel.js reconnects it). */
  cloud?: CloudLink;
  /** Set on rooms listed from the server that have no file on this device yet. */
  room?: CloudRoom;
  /** The stored document no longer loads (web/document-safety.js): kept and listed, opening it explains why. */
  invalid?: { error: string; count: number };
};
export type CloudLink = {
  server: string;
  roomId: string;
  role?: string;
  detached?: boolean;
};
/** A room from `/api/orgs/:id/rooms` or `/api/me/rooms` (cloud/README.md). */
export type CloudRoom = {
  id: string;
  server: string;
  title: string;
  role: string;
  updatedAt: number;
  /** Organization that owns the room, or null when it is shared with you directly. */
  organizationName: string | null;
};
export type LibraryFolder = { id: string; name: string };
export type Filter = "all" | "public" | "private" | "archived";

type FileLibraryApi = {
  list(): LibraryFile[];
  folders(): LibraryFolder[];
  subscribe(fn: () => void): () => void;
  readonly folder: string | null;
  readonly currentId: string | null;
  setFolder(id: string | null): void;
  open(id: string): Promise<string | undefined>;
  openRoomFile(room: CloudRoom): Promise<string | undefined>;
  create(): Promise<void>;
  rename(id: string, name: string): Promise<boolean>;
  duplicate(id: string): Promise<string | null>;
  move(id: string, folderId: string | null): boolean;
  setArchived(id: string, archived: boolean): boolean;
  createFolder(name: string): string | null;
  thumbnail(id: string): HTMLElement | null;
  attachView(): () => void;
  showHome(): void;
  showEditor(): void;
};

export const library = () => window.fileLibrary as unknown as FileLibraryApi;

/* A version counter bumped on every library change; data is read lazily while the home screen is open. */
let version = 0;
const bump = () => {
  version += 1;
};
let subscribed = false;
function subscribe(fn: () => void) {
  const lib = library();
  if (!subscribed) {
    lib.subscribe(bump);
    subscribed = true;
  }
  return lib.subscribe(fn);
}

export function useLibrary(active: boolean) {
  const current = useSyncExternalStore(subscribe, () => version);
  return useMemo(() => {
    const lib = library();
    if (!active)
      return {
        files: [] as LibraryFile[],
        folders: [] as LibraryFolder[],
        folder: null,
        version: current,
      };
    return { files: lib.list(), folders: lib.folders(), folder: lib.folder, version: current };
  }, [active, current]);
}

/* Workspace display name from Settings › Account (appPreferences.displayName). */
export function useWorkspaceName() {
  const read = useCallback(() => {
    const prefs = (window.appPreferences?.get?.() ?? {}) as { displayName?: string; name?: string };
    return prefs.displayName || prefs.name || "Personal workspace";
  }, []);
  const [name, setName] = useState(read);
  useEffect(() => {
    const update = () => setName(read());
    window.addEventListener("app-preferences-changed", update);
    return () => window.removeEventListener("app-preferences-changed", update);
  }, [read]);
  return name;
}

export function searchText(file: LibraryFile) {
  return [
    file.name,
    ...file.document.pages.flatMap((page) => [
      page.name,
      ...page.nodes.map((node) => `${node.name} ${typeof node.text === "string" ? node.text : ""}`),
    ]),
  ]
    .join(" ")
    .toLowerCase();
}

export function visibleFiles(
  files: LibraryFile[],
  filter: Filter,
  folder: string | null,
  query: string,
) {
  const q = query.trim().toLowerCase();
  return files
    .filter((f) => (filter === "archived" ? f.archived : !f.archived))
    .filter((f) =>
      filter === "public" ? !!f.publication : filter === "private" ? !f.publication : true,
    )
    .filter((f) => !folder || f.folder === folder)
    .filter((f) => !q || searchText(f).includes(q))
    .sort((a, b) => b.updated - a.updated);
}

export function relativeDay(time: number) {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const days = Math.ceil((start.getTime() - time) / 86400000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  return new Date(time).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/** Class names that tests and legacy code select on (no CSS is attached to them in the island). */
export const hook = (name: string) => name;

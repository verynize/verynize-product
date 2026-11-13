// Typed view of window.versionHistory (web/version-history.js, docs/version-history.md).

export type VersionAuthor = { kind: "user" | "agent" | "collaborator" | "unknown"; name: string };
export type VersionMeta = {
  id: string;
  artboardId: string;
  pageId: string;
  name: string;
  author: VersionAuthor;
  at: number;
  reason: "switch" | "idle" | "agent" | "delete" | "restore" | "finish" | "manual";
  summary: string;
  nodes: number;
  label?: string;
};
export type VersionTarget = { kind: "native" | "local" | "room"; key: string };
export type VersionHistoryApi = {
  target(): VersionTarget;
  list(artboardId?: string | null): Promise<VersionMeta[]>;
  preview(id: string): Promise<{ id: string; artboardId: string }>;
  endPreview(): void;
  previewing(): { id: string; artboardId: string } | null;
  restore(
    id: string,
    options?: { asCopy?: boolean },
  ): Promise<{ artboardId: string; pageId: string; renamed: number }>;
  capture(
    artboardId: string,
    options?: { reason?: string; label?: string },
  ): Promise<VersionMeta[]>;
};

declare global {
  interface Window {
    versionHistory?: VersionHistoryApi;
  }
}

export const history = (): VersionHistoryApi | null => window.versionHistory ?? null;

/** Opens the panel for an artboard (the context menu sends it; anyone may). */
export const OPEN_EVENT = "bd:open-version-history";
export function openVersionHistory(artboardId: string) {
  window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: { artboardId } }));
}

export const REASON_LABEL: Record<VersionMeta["reason"], string> = {
  switch: "Before another editor",
  idle: "After a pause",
  agent: "Before agent edit",
  delete: "Before delete",
  restore: "Before restore",
  finish: "Finished by agent",
  manual: "Saved version",
};

const time = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
const day = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });
/** "Just now", "5 min ago", "3:42 PM" today, else "Nov 4, 3:42 PM". */
export function when(at: number, now = Date.now()) {
  const minutes = Math.round((now - at) / 60000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min ago`;
  const date = new Date(at);
  if (new Date(now).toDateString() === date.toDateString()) return time.format(date);
  return `${day.format(date)}, ${time.format(date)}`;
}

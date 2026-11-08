// Version history panel for one artboard (docs/version-history.md): the versions of the artboard,
// newest first, with author, time and summary; Preview shows a version on the canvas without
// changing the document, Restore replaces the artboard (one undoable edit, ordinary operations in
// shared rooms) and Restore as copy adds it as a new artboard. Opened from the artboard's context
// menu (bd:open-version-history); while open it follows the selected artboard.
import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Bot, Copy, Eye, History, RotateCcw, Save, User, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { activePage, portalContainer, useDesign, useSelection, useWindowEvent } from "@/lib/bridge";
import { cn } from "@/lib/utils";
import { history, OPEN_EVENT, REASON_LABEL, when, type VersionMeta } from "./api";

type DesignNode = { id: string; parentId?: string | null; type?: string; name?: string };

/** The artboard (top-level frame) holding the first selected layer, or null. */
function selectedArtboard(nodes: DesignNode[], selection: string[]) {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  let node = byId.get(selection[0] ?? "");
  for (let guard = 0; node?.parentId && guard < 500; guard++) node = byId.get(node.parentId);
  return node && !node.parentId && node.type === "frame" ? node.id : null;
}

const roomRole = () =>
  (window as unknown as { cloudWorkspace?: { role?(): string | null } }).cloudWorkspace?.role?.() ??
  null;

function IconAction({
  label,
  onClick,
  disabled,
  children,
  ...data
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
  [key: `data-${string}`]: string | undefined;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={label}
          disabled={disabled}
          onClick={onClick}
          {...data}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export function VersionPanel() {
  const [open, setOpen] = useState(false);
  const [artboardId, setArtboardId] = useState<string | null>(null);
  const [versions, setVersions] = useState<VersionMeta[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [previewing, setPreviewing] = useState(() => history()?.previewing() ?? null);
  const doc = useDesign();
  const selection = useSelection();
  const nodes = (activePage(doc)?.nodes ?? []) as DesignNode[];

  useWindowEvent(
    OPEN_EVENT,
    useCallback((event: Event) => {
      const id = (event as CustomEvent<{ artboardId?: string }>).detail?.artboardId;
      if (typeof id !== "string") return;
      setArtboardId(id);
      setOpen(true);
    }, []),
  );
  // While open, selecting another artboard shows its history.
  const selected = selectedArtboard(nodes, selection);
  useEffect(() => {
    if (open && selected) setArtboardId(selected);
  }, [open, selected]);

  const load = useCallback(async () => {
    const api = history();
    if (!api || !artboardId) return;
    try {
      setVersions(await api.list(artboardId));
      setError("");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    }
  }, [artboardId]);
  useEffect(() => {
    if (!open) return;
    setVersions(null);
    void load();
  }, [open, load]);
  useWindowEvent(
    "verynize:versions-changed",
    useCallback(
      (event: Event) => {
        const ids = (event as CustomEvent<{ artboardIds?: string[] }>).detail?.artboardIds ?? [];
        if (open && artboardId && ids.includes(artboardId)) void load();
      },
      [open, artboardId, load],
    ),
  );
  useWindowEvent(
    "verynize:version-preview",
    useCallback((event: Event) => {
      setPreviewing((event as CustomEvent<{ id: string; artboardId: string } | null>).detail);
    }, []),
  );
  // Shared rooms capture other people's versions on the server: refresh while open.
  useEffect(() => {
    if (!open || history()?.target().kind !== "room") return;
    const timer = setInterval(() => void load(), 5000);
    return () => clearInterval(timer);
  }, [open, load]);

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await action();
      setError("");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  };
  const close = () => {
    history()?.endPreview();
    setOpen(false);
  };
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && history()?.previewing()) history()?.endPreview();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (!open || !artboardId) return null;
  const api = history();
  const live = nodes.find((node) => node.id === artboardId);
  const exists =
    live || doc.pages?.some((page) => page.nodes?.some((node) => node.id === artboardId));
  const name = live?.name || versions?.[0]?.name || "Artboard";
  const room = api?.target().kind === "room";
  const canEdit = !room || ["editor", "owner"].includes(roomRole() ?? "");
  const restore = (id: string, asCopy = false) =>
    run(async () => {
      await api?.restore(id, { asCopy });
      await load();
    });
  const previewed = previewing?.artboardId === artboardId ? previewing.id : null;
  const previewMeta = versions?.find((version) => version.id === previewed) ?? null;

  return createPortal(
    <section
      id="version-history"
      role="dialog"
      aria-label={`Version history of ${name}`}
      data-artboard={artboardId}
      data-target={api?.target().kind}
      className="fixed top-history-top right-history-inset z-50 flex max-h-history-height w-history-panel flex-col overflow-hidden rounded-2xl border border-edge bg-popover text-popover-foreground shadow-menu"
    >
      <header className="flex h-10 shrink-0 items-center gap-2 border-b border-edge pr-1.5 pl-3">
        <History className="size-4 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <div className="text-xs font-medium">Version history</div>
          <div className="truncate text-xs text-muted-foreground" title={name}>
            {name}
            {exists ? "" : " (deleted)"}
          </div>
        </div>
        {exists && canEdit && (
          <IconAction
            label="Save version"
            data-version-save=""
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await api?.capture(artboardId, { reason: "manual", label: "Saved version" });
                await load();
              })
            }
          >
            <Save className="size-4" />
          </IconAction>
        )}
        <IconAction label="Close version history" data-version-close="" onClick={close}>
          <X className="size-4" />
        </IconAction>
      </header>
      {previewed && (
        <div
          id="version-preview-banner"
          data-version={previewed}
          className="flex shrink-0 flex-col gap-2 border-b border-edge bg-accent px-3 py-2"
        >
          <div className="text-xs">
            Previewing {previewMeta ? when(previewMeta.at) : "a version"} on the canvas. Nothing has
            changed yet.
          </div>
          <div className="flex gap-1.5">
            <Button
              id="version-preview-restore"
              size="sm"
              disabled={busy || !canEdit}
              onClick={() => void restore(previewed)}
            >
              Restore
            </Button>
            <Button
              id="version-preview-exit"
              size="sm"
              variant="outline"
              onClick={() => api?.endPreview()}
            >
              Exit preview
            </Button>
          </div>
        </div>
      )}
      <ol className="min-h-0 flex-1 overflow-y-auto py-1" aria-label="Versions">
        {versions === null && <li className="px-3 py-2 text-xs text-muted-foreground">Loading…</li>}
        {versions?.length === 0 && (
          <li id="version-history-empty" className="px-3 py-2 text-xs text-muted-foreground">
            No versions yet. A version is saved when someone else (or an agent) starts editing this
            artboard, after two minutes without edits, and before every restore.
          </li>
        )}
        {versions?.map((version) => (
          <li
            key={version.id}
            data-version={version.id}
            data-reason={version.reason}
            data-author-kind={version.author.kind}
            className={cn(
              "group flex items-start gap-2 px-3 py-1.5 hover:bg-muted",
              previewed === version.id && "bg-muted",
            )}
          >
            {version.author.kind === "agent" ? (
              <Bot className="mt-0.5 size-3.5 text-muted-foreground" />
            ) : (
              <User className="mt-0.5 size-3.5 text-muted-foreground" />
            )}
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-1.5 text-xs">
                <span className="truncate font-medium" data-version-author="">
                  {version.author.name}
                </span>
                <span className="shrink-0 text-muted-foreground">{when(version.at)}</span>
              </div>
              <div className="truncate text-xs text-muted-foreground">
                {version.label && version.reason === "manual"
                  ? version.label
                  : REASON_LABEL[version.reason]}{" "}
                · {version.summary}
              </div>
            </div>
            <div className="flex shrink-0 gap-0.5 opacity-70 group-hover:opacity-100">
              <IconAction
                label="Preview version"
                data-version-preview={version.id}
                disabled={busy}
                onClick={() => void run(() => api!.preview(version.id))}
              >
                <Eye className="size-4" />
              </IconAction>
              <IconAction
                label="Restore version"
                data-version-restore={version.id}
                disabled={busy || !canEdit}
                onClick={() => void restore(version.id)}
              >
                <RotateCcw className="size-4" />
              </IconAction>
              <IconAction
                label="Restore as copy"
                data-version-restore-copy={version.id}
                disabled={busy || !canEdit}
                onClick={() => void restore(version.id, true)}
              >
                <Copy className="size-4" />
              </IconAction>
            </div>
          </li>
        ))}
      </ol>
      {error && (
        <p
          id="version-history-error"
          role="alert"
          className="shrink-0 border-t border-edge px-3 py-2 text-xs text-destructive"
        >
          {error}
        </p>
      )}
      {room && !canEdit && (
        <p className="shrink-0 border-t border-edge px-3 py-2 text-xs text-muted-foreground">
          You can preview versions. Editors can restore them.
        </p>
      )}
    </section>,
    portalContainer(),
  );
}

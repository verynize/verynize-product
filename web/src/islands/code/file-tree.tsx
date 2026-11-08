// File tree of the active chat's folder (its worktree, else the repository root): "All files / All changes /
// Uncommitted" filter (all changes = the branch since it left the default branch, commits included), expandable folders, file-type icons and change markers. Clicking a file opens it in the editor.
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BracesIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  FileCodeIcon,
  FileIcon,
  FileImageIcon,
  FileTextIcon,
  FolderIcon,
  FolderOpenIcon,
  GitBranchIcon,
  RefreshCwIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  ChatMenu,
  ChatMenuContent,
  ChatMenuRadioGroup,
  ChatMenuRadioItem,
  ChatMenuTrigger,
} from "../chat/menu";
import { desktop, errorMessage, type ChangedFile, type ProjectFile } from "./api";
import { openFile, useOpenFile } from "./editor-state";

type Node = { name: string; path: string; dir: boolean; children: Node[] };

function buildTree(paths: string[]): Node[] {
  const root: Node = { name: "", path: "", dir: true, children: [] };
  for (const full of paths) {
    const parts = full.split("/");
    let node = root;
    parts.forEach((part, i) => {
      const dir = i < parts.length - 1;
      const path = parts.slice(0, i + 1).join("/");
      let child = node.children.find((c) => c.name === part && c.dir === dir);
      if (!child) {
        child = { name: part, path, dir, children: [] };
        node.children.push(child);
      }
      node = child;
    });
  }
  const sort = (nodes: Node[]) => {
    nodes.sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name) : a.dir ? -1 : 1));
    nodes.forEach((n) => sort(n.children));
  };
  sort(root.children);
  return root.children;
}

function FileGlyph({ name }: { name: string }) {
  const ext = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1).toLowerCase() : "";
  if (name === ".gitignore" || name === ".gitattributes")
    return <GitBranchIcon className="size-3.5 shrink-0 text-file-git" />;
  if (["html", "htm"].includes(ext))
    return <FileCodeIcon className="size-3.5 shrink-0 text-file-html" />;
  if (["css", "scss", "less"].includes(ext))
    return <FileCodeIcon className="size-3.5 shrink-0 text-file-css" />;
  if (["js", "mjs", "cjs", "jsx", "ts", "tsx"].includes(ext))
    return <FileCodeIcon className="size-3.5 shrink-0 text-file-js" />;
  if (["json", "jsonc", "yaml", "yml", "toml"].includes(ext))
    return <BracesIcon className="size-3.5 shrink-0 text-file-json" />;
  if (["md", "mdx", "txt"].includes(ext))
    return <FileTextIcon className="size-3.5 shrink-0 text-file-md" />;
  if (["png", "jpg", "jpeg", "gif", "webp", "svg", "ico"].includes(ext))
    return <FileImageIcon className="size-3.5 shrink-0 text-file-image" />;
  return <FileIcon className="size-3.5 shrink-0 text-muted-foreground" />;
}

const MARK: Record<string, { letter: string; className: string; label: string }> = {
  added: { letter: "A", className: "text-file-added", label: "Added" },
  untracked: { letter: "U", className: "text-file-added", label: "Untracked" },
  modified: { letter: "M", className: "text-file-modified", label: "Modified" },
  deleted: { letter: "D", className: "text-file-deleted", label: "Deleted" },
  conflicted: { letter: "C", className: "text-file-deleted", label: "Conflicted" },
};

/** Files + git changes of `root` (the main process's active project), reloaded when files change. */
function useProjectFiles(root: string | null) {
  const [files, setFiles] = useState<ProjectFile[]>([]);
  const [changes, setChanges] = useState<ChangedFile[]>([]);
  const [branchChanges, setBranchChanges] = useState<ChangedFile[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const load = useCallback(async () => {
    const api = desktop();
    if (!root || !api?.listFiles) {
      setFiles([]);
      setChanges([]);
      setBranchChanges([]);
      return;
    }
    setLoading(true);
    try {
      const [list, git, branch] = await Promise.all([
        api.listFiles(),
        api.gitChanges?.({ root }).catch(() => null),
        api.gitBranchChanges?.({ root }).catch(() => null),
      ]);
      setFiles(list);
      setChanges(git?.files ?? []);
      setBranchChanges(branch?.files ?? git?.files ?? []);
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [root]);
  useEffect(() => {
    setFiles([]);
    setChanges([]);
    setBranchChanges([]);
    void load();
    let timer = 0;
    const later = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => void load(), 250);
    };
    window.addEventListener("code-files-changed", later);
    window.addEventListener("focus", later);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("code-files-changed", later);
      window.removeEventListener("focus", later);
    };
  }, [load]);
  return { files, changes, branchChanges, error, loading, reload: load };
}

type Filter = "all" | "branch" | "uncommitted";
const FILTERS: { value: Filter; label: string }[] = [
  { value: "all", label: "All files" },
  { value: "branch", label: "All changes" },
  { value: "uncommitted", label: "Uncommitted" },
];

export function FileTree({ root }: { root: string | null }) {
  const { files, changes, branchChanges, error, loading, reload } = useProjectFiles(root);
  const [filter, setFilter] = useState<Filter>("all");
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const open = useOpenFile();
  useEffect(() => setExpanded(new Set()), [root]);

  // Markers show what changed on the branch (the uncommitted view shows only uncommitted changes).
  const shown = filter === "uncommitted" ? changes : branchChanges;
  const changed = useMemo(() => new Map(shown.map((c) => [c.path, c.status])), [shown]);
  const tree = useMemo(() => {
    const paths =
      filter === "all"
        ? files.map((f) => f.path)
        : shown.filter((c) => c.status !== "deleted").map((c) => c.path);
    return buildTree(paths);
  }, [files, shown, filter]);
  const counts: Record<Filter, number | null> = {
    all: null,
    branch: branchChanges.length,
    uncommitted: changes.length,
  };
  const label = FILTERS.find((f) => f.value === filter)?.label ?? "All files";
  // Folders holding changes are marked too.
  const changedDirs = useMemo(() => {
    const dirs = new Set<string>();
    for (const path of changed.keys())
      path
        .split("/")
        .slice(0, -1)
        .forEach((_, i, parts) => dirs.add(parts.slice(0, i + 1).join("/")));
    return dirs;
  }, [changed]);

  const toggle = (path: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  const renderNodes = (nodes: Node[], depth: number) =>
    nodes.map((node) => {
      const isOpen = filter !== "all" || expanded.has(node.path);
      const mark = node.dir ? null : MARK[changed.get(node.path) ?? ""];
      return (
        <li
          key={(node.dir ? "d:" : "f:") + node.path}
          role="treeitem"
          aria-expanded={node.dir ? isOpen : undefined}
          aria-selected={!node.dir && open?.kind === "file" && open.path === node.path}
        >
          <button
            type="button"
            data-path={node.path}
            data-kind={node.dir ? "folder" : "file"}
            onClick={() => (node.dir ? toggle(node.path) : void openFile(node.path))}
            className={cn(
              "flex h-7.5 w-full min-w-0 items-center gap-2 rounded-md pr-2 text-sm text-foreground-2 outline-none hover:bg-muted focus-visible:ring-1 focus-visible:ring-ring",
              depth === 0 && "pl-2",
              depth === 1 && "pl-6",
              depth === 2 && "pl-10",
              depth === 3 && "pl-14",
              depth >= 4 && "pl-18",
              !node.dir &&
                open?.kind === "file" &&
                open.path === node.path &&
                "bg-input text-foreground hover:bg-input",
            )}
          >
            {node.dir ? (
              <>
                {isOpen ? (
                  <ChevronDownIcon className="size-3 shrink-0 text-muted-foreground" />
                ) : (
                  <ChevronRightIcon className="size-3 shrink-0 text-muted-foreground" />
                )}
                {isOpen ? (
                  <FolderOpenIcon className="size-3.5 shrink-0 text-muted-foreground" />
                ) : (
                  <FolderIcon className="size-3.5 shrink-0 text-muted-foreground" />
                )}
              </>
            ) : (
              <>
                <span className="size-3 shrink-0" />
                <FileGlyph name={node.name} />
              </>
            )}
            <span
              className={cn(
                "min-w-0 flex-1 truncate text-left",
                mark && mark.className,
                node.dir && changedDirs.has(node.path) && "text-file-modified",
              )}
            >
              {node.name}
            </span>
            {mark && (
              <span
                title={mark.label}
                aria-label={mark.label}
                className={cn("shrink-0 text-2xs font-medium", mark.className)}
              >
                {mark.letter}
              </span>
            )}
          </button>
          {node.dir && isOpen && node.children.length > 0 && (
            <ul role="group" className="m-0 list-none p-0">
              {renderNodes(node.children, depth + 1)}
            </ul>
          )}
        </li>
      );
    });

  return (
    <section aria-label="Files" id="code-files" className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-9.5 shrink-0 items-center gap-1 border-b border-border px-2">
        <ChatMenu modal={false}>
          <ChatMenuTrigger
            id="code-file-filter"
            className="flex h-6.5 items-center gap-1.5 rounded-md px-2 text-sm text-foreground-2 outline-none hover:bg-muted focus-visible:ring-1 focus-visible:ring-ring data-[state=open]:bg-muted"
          >
            {label}
            <ChevronDownIcon className="size-3 text-muted-foreground" />
          </ChatMenuTrigger>
          <ChatMenuContent align="start" className="w-44">
            <ChatMenuRadioGroup
              value={filter}
              onValueChange={(value) =>
                setFilter(FILTERS.find((f) => f.value === value)?.value ?? "all")
              }
            >
              {FILTERS.map(({ value, label: name }) => (
                <ChatMenuRadioItem key={value} value={value}>
                  <span className="flex-1">{name}</span>
                  {/* The count column stays put whether or not the row carries the check (14px icon + 8px gap). */}
                  {counts[value] !== null && (
                    <span
                      className={cn(
                        "text-muted-foreground tabular-nums",
                        filter !== value && "mr-5.5",
                      )}
                    >
                      {counts[value]}
                    </span>
                  )}
                </ChatMenuRadioItem>
              ))}
            </ChatMenuRadioGroup>
          </ChatMenuContent>
        </ChatMenu>
        <span className="flex-1" />
        <button
          type="button"
          aria-label="Refresh files"
          title="Refresh files"
          onClick={() => void reload()}
          className="flex size-6 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-muted hover:text-foreground-2 focus-visible:ring-1 focus-visible:ring-ring"
        >
          <RefreshCwIcon
            className={cn("size-3.5", loading && "animate-spin motion-reduce:animate-none")}
          />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 py-1">
        {!root ? (
          <p className="px-2 py-2 text-xs text-subtle-foreground">
            Quick chats run in a private scratch folder. Open a repository chat to browse its files.
          </p>
        ) : error ? (
          <p role="alert" className="px-2 py-2 text-xs text-destructive">
            {error}
          </p>
        ) : tree.length ? (
          <ul
            role="tree"
            aria-label={label}
            id="code-file-tree"
            data-root={root}
            className="m-0 list-none p-0"
          >
            {renderNodes(tree, 0)}
          </ul>
        ) : (
          !loading && (
            <p className="px-2 py-2 text-xs text-subtle-foreground">
              {filter === "all"
                ? "No files."
                : filter === "branch"
                  ? "No changes on this branch yet."
                  : "No uncommitted changes."}
            </p>
          )
        )}
      </div>
    </section>
  );
}

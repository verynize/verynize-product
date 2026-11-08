// Settings › Projects: every registered project with history-preserving moves (desktop/repository-moves.cjs),
// and the global search dialog (desktop/project-search.cjs) that searches all of them at once.
// Open the search with ⌘⇧F, the "Search all projects" button, or `bd:open-global-search`.
import { useCallback, useEffect, useRef, useState } from "react";
import {
  FileCodeIcon,
  FolderInputIcon,
  FolderOpenIcon,
  LayersIcon,
  SearchIcon,
} from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useWindowEvent } from "@/lib/bridge";
import {
  Card,
  NativeSelect,
  PageHeader,
  Row,
  Section,
  SettingsButton,
  TextField,
} from "./controls";
import {
  desktopApi,
  errorText,
  migrateChatStorage,
  type MoveResult,
  type Repository,
  type SearchResult,
} from "./workspace-ipc";

type CodeWorkspace = {
  openFile?(root: string, path: string, line?: number): Promise<unknown> | void;
  refresh?(): unknown;
};
const codeWorkspace = () => (window as unknown as { codeWorkspace?: CodeWorkspace }).codeWorkspace;

/** Keep chats and the Code workspace in step with a move. */
function afterMove(result: MoveResult) {
  if (result.moved?.length) migrateChatStorage(result.moved);
  void codeWorkspace()?.refresh?.();
}

function RepositoryRow({
  repo,
  repos,
  onChanged,
}: {
  repo: Repository;
  repos: Repository[];
  onChanged: () => void;
}) {
  const api = desktopApi()?.repositoryMoves;
  const [mode, setMode] = useState<"" | "rename" | "inside" | "across">("");
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const [target, setTarget] = useState("");
  const [strategy, setStrategy] = useState<"patches" | "subtree">("patches");
  const [busy, setBusy] = useState(false);
  const run = async (task: () => Promise<MoveResult> | undefined, done: string) => {
    setBusy(true);
    try {
      const result = await task();
      if (result) afterMove(result);
      toast(done);
      setMode("");
      setA("");
      setB("");
      onChanged();
    } catch (error) {
      toast(errorText(error));
    } finally {
      setBusy(false);
    }
  };
  const others = repos.filter((r) => r.id !== repo.id && r.git !== false);
  return (
    <div data-project={repo.name} className="flex flex-col">
      <Row
        title={repo.name}
        description={<span className="block truncate font-mono text-xs">{repo.root}</span>}
      >
        <SettingsButton
          variant="ghost"
          data-action="rename"
          onClick={() => {
            setMode(mode === "rename" ? "" : "rename");
            setA(repo.name);
          }}
        >
          Rename
        </SettingsButton>
        <SettingsButton
          variant="ghost"
          data-action="relocate"
          onClick={async () => {
            const parent = await api?.chooseDestination();
            if (parent)
              void run(
                () =>
                  api?.relocate({
                    repoId: repo.id,
                    destination: `${parent}/${repo.root.split("/").pop()}`,
                  }),
                `Moved ${repo.name}`,
              );
          }}
        >
          <FolderInputIcon />
          Move…
        </SettingsButton>
        {repo.git !== false && (
          <>
            <SettingsButton
              variant="ghost"
              data-action="move-inside"
              onClick={() => setMode(mode === "inside" ? "" : "inside")}
            >
              Move a path
            </SettingsButton>
            {others.length > 0 && (
              <SettingsButton
                variant="ghost"
                data-action="move-across"
                onClick={() => {
                  setMode(mode === "across" ? "" : "across");
                  setTarget(others[0].id);
                }}
              >
                Move to another project
              </SettingsButton>
            )}
          </>
        )}
      </Row>
      {mode && (
        <form
          className="flex flex-wrap items-center gap-2 pb-3.5"
          onSubmit={(event) => {
            event.preventDefault();
            if (mode === "rename")
              void run(() => api?.relocate({ repoId: repo.id, name: a }), `Renamed to ${a}`);
            if (mode === "inside")
              void run(
                () => api?.moveInside({ repoId: repo.id, from: a, to: b }),
                `Moved ${a} to ${b} (committed)`,
              );
            if (mode === "across")
              void run(
                () =>
                  api?.moveAcross({
                    sourceRepoId: repo.id,
                    path: a,
                    targetRepoId: target,
                    to: b || a,
                    strategy,
                  }),
                `Moved ${a} with its history`,
              );
          }}
        >
          {mode === "rename" ? (
            <TextField
              name="projectName"
              aria-label="New folder name"
              className="flex-1"
              value={a}
              onChange={(e) => setA(e.target.value)}
            />
          ) : (
            <>
              <TextField
                name="movePath"
                aria-label="Path to move"
                placeholder="src/components"
                className="flex-1"
                value={a}
                onChange={(e) => setA(e.target.value)}
              />
              {mode === "across" && (
                <NativeSelect
                  name="moveTarget"
                  aria-label="Target project"
                  value={target}
                  onChange={(e) => setTarget(e.target.value)}
                >
                  {others.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </NativeSelect>
              )}
              <TextField
                name="moveDestination"
                aria-label="Destination path"
                placeholder={mode === "across" ? "Same path" : "lib/components"}
                className="flex-1"
                value={b}
                onChange={(e) => setB(e.target.value)}
              />
              {mode === "across" && (
                <NativeSelect
                  name="moveStrategy"
                  aria-label="History method"
                  value={strategy}
                  onChange={(e) => setStrategy(e.target.value as "patches" | "subtree")}
                >
                  <option value="patches">Replay commits (files or folders)</option>
                  <option value="subtree">Subtree merge (folders)</option>
                </NativeSelect>
              )}
            </>
          )}
          <SettingsButton
            type="submit"
            variant="primary"
            data-action="confirm-move"
            disabled={busy || !a.trim() || (mode === "inside" && !b.trim())}
          >
            {busy ? "Working…" : mode === "rename" ? "Rename" : "Move"}
          </SettingsButton>
        </form>
      )}
    </div>
  );
}

export function ProjectsPage() {
  const api = desktopApi();
  const [repos, setRepos] = useState<Repository[] | null>(null);
  const reload = useCallback(() => {
    api?.repositories?.list().then(
      (v) => setRepos(v.repositories),
      () => setRepos([]),
    );
  }, [api]);
  useEffect(reload, [reload]);
  return (
    <>
      <PageHeader
        title="Projects"
        description="Rename or move projects, or move folders inside and between them. Every move is a git commit, so file history follows."
        action={
          <SettingsButton
            id="projects-search-open"
            onClick={() => window.dispatchEvent(new CustomEvent("bd:open-global-search"))}
          >
            <SearchIcon />
            Search all projects
          </SettingsButton>
        }
      />
      <Section
        id="projects-list"
        title="Registered projects"
        description="Projects stay registered after a move; their chats and worktrees move with them."
      >
        <Card id="projects-list-card">
          {!api?.repositories ? (
            <Row title="Available in the desktop app" />
          ) : repos && !repos.length ? (
            <Row
              title="No projects yet"
              description="Add a repository in the Code workspace first."
            />
          ) : (
            (repos ?? []).map((repo) => (
              <RepositoryRow key={repo.id} repo={repo} repos={repos ?? []} onChanged={reload} />
            ))
          )}
        </Card>
      </Section>
    </>
  );
}

/** ⌘⇧F: search source files and design documents in every registered project. */
export function GlobalSearchDialog() {
  const api = desktopApi()?.projectSearch;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [regex, setRegex] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [result, setResult] = useState<SearchResult | null>(null);
  const [busy, setBusy] = useState(false);
  const seq = useRef(0);
  useWindowEvent("bd:open-global-search", () => setOpen(true));
  useWindowEvent("keydown", (raw: Event) => {
    const event = raw as KeyboardEvent;
    if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === "f") {
      event.preventDefault();
      setOpen(true);
    }
  });
  const search = async () => {
    if (!api || !query.trim()) return;
    const id = ++seq.current;
    setBusy(true);
    try {
      const value = await api.search({ query, regex, caseSensitive });
      if (id === seq.current) setResult(value);
    } catch (error) {
      if (id === seq.current) toast(errorText(error));
    } finally {
      if (id === seq.current) setBusy(false);
    }
  };
  const openHit = async (root: string, path: string, line?: number) => {
    try {
      const code = codeWorkspace();
      if (code?.openFile) {
        await code.openFile(root, path, line);
        setOpen(false);
      } else await api?.open({ root, path });
    } catch (error) {
      toast(errorText(error));
    }
  };
  const groups = new Map<string, SearchResult["results"]>();
  for (const hit of result?.results ?? [])
    groups.set(hit.project, [...(groups.get(hit.project) ?? []), hit]);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent id="global-search" className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Search all projects</DialogTitle>
          <DialogDescription>
            Source files (honouring .gitignore) and design documents in every registered project.
          </DialogDescription>
        </DialogHeader>
        {!api ? (
          <p className="text-sm text-muted-foreground">Available in the desktop app.</p>
        ) : (
          <>
            <form
              className="flex items-center gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                void search();
              }}
            >
              <TextField
                id="global-search-input"
                aria-label="Search text"
                autoFocus
                className="flex-1"
                placeholder="Text or pattern"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <label className="flex items-center gap-1 text-xs text-muted-foreground">
                <input
                  id="global-search-regex"
                  type="checkbox"
                  checked={regex}
                  onChange={(e) => setRegex(e.target.checked)}
                />
                Regex
              </label>
              <label className="flex items-center gap-1 text-xs text-muted-foreground">
                <input
                  id="global-search-case"
                  type="checkbox"
                  checked={caseSensitive}
                  onChange={(e) => setCaseSensitive(e.target.checked)}
                />
                Match case
              </label>
              <SettingsButton
                id="global-search-run"
                type="submit"
                variant="primary"
                disabled={busy || !query.trim()}
              >
                {busy ? "Searching…" : "Search"}
              </SettingsButton>
            </form>
            <div
              id="global-search-results"
              data-engine={result?.engine ?? ""}
              data-ripgrep={result?.ripgrep ?? ""}
              className="flex max-h-96 flex-col gap-3 overflow-y-auto"
            >
              {result && !result.results.length && !result.design.length && (
                <p className="text-sm text-muted-foreground">No matches.</p>
              )}
              {[...groups].map(([project, hits]) => (
                <section key={project} data-search-project={project} className="flex flex-col">
                  <h3 className="mb-1 text-xs font-medium text-muted-foreground">
                    {project} · {hits.length} match{hits.length === 1 ? "" : "es"}
                  </h3>
                  {hits.map((hit) => (
                    <button
                      key={`${hit.path}:${hit.line}:${hit.column}`}
                      type="button"
                      data-search-hit={`${hit.path}:${hit.line}`}
                      className="flex items-start gap-2 rounded-md px-2 py-1 text-left text-sm hover:bg-muted"
                      onClick={() => void openHit(hit.root, hit.path, hit.line)}
                    >
                      <FileCodeIcon className="mt-0.5 size-3.5 text-subtle-foreground" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-foreground">
                          {hit.path}
                          <span className="text-subtle-foreground">:{hit.line}</span>
                        </span>
                        <span className="block truncate font-mono text-xs text-muted-foreground">
                          {hit.preview}
                        </span>
                      </span>
                    </button>
                  ))}
                </section>
              ))}
              {!!result?.design.length && (
                <section data-search-project="design" className="flex flex-col">
                  <h3 className="mb-1 text-xs font-medium text-muted-foreground">
                    Design documents
                  </h3>
                  {result.design.map((hit) => (
                    <button
                      key={`${hit.root}/${hit.path}#${hit.nodeId ?? hit.pageId}`}
                      type="button"
                      data-design-hit={hit.nodeId ?? hit.pageId}
                      className="flex items-start gap-2 rounded-md px-2 py-1 text-left text-sm hover:bg-muted"
                      onClick={() =>
                        void api
                          .open({ root: hit.root, path: hit.path, reveal: true })
                          .catch((e: unknown) => toast(errorText(e)))
                      }
                    >
                      <LayersIcon className="mt-0.5 size-3.5 text-subtle-foreground" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-foreground">
                          {hit.name}{" "}
                          <span className="text-subtle-foreground">
                            · {hit.page} · {hit.project}/{hit.path}
                          </span>
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {hit.match}
                        </span>
                      </span>
                      <FolderOpenIcon
                        className="mt-0.5 size-3.5 text-subtle-foreground"
                        aria-label="Reveal in Finder"
                      />
                    </button>
                  ))}
                </section>
              )}
              {result?.truncated && (
                <p className="text-xs text-subtle-foreground">
                  Showing the first matches only. Narrow the search to see more.
                </p>
              )}
              {result?.errors.map((e) => (
                <p key={e.project} className="text-xs text-destructive">
                  {e.project}: {e.error}
                </p>
              ))}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

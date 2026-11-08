// Changes panel (design → code loop): what the project's agent changed, reviewed as unified diffs, then committed,
// pushed and opened as a GitHub pull request with the user's own git and gh. Lives in the dock header's second row.
import { useEffect, useMemo, useState } from "react";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CheckIcon,
  ExternalLinkIcon,
  FileDiffIcon,
  GitBranchIcon,
  GitCommitHorizontalIcon,
  GitPullRequestIcon,
  RefreshCwIcon,
  SparklesIcon,
  Undo2Icon,
  UploadIcon,
  XIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { errorText, gitApi, presetImplementPrompt, suggestMessage, useChanges, type ChangedFile, type ChangesSummary, type FileDiff, type PullRequestStatus } from "./changes";
import { usePreference } from "../settings/preference-store";
import { ChatHeaderButton, ChatRowButton } from "./controls";
import type { ChatState } from "./store";

const MAX_RENDERED_LINES = 5000;
const NO_FILES: ChangedFile[] = [];

type LineKind = "add" | "remove" | "hunk" | "meta" | "context";
function diffLines(diff: string): { kind: LineKind; text: string }[] {
  const lines = diff.split("\n");
  if (lines.at(-1) === "") lines.pop();
  let inHunk = false;
  return lines.map((text) => {
    if (text.startsWith("@@")) {
      inHunk = true;
      return { kind: "hunk", text };
    }
    if (!inHunk || text.startsWith("\\")) return { kind: "meta", text };
    if (text.startsWith("+")) return { kind: "add", text };
    if (text.startsWith("-")) return { kind: "remove", text };
    return { kind: "context", text };
  });
}

/** "owner/repo" for GitHub remotes, otherwise the sanitized remote URL. */
function remoteLabel(summary: ChangesSummary): string | null {
  if (!summary.remoteUrl) return null;
  const match = /github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?$/.exec(summary.remoteUrl);
  return match ? match[1] : summary.remoteUrl;
}

function Counts({ added, removed, className }: { added: number; removed: number; className?: string }) {
  return (
    <span className={cn("flex shrink-0 items-center gap-1 tabular-nums", className)}>
      <span className="text-diff-add">+{added}</span>
      <span className="text-diff-remove">−{removed}</span>
    </span>
  );
}

function StatusCode({ file }: { file: ChangedFile }) {
  return (
    <span
      title={file.status}
      className={cn(
        "w-3 shrink-0 text-center font-mono text-2xs",
        (file.status === "added" || file.status === "untracked") && "text-diff-add",
        file.status === "deleted" && "text-diff-remove",
        file.status === "modified" && "text-primary-text",
        file.status === "conflicted" && "text-destructive",
      )}
    >
      {file.code === "?" ? "U" : file.code}
    </span>
  );
}

function FileRow({
  file,
  active,
  canDiscard,
  confirming,
  onSelect,
  onDiscard,
  onConfirm,
  onCancel,
}: {
  file: ChangedFile;
  active: boolean;
  canDiscard: boolean;
  confirming: boolean;
  onSelect: () => void;
  onDiscard: () => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const slash = file.path.lastIndexOf("/");
  const name = file.path.slice(slash + 1);
  const dir = slash >= 0 ? file.path.slice(0, slash) : "";
  return (
    <li className={cn("group flex h-7 items-center gap-1.5 rounded-md pr-1 pl-2", active ? "bg-row" : "hover:bg-muted")}>
      <ChatRowButton density="file" data-changes="file" data-path={file.path} className="min-w-0 flex-1" onClick={onSelect}>
        <StatusCode file={file} />
        <span className="min-w-0 truncate text-foreground-2">{name}</span>
        {dir && <span className="min-w-0 shrink truncate text-subtle-foreground">{dir}</span>}
      </ChatRowButton>
      {confirming ? (
        <span className="flex shrink-0 items-center gap-1">
          <Button size="xs" variant="destructive" data-changes="discard-confirm" onClick={onConfirm}>
            Discard
          </Button>
          <Button size="icon-xs" variant="ghost" aria-label="Keep changes" onClick={onCancel}>
            <XIcon />
          </Button>
        </span>
      ) : (
        <>
          {file.binary ? <span className="shrink-0 text-subtle-foreground">binary</span> : <Counts added={file.added} removed={file.removed} />}
          {canDiscard && (
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label={`Discard changes to ${file.path}`}
              title="Discard changes"
              data-changes="discard"
              className="invisible group-hover:visible focus-visible:visible"
              onClick={onDiscard}
            >
              <Undo2Icon />
            </Button>
          )}
        </>
      )}
    </li>
  );
}

function DiffView({ diff, loading, error }: { diff: FileDiff | null; loading: boolean; error: string | null }) {
  const lines = useMemo(() => (diff ? diffLines(diff.diff) : []), [diff]);
  if (error) return <p className="p-4 text-destructive">{error}</p>;
  if (!diff) return <p className="p-4 text-muted-foreground">{loading ? "Loading diff…" : "Select a file to see its changes."}</p>;
  if (diff.binary) return <p className="p-4 text-muted-foreground">Binary file changed; no text diff to show.</p>;
  if (!lines.length) return <p className="p-4 text-muted-foreground">No textual changes (mode or whitespace only).</p>;
  const shown = lines.slice(0, MAX_RENDERED_LINES);
  return (
    <div id="changes-diff" className="min-w-max py-1 font-mono text-2xs">
      {shown.map((line, index) => (
        <div
          key={index}
          data-kind={line.kind}
          className={cn(
            "px-3 whitespace-pre",
            line.kind === "add" && "bg-diff-add-bg text-diff-add",
            line.kind === "remove" && "bg-diff-remove-bg text-diff-remove",
            line.kind === "hunk" && "mt-1 bg-muted text-muted-foreground",
            line.kind === "meta" && "text-subtle-foreground",
            line.kind === "context" && "text-foreground-3",
          )}
        >
          {line.text || " "}
        </div>
      ))}
      {(diff.truncated || lines.length > shown.length) && (
        <p className="px-3 py-2 font-sans text-xs text-muted-foreground">Diff truncated: the file has more changes than can be shown here.</p>
      )}
    </div>
  );
}

function PullRequestLink({ status }: { status: PullRequestStatus | null }) {
  if (!status) return null;
  if (status.pr) {
    const pr = status.pr;
    return (
      <Button
        variant="link"
        size="xs"
        id="changes-pr-link"
        className="min-w-0"
        title={pr.url}
        onClick={() => void gitApi()?.openExternal(pr.url)}
      >
        <GitPullRequestIcon className="size-3.5 shrink-0" />
        <span className="truncate">
          #{pr.number} {pr.isDraft ? "Draft" : pr.state.charAt(0) + pr.state.slice(1).toLowerCase()}
        </span>
        <ExternalLinkIcon className="size-3 shrink-0" />
      </Button>
    );
  }
  if (status.gh !== "ready" && status.message) return <span className="truncate text-subtle-foreground">{status.message}</span>;
  return null;
}

function ChangesDialog({
  open,
  onOpenChange,
  state,
  root,
  summary,
  refresh,
  setSummary,
  running,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  state: ChatState;
  root: string;
  summary: ChangesSummary | null;
  refresh: () => Promise<ChangesSummary | null>;
  setSummary: (summary: ChangesSummary) => void;
  running: boolean;
}) {
  const api = gitApi();
  const [selected, setSelected] = useState<string | null>(null);
  const [diff, setDiff] = useState<FileDiff | null>(null);
  const [diffError, setDiffError] = useState<string | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [confirming, setConfirming] = useState<string | null>(null);
  const [working, setWorking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pr, setPr] = useState<PullRequestStatus | null>(null);
  const files = summary?.files ?? NO_FILES;

  // Opening: refresh, suggest a commit message from the latest request, read the branch's pull request.
  useEffect(() => {
    if (!open || !api) return;
    setError(null);
    setNotice(null);
    setConfirming(null);
    setMessage((current) => current || suggestMessage(state.messages));
    void refresh();
    api.gitPullRequest({ root }).then(setPr, () => setPr(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once per opening
  }, [open, root]);

  // Keep a valid selection: the previous file while it is still changed, else the first one.
  useEffect(() => {
    if (!open) return;
    if (!files.length) setSelected(null);
    else if (!selected || !files.some((f) => f.path === selected)) setSelected(files[0].path);
  }, [open, files, selected]);

  useEffect(() => {
    if (!open || !api || !selected) {
      setDiff(null);
      setDiffError(null);
      return;
    }
    let live = true;
    setDiffLoading(true);
    setDiffError(null);
    api
      .gitDiff({ root, file: selected })
      .then((value) => live && setDiff(value))
      .catch((failure) => {
        if (!live) return;
        setDiff(null);
        setDiffError(errorText(failure));
      })
      .finally(() => live && setDiffLoading(false));
    return () => {
      live = false;
    };
    // Reload when the summary changes (an agent edit or a discard may have changed the selected file).
  }, [open, api, root, selected, summary]);

  const act = async (label: string, task: () => Promise<string | void>) => {
    setWorking(label);
    setError(null);
    setNotice(null);
    try {
      const done = await task();
      if (done) setNotice(done);
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setWorking(null);
      await refresh();
    }
  };

  if (!api) return null;
  const hasFiles = files.length > 0;
  const unpublished = !!summary && !summary.detached && !!summary.head && !summary.upstream;
  const canPush = !!summary?.remote && !summary.detached && !!summary.head && (unpublished || summary.ahead > 0);
  const canCreatePr = !!summary?.remote && !summary.detached && !!summary.head && !hasFiles && !pr?.pr && pr?.gh !== "missing" && pr?.gh !== "unauthenticated";

  const commit = () =>
    act("commit", async () => {
      const result = await api.gitCommit({ root, message });
      setMessage("");
      return `Committed ${result.commit.slice(0, 7)} on ${result.branch ?? "detached HEAD"}`;
    });
  const push = () =>
    act("push", async () => {
      const result = await api.gitPush({ root });
      setSummary(result.summary);
      return `Pushed ${result.branch} to ${result.upstream}`;
    });
  const createPr = () =>
    act("pr", async () => {
      if (canPush) await api.gitPush({ root });
      const result = await api.gitCreatePullRequest({ root });
      const status = await api.gitPullRequest({ root }).catch(() => null);
      setPr(status ?? { gh: "ready", pr: result.pr });
      return result.existed ? "A pull request for this branch already exists" : `Opened pull request${result.pr ? " #" + result.pr.number : ""}`;
    });
  const discard = (file: string) =>
    act("discard", async () => {
      setConfirming(null);
      await api.gitDiscard({ root, file });
      return `Discarded changes to ${file}`;
    });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Standard shadcn dialog: header, a bordered file list + diff body, and a commit footer. */}
      <DialogContent
        id="changes-panel"
        aria-describedby={undefined}
        // Var syntax so tailwind-merge replaces DialogContent's max-w-lg (it does not know the theme's `changes` size).
        className="flex h-(--spacing-changes-height) max-h-full max-w-(--spacing-changes) flex-col sm:max-w-(--spacing-changes)"
      >
        <DialogHeader>
          <div className="flex min-w-0 items-center gap-3 pr-8 text-xs">
            <DialogTitle>Changes</DialogTitle>
            {summary && (
              <span className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
                <GitBranchIcon className="size-3.5 shrink-0" />
                <span id="changes-branch" className="truncate text-foreground-3">
                  {summary.branch ?? `detached at ${summary.head ?? "?"}`}
                </span>
                {summary.upstream ? (
                  <span className="flex shrink-0 items-center gap-1 tabular-nums" title={`Tracking ${summary.upstream}`}>
                    <ArrowUpIcon className="size-3" aria-label="ahead" />
                    {summary.ahead}
                    <ArrowDownIcon className="size-3" aria-label="behind" />
                    {summary.behind}
                  </span>
                ) : (
                  summary.remote && <span className="shrink-0 text-subtle-foreground">not published</span>
                )}
                {remoteLabel(summary) && <span className="min-w-0 truncate text-subtle-foreground">· {remoteLabel(summary)}</span>}
              </span>
            )}
            <PullRequestLink status={pr} />
            <span className="flex-1" />
            <Button size="icon-sm" variant="ghost" aria-label="Refresh changes" title="Refresh" onClick={() => void refresh()}>
              <RefreshCwIcon className="size-3.5" />
            </Button>
          </div>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 overflow-hidden rounded-lg border border-card-border text-xs text-foreground-2">
          <div className="flex w-changes-list shrink-0 flex-col border-r border-border">
            <div className="flex h-8 shrink-0 items-center justify-between px-3 text-muted-foreground">
              <span>
                {summary?.totals.files ?? 0} {summary?.totals.files === 1 ? "file" : "files"} changed
              </span>
              {summary && <Counts added={summary.totals.added} removed={summary.totals.removed} />}
            </div>
            <ScrollArea className="min-h-0 flex-1">
              <ul id="changes-files" className="px-1.5 pb-2">
                {files.map((file) => (
                  <FileRow
                    key={file.path}
                    file={file}
                    active={file.path === selected}
                    canDiscard={!running && !working && file.status !== "conflicted"}
                    confirming={confirming === file.path}
                    onSelect={() => setSelected(file.path)}
                    onDiscard={() => setConfirming(file.path)}
                    onConfirm={() => void discard(file.path)}
                    onCancel={() => setConfirming(null)}
                  />
                ))}
                {summary?.truncated && <li className="px-2 py-1 text-subtle-foreground">Only the first {files.length} files are listed.</li>}
              </ul>
            </ScrollArea>
            {!hasFiles && (
              <div className="flex flex-col items-start gap-2 px-3 pb-3 text-muted-foreground">
                <p>Working tree clean.</p>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    onOpenChange(false);
                    presetImplementPrompt();
                  }}
                >
                  <SparklesIcon className="size-3.5" />
                  Implement selection in code
                </Button>
              </div>
            )}
          </div>
          <div className="min-w-0 flex-1 overflow-auto bg-settings">
            <DiffView diff={selected ? diff : null} loading={diffLoading} error={diffError} />
          </div>
        </div>

        {(error || notice || running) && (
          <p
            id="changes-status"
            role={error ? "alert" : "status"}
            className={cn("-mt-1 flex items-center gap-1.5 text-xs", error ? "text-destructive" : "text-muted-foreground")}
          >
            {!error && notice && <CheckIcon className="size-3.5 shrink-0 text-diff-add" />}
            {error ?? notice ?? "The agent is still working; commit when the turn finishes."}
          </p>
        )}
        <DialogFooter className="items-end">
          <Textarea
            id="changes-message"
            aria-label="Commit message"
            placeholder="Describe the change (commit message)"
            rows={2}
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && hasFiles && message.trim() && !working && !running) {
                event.preventDefault();
                void commit();
              }
            }}
            className="max-h-24 min-w-0 flex-1 resize-none"
          />
          <div className="flex shrink-0 items-center gap-1.5">
            <Button id="changes-commit" size="sm" disabled={!hasFiles || !message.trim() || !!working || running} onClick={() => void commit()}>
              <GitCommitHorizontalIcon className="size-3.5" />
              {working === "commit" ? "Committing…" : "Commit"}
            </Button>
            <Button id="changes-push" size="sm" variant="outline" disabled={!canPush || !!working} onClick={() => void push()}>
              <UploadIcon className="size-3.5" />
              {working === "push" ? "Pushing…" : unpublished ? "Publish branch" : "Push"}
            </Button>
            {pr?.pr ? (
              <Button id="changes-open-pr" size="sm" variant="outline" onClick={() => void api.openExternal(pr.pr!.url)}>
                <GitPullRequestIcon className="size-3.5" />
                View PR
              </Button>
            ) : (
              <Button
                id="changes-create-pr"
                size="sm"
                variant="outline"
                disabled={!canCreatePr || !!working}
                title={hasFiles ? "Commit your changes first" : pr?.message}
                onClick={() => void createPr()}
              >
                <GitPullRequestIcon className="size-3.5" />
                {working === "pr" ? "Opening…" : "Create PR"}
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** "Open the side panel on the pull request": the branch's pull request, read with `gh` when the preference is on. */
function usePullRequest(root: string | null, summary: ChangesSummary | null, enabled: boolean, reload: number) {
  const [status, setStatus] = useState<PullRequestStatus | null>(null);
  const key = enabled && root && summary?.branch ? `${root}\n${summary.branch}\n${summary.upstream ?? ""}\n${summary.ahead}` : "";
  useEffect(() => {
    setStatus(null);
    const api = gitApi();
    if (!key || !api || !root) return;
    let live = true;
    api.gitPullRequest({ root }).then(
      (value) => live && setStatus(value),
      () => live && setStatus(null),
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` covers root and the branch state
  }, [key, reload]);
  return status?.pr ?? null;
}

/** Header button ("3 files +12 −4") and its dialog, for repo-backed chats only. */
export function ChangesButton({ state }: { state: ChatState }) {
  // The chat's own folder (worktree or repository root) once the main process made it the active project.
  const root = state.activeRoot && gitApi() ? state.activeRoot : null;
  const { summary, error, refresh, setSummary } = useChanges(root);
  const [open, setOpen] = useState(false);
  const [closed, setClosed] = useState(0);
  const preferPr = usePreference("openPullRequest") === true;
  const pr = usePullRequest(root, summary, preferPr, closed);
  const running = state.busy || (state.busyChats?.length ?? 0) > 0;
  if (!root || (!summary && error)) return null;
  const count = summary?.totals.files ?? 0;
  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) setClosed((n) => n + 1);
  };
  const dialog = (
    <ChangesDialog open={open} onOpenChange={onOpenChange} state={state} root={root} summary={summary} refresh={refresh} setSummary={setSummary} running={running} />
  );
  if (pr) {
    const label = pr.isDraft ? "Draft" : pr.state.charAt(0) + pr.state.slice(1).toLowerCase();
    return (
      <>
        <ChatHeaderButton
          id="changes-pr-button"
          title={`${pr.title} · ${pr.url}`}
          className="min-w-0 shrink justify-start"
          onClick={() => void gitApi()?.openExternal(pr.url)}
        >
          <GitPullRequestIcon className="size-3.5 shrink-0 text-primary-text" />
          <span className="truncate">
            #{pr.number} {pr.title}
          </span>
          <span className="shrink-0 text-sm text-muted-foreground">{label}</span>
          <ExternalLinkIcon className="size-3 shrink-0 text-muted-foreground" />
        </ChatHeaderButton>
        <Button
          id="changes-button"
          size="icon-sm"
          variant="ghost"
          aria-label={`Show changes (${count} ${count === 1 ? "file" : "files"})`}
          title="Show changes"
          onClick={() => setOpen(true)}
        >
          <FileDiffIcon className="size-3.5" />
        </Button>
        {dialog}
      </>
    );
  }
  return (
    <>
      <ChatHeaderButton
        id="changes-button"
        title={summary ? `${count} changed ${count === 1 ? "file" : "files"} on ${summary.branch ?? "detached HEAD"}` : "Changes"}
        className="min-w-0 shrink justify-start"
        onClick={() => setOpen(true)}
      >
        <FileDiffIcon className="size-3.5 shrink-0 text-muted-foreground" />
        {count > 0 ? (
          <>
            <span className="truncate">
              {count} {count === 1 ? "file" : "files"} changed
            </span>
            <span className="text-sm">
              <Counts added={summary!.totals.added} removed={summary!.totals.removed} />
            </span>
          </>
        ) : (
          <span className="truncate text-muted-foreground">
            {summary && summary.ahead > 0 ? `${summary.ahead} unpushed ${summary.ahead === 1 ? "commit" : "commits"}` : "No changes"}
          </span>
        )}
      </ChatHeaderButton>
      {dialog}
    </>
  );
}

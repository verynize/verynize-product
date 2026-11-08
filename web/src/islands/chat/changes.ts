// Changes panel data: the window.desktop git API (desktop/git-changes.cjs) and a hook that keeps the
// project's change summary fresh (on mount, focus, agent tool results and finished turns).
import { useCallback, useEffect, useRef, useState } from "react";
import { legacySet } from "@/lib/bridge";
import { can, platform } from "@/lib/platform";

export type ChangedFile = {
  path: string;
  status: "modified" | "added" | "deleted" | "renamed" | "untracked" | "conflicted";
  code: string;
  added: number;
  removed: number;
  binary: boolean;
};
export type ChangesSummary = {
  root: string;
  branch: string | null;
  detached: boolean;
  head: string | null;
  upstream: string | null;
  upstreamBranch: string | null;
  ahead: number;
  behind: number;
  remote: string | null;
  remoteUrl: string | null;
  files: ChangedFile[];
  totals: { files: number; added: number; removed: number };
  truncated: boolean;
};
export type FileDiff = {
  file: string;
  status: string;
  diff: string;
  truncated: boolean;
  binary: boolean;
};
export type PullRequest = {
  number: number;
  url: string;
  state: string;
  title: string;
  isDraft: boolean;
  base: string;
  head: string;
};
export type PullRequestStatus = {
  gh: "ready" | "missing" | "unauthenticated" | "unsupported";
  pr: PullRequest | null;
  message?: string;
};

export type Root = { root?: string };
export type GitApi = {
  gitChanges(options: Root): Promise<ChangesSummary>;
  gitDiff(options: Root & { file: string }): Promise<FileDiff>;
  gitCommit(
    options: Root & { message: string },
  ): Promise<{ commit: string; branch: string | null; message: string; files: number }>;
  gitDiscard(options: Root & { file: string }): Promise<{ file: string }>;
  gitPush(
    options: Root,
  ): Promise<{ branch: string; remote: string; upstream: string; summary: ChangesSummary }>;
  gitPullRequest(options: Root): Promise<PullRequestStatus>;
  gitCreatePullRequest(
    options: Root & { title?: string; body?: string; base?: string; draft?: boolean },
  ): Promise<{ url: string | null; pr: PullRequest | null; existed: boolean }>;
  openExternal(url: string): Promise<unknown>;
  onAgentEvent(callback: (event: { type: string; chatId?: string }) => void): () => void;
};

/** The git API, or null in the web build. */
export function gitApi(): GitApi | null {
  return can("git") ? platform.desktop : null;
}

/** IPC errors arrive as "Error invoking remote method 'desktop:x': Error: message"; keep the message. */
export function errorText(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.replace(/^Error invoking remote method '[^']+':\s*(?:\w*Error:\s*)?/, "");
}

/** Change summary for `root` (null = no repo-backed chat). `error` holds "not a Git repository" and similar. */
export function useChanges(root: string | null) {
  const [summary, setSummary] = useState<ChangesSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const generation = useRef(0);
  const timer = useRef<number | undefined>(undefined);

  const refresh = useCallback(async () => {
    const api = gitApi();
    if (!api || !root) return null;
    const id = ++generation.current;
    setLoading(true);
    try {
      const next = await api.gitChanges({ root });
      if (id === generation.current) {
        setSummary(next);
        setError(null);
      }
      return next;
    } catch (failure) {
      if (id === generation.current) {
        setSummary(null);
        setError(errorText(failure));
      }
      return null;
    } finally {
      if (id === generation.current) setLoading(false);
    }
  }, [root]);

  useEffect(() => {
    setSummary(null);
    setError(null);
    if (!root || !gitApi()) return;
    void refresh();
    const later = (delay: number) => {
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => void refresh(), delay);
    };
    // Agent edits land through tool calls; a finished turn is the authoritative refresh point.
    const off = gitApi()?.onAgentEvent?.((event) => {
      if (event.type === "done") later(150);
      else if (event.type === "tool-result") later(800);
    });
    const onFocus = () => later(100);
    window.addEventListener("focus", onFocus);
    return () => {
      off?.();
      window.removeEventListener("focus", onFocus);
      window.clearTimeout(timer.current);
      generation.current++;
    };
  }, [root, refresh]);

  return { summary, error, loading, refresh, setSummary };
}

/** Composer preset: ask the agent to implement the selected canvas elements in the repository. */
export const IMPLEMENT_PROMPT =
  "Implement the selected canvas design in this repository's code. Read the selection with the verynize tools " +
  "(design context and element code) first, then build it with the project's existing components, styles and conventions. " +
  "Keep unrelated code unchanged, and finish with a short list of the files you changed.";

export function presetImplementPrompt() {
  const prompt = document.getElementById("project-prompt") as HTMLTextAreaElement | null;
  if (!prompt) return;
  legacySet(prompt, IMPLEMENT_PROMPT);
  prompt.focus();
  prompt.setSelectionRange(prompt.value.length, prompt.value.length);
}

/** First line of the latest user message, as a commit message suggestion. */
export function suggestMessage(messages: { role: string; text: string }[]): string {
  const last = [...messages].reverse().find((m) => m.role === "user" && m.text.trim());
  const line = last?.text.trim().split("\n")[0] ?? "";
  if (!line || line === IMPLEMENT_PROMPT.split("\n")[0])
    return line ? "Implement canvas design" : "";
  return line.length > 72 ? line.slice(0, 71).trimEnd() + "…" : line;
}

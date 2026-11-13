// Code workspace controller: the repository list (desktop/repositories.cjs) and the chat ↔ worktree flow on top of
// the chat state in web/desktop-panel.js. A repository chat is created with its own git worktree (or the repository
// root when it is not a committed git repository); quick chats have no repository. Exposed as window.codeWorkspace
// for the chat island and legacy scripts.
import { useSyncExternalStore } from "react";
import type { ChatSummary } from "../chat/store";
import { desktop, errorMessage, setStatus, workspace, type Repository } from "./api";

type Store = { repositories: Repository[]; loaded: boolean; pending: boolean };
let store: Store = { repositories: [], loaded: false, pending: false };
const listeners = new Set<() => void>();
const emit = (next: Partial<Store>) => {
  store = { ...store, ...next };
  listeners.forEach((fn) => fn());
};
export function useRepositories(): Store {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => store,
  );
}

export const QUICK = "unattached";

/** Run a user action; failures go to the status line. */
async function guard<T>(fn: () => Promise<T>): Promise<T | undefined> {
  try {
    return await fn();
  } catch (error) {
    setStatus(errorMessage(error));
    return undefined;
  }
}

export async function refresh() {
  const api = desktop()?.repositories;
  if (!api) {
    emit({ loaded: true });
    return store.repositories;
  }
  const { repositories } = await api.list();
  emit({ repositories, loaded: true });
  return repositories;
}

export const repositoryByKey = (key: string) =>
  store.repositories.find((r) => r.root === key) ?? null;

/** Create a chat in `repository` with its own worktree, then make it the active chat. */
export function newChat(repository?: Repository | null) {
  return guard(async () => {
    await createChat(repository);
    showDock();
  });
}

async function createChat(repository?: Repository | null) {
  const ws = workspace();
  const api = desktop()?.repositories;
  const key = ws?.getState().projectKey ?? QUICK;
  const repo = repository === undefined ? repositoryByKey(key) : repository;
  if (!ws) return;
  if (repository === undefined && !repo && key !== QUICK) {
    // A project opened outside the repository list: plain chat in its root.
    ws.createChat?.({});
    return;
  }
  if (!repo || !api) {
    ws.switchProject?.(QUICK, "", { create: false });
    ws.createChat?.({});
    return;
  }
  emit({ pending: true });
  try {
    const id = crypto.randomUUID();
    const worktree = await api.createChatWorktree({ repoId: repo.id, chatId: id });
    ws.switchProject?.(repo.root, repo.name, { create: false });
    ws.createChat?.({
      id,
      repoId: repo.id,
      worktree: worktree.shared ? null : { path: worktree.path, branch: worktree.branch },
    });
    setStatus(worktree.shared ? `New chat in ${repo.name}` : `New chat on ${worktree.branch}`);
  } finally {
    emit({ pending: false });
  }
}

export const newQuickChat = () => newChat(null);

/** Folder a chat works in: its own worktree, else the repository root (several chats can share one). */
export const chatFolder = (chat: ChatSummary, key: string) => chat.root ?? key;

/** Chat tabs: a new chat in the same worktree as the current chat (no new worktree is created). */
export function newTab() {
  return guard(async () => {
    const ws = workspace();
    const state = ws?.getState();
    const repo = state ? repositoryByKey(state.projectKey) : null;
    const current = state?.conversationId
      ? ws?.chatSummaries?.(state.projectKey).find((c) => c.id === state.conversationId)
      : null;
    if (!ws || !repo || !current) return newChat();
    ws.createChat?.({
      repoId: repo.id,
      worktree: current.root ? { path: current.root, branch: current.branch ?? null } : null,
    });
    setStatus(current.branch ? `New tab on ${current.branch}` : `New tab in ${repo.name}`);
  });
}

/** Open a chat of a repository (or of the quick chats). */
export function openChat(key: string, chatId: string) {
  const ws = workspace();
  const repo = repositoryByKey(key);
  ws?.switchProject?.(key, repo?.name ?? "", { select: chatId, create: key === QUICK });
  showDock();
}

/** Outside Code mode the chat lives in the design dock: picking or creating a chat from the sidebar opens it. */
function showDock() {
  if (!document.body.classList.contains("code-mode")) workspace()?.openChat?.();
}

/** Show a repository: its latest chat, or a new chat when it has none. */
export async function openRepository(repo: Repository) {
  const ws = workspace();
  if (!ws) return;
  const chats = ws.chatSummaries?.(repo.root) ?? [];
  if (chats.length) openChat(repo.root, chats[0].id);
  else await newChat(repo);
}

export function addRepository(kind: "local" | "new" | "clone") {
  return guard(async () => {
    const api = desktop()?.repositories;
    if (!api) throw Error("Repositories need the desktop app");
    let repo: Repository | null = null;
    if (kind === "local") repo = await api.addLocal();
    else {
      let repository: string | undefined;
      if (kind === "clone") {
        repository =
          (await window.askText?.("HTTPS GitHub repository URL", "https://github.com/"))?.trim() ||
          undefined;
        if (!repository) return;
      }
      const suggested = repository
        ? repository
            .replace(/\.git$/, "")
            .split("/")
            .pop() || "my-project"
        : "my-project";
      const name = (
        await window.askText?.(
          kind === "clone" ? "Folder name for the clone" : "Repository name",
          suggested,
        )
      )?.trim();
      if (!name) return;
      setStatus(kind === "clone" ? "Cloning repository…" : "Creating repository…");
      repo = await api.create({ name, ...(repository ? { repository } : {}) });
    }
    if (!repo) return;
    await refresh();
    workspace()?.setCodeMode?.(true);
    await openRepository(repo);
    return repo;
  });
}

export function archiveRepository(repo: Repository) {
  return guard(async () => {
    const ws = workspace();
    if ((ws?.chatSummaries?.(repo.root) ?? []).some((c) => c.busy))
      throw Error("Stop the running chats in this repository first");
    if (
      !window.confirm(`Remove ${repo.name} from the list? Files and chat worktrees stay on disk.`)
    )
      return;
    await desktop()?.repositories?.archive(repo.id);
    if (ws?.getState().projectKey === repo.root) ws.switchProject?.(QUICK, "", { create: true });
    await refresh();
  });
}

/** Archive a chat: removes its worktree (asking first when it has uncommitted work) and the transcript. */
export function archiveChat(key: string, chatId: string) {
  return guard(async () => {
    const ws = workspace();
    if (!ws) return;
    const chat = ws.chatSummaries?.(key).find((c) => c.id === chatId);
    if (!chat) return;
    if (chat.busy) throw Error("Stop the chat before archiving it");
    // Chat tabs share a worktree: keep it while another chat still works in it.
    const shared = (ws.chatSummaries?.(key) ?? []).some(
      (c) => c.id !== chatId && !!chat.root && c.root === chat.root,
    );
    if (
      !window.confirm(
        `Archive “${chat.title}”?${chat.branch && !shared ? ` Its worktree is removed; branch ${chat.branch} is kept.` : ""}`,
      )
    )
      return;
    const repo = repositoryByKey(key);
    if (repo && chat.branch && !shared) {
      try {
        await desktop()?.repositories?.removeChatWorktree({ repoId: repo.id, chatId });
      } catch (error) {
        if (!/uncommitted/.test(errorMessage(error))) throw error;
        if (
          !window.confirm(
            "This chat has uncommitted changes in its worktree. Delete them and archive anyway?",
          )
        )
          return;
        await desktop()?.repositories?.removeChatWorktree({ repoId: repo.id, chatId, force: true });
      }
    }
    if (ws.getState().projectKey !== key) openChat(key, chatId);
    ws.removeChat?.(chatId);
    setStatus(`Archived “${chat.title}”`);
  });
}

/** First load: repository list, chat factory for "New chat" in a repository, last chat and mode. */
let started = false;
export async function start() {
  if (started) return;
  started = true;
  const ws = workspace();
  ws?.setChatFactory?.(() => newChat());
  await guard(refresh);
  const last = ws?.initialSelection?.() ?? {};
  const state = ws?.getState();
  if (ws && state && typeof last.key === "string" && last.key !== state.projectKey) {
    const repo = repositoryByKey(last.key);
    if (repo) openChat(repo.root, typeof last.chatId === "string" ? last.chatId : "");
  }
  // The entry URL owns the initial view, including explicit editor links.
}

export type CodeWorkspaceApi = {
  addRepository: typeof addRepository;
  newChat: () => Promise<unknown>;
  newQuickChat: typeof newQuickChat;
  openChat: typeof openChat;
  openMemory: () => void;
  refresh: typeof refresh;
  /** Global search (settings island): show a project in Code mode and open one of its files. */
  openFile?: (root: string, path: string) => Promise<void>;
};
declare global {
  interface Window {
    codeWorkspace?: CodeWorkspaceApi;
    livePreview?: {
      show(url: string, options?: { root?: string; name?: string; chatId?: string }): void;
      ensure(options: { root: string; name?: string; chatId?: string; url?: string }): unknown;
      hide(): void;
    };
  }
}
export const codeWorkspace = () => window.codeWorkspace;

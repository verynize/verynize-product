// React view of the chat state owned by web/desktop-panel.js (window.agentWorkspace).
import { useEffect, useState, useSyncExternalStore } from "react";

export type ChatPart = {
  kind: "text" | "thinking" | "tool" | "permission" | "error" | (string & {});
  text?: string;
  at?: number;
  end?: number;
  // tool
  id?: string;
  name?: string;
  title?: string;
  input?: unknown;
  partialInput?: string;
  hasInput?: boolean;
  result?: string;
  state?: string;
  open?: boolean;
  // permission
  requestId?: string;
  toolName?: string;
  /** Nested subagent tool calls: id of the parent tool call. */
  parentToolCallId?: string;
  // question (kind "question"): structured ask_user request from the agent
  questions?: ChatQuestion[];
  /** Answers once submitted; absent while pending. */
  answers?: Record<string, string>;
  // auth (kind "auth"): the provider account is signed out; one sign-in card per reply (chat/auth-card.tsx)
  agent?: string;
  account?: { id: string; name: string; system: boolean };
};
export type ChatQuestion = {
  id: string;
  question: string;
  header?: string;
  options?: { label: string; description?: string }[];
  multiSelect?: boolean;
};
/** A canvas element referenced from the composer (@mention or selection chip). */
export type ChatMention = {
  id: string;
  label: string;
  pageId: string;
  type?: string;
  /** Agent-facing short id ("bok" or "bok.tem"). */ shortId?: string;
};
export type QueuedTask = {
  id: string;
  text: string;
  images?: string[];
  mentions?: ChatMention[];
  at: number;
};
export type ChatUsage = {
  inputTokens?: number;
  outputTokens?: number;
  contextWindow?: number;
  costUsd?: number;
  rateLimit?: { label: string; usedPercent: number; resetsAt?: number }[];
};
export type ChatMessage = {
  role: "user" | "assistant";
  text: string;
  agent?: string;
  model?: string;
  at?: number;
  end?: number;
  state?: string;
  images?: string[];
  /** Canvas document sent as context with a user message (shown as a chip, 37). */
  canvas?: string;
  parts?: ChatPart[];
  mentions?: ChatMention[];
  /** Document revision snapshot id taken before this user turn (for rewind). */
  checkpoint?: string;
  usage?: ChatUsage;
  /** User message injected into a running turn (steer). */
  steered?: boolean;
  /** Where this reply's turn ended in the provider session (rewind forks the session here). */
  resumePoint?: { sessionId: string; at: string; agent?: string };
  /** Second-opinion review of the reply at index `of`, written by the other provider. */
  review?: { of: number; author?: string; diff?: boolean };
};
export type ChatDefaults = {
  agent: string;
  model: string;
  access: string;
  effort: string;
  instructions: string;
};
export type ChatState = {
  version: number;
  projectKey: string;
  projectName: string;
  busy: boolean;
  queued: number;
  session: string;
  conversationId: string | null;
  conversations: {
    id: string;
    title: string;
    created: number;
    count: number;
    /** A run is in progress in this chat. */ busy?: boolean;
  }[];
  messages: ChatMessage[];
  /** A saved summary whose transcript has not arrived yet. */
  transcriptPending?: boolean;
  transcriptError?: string;
  /** kind: image | file | folder | figma | chat | text. */
  attachments: { kind: string; name: string; url?: string }[];
  defaults: ChatDefaults;
  /** Follow-up tasks waiting for the current run (editable/reorderable). */
  queue?: QueuedTask[];
  /** Conversation ids with a run in progress (parallel chats). */
  busyChats?: string[];
  /** Latest usage of the current conversation. */
  usage?: ChatUsage;
  /** Composer mentions pending for the next message (selection chips + @mentions). */
  mentions?: ChatMention[];
  /** Saved composer draft per conversation. */
  draft?: string;
  /** Empty-state starter briefs (`style`: the design style catalog slug the brief is written for). */
  suggestions?: { title: string; prompt: string; style?: string }[];
  /** Folder the current chat works in (its worktree, else the repository root); null for quick chats. */
  chatRoot?: string | null;
  /** Root the main process confirmed as active (files, git, dev server); undefined while switching. */
  activeRoot?: string | null;
  /** Repository id and worktree branch of the current chat (Code workspace). */
  repoId?: string | null;
  branch?: string | null;
  codeMode?: boolean;
  /** Latest status line from the workspace and when it was set. */
  status?: string;
  statusAt?: number;
  /** Project keys with a run in progress. */
  busyKeys?: string[];
  /** Extra working directories of the current chat (/add-dir, linked worktrees). */
  directories?: string[];
};
export type ChatSummary = {
  id: string;
  title: string;
  created: number;
  count: number;
  branch?: string;
  /** Worktree folder (absent when the chat shares the repository root). */ root?: string;
  busy?: boolean;
};
export type WorkspaceActions = Partial<
  Record<
    | "openDesign"
    | "saveDesign"
    | "saveDesignAs"
    | "gitStatus"
    | "createWorktree"
    | "livePreview"
    | "captureApp"
    | "exportPDF",
    () => void
  >
>;
export type AgentModel = { id: string; name: string; description?: string };

type Workspace = {
  subscribe(fn: () => void): () => void;
  getState(): ChatState;
  openChat(): void;
  openProject(): void;
  closeChat(): void;
  getDefaults(): ChatDefaults;
  setDefaults(value: Partial<ChatDefaults>): void;
  newChat(): void;
  selectChat(id: string): boolean;
  forkAt(index: number): void;
  answerPermission(messageIndex: number, partIndex: number, allow: boolean, always?: boolean): void;
  setPartOpen(messageIndex: number, partIndex: number, open: boolean): void;
  removeAttachment(index: number): void;
  attachImages?(files: File[]): void;
  listModels?: (agent: string) => Promise<AgentModel[]>;
  // --- chat parity contract (implemented in web/desktop-panel.js) ---
  answerQuestion?(messageIndex: number, partIndex: number, answers: Record<string, string>): void;
  steer?: (text: string) => void;
  /** Queue a follow-up behind the running turn (runs it right away when idle). */
  queueMessage?: (text: string) => void;
  editQueued?(id: string, text: string): void;
  moveQueued?(id: string, delta: -1 | 1): void;
  removeQueued?(id: string): void;
  sendQueuedNow?(id: string): void;
  /** Opens verynize:// links (artboards/elements) on the canvas; returns false if unhandled. */
  openLink?: (url: string) => boolean;
  /** Search canvas elements for the @ popover. */
  searchElements?(query: string): ChatMention[];
  addMention?(mention: ChatMention): void;
  removeMention?(id: string): void;
  rewindTo?(messageIndex: number): void;
  /** Ask the other provider to review the reply at `messageIndex` (read-only; adds a review message). */
  secondOpinion?(messageIndex: number): void;
  retry?(messageIndex: number): void;
  editMessage?(messageIndex: number, text: string): void;
  copyMessage?(messageIndex: number): void;
  /** No argument: open the file picker; `{folder:true}`: attach a folder tree; File[]: attach dropped files (images go to attachImages). */
  attachFiles?(input?: File[] | FileList | { folder?: boolean }): void;
  attachFigma?(url: string): void;
  /** Link a chat of any repository (`key` = its project key; default the open one): transcript + worktree as context. */
  linkChat?(conversationId: string, key?: string): void;
  addDirectory?(path: string): void;
  removeDirectory?(path: string): void;
  /** Attach images already saved under userData/agent-attachments (design reference collections). */
  attachImagePaths?(items: { path: string; name: string }[]): void;
  /** Attach a text block to the next message (kind "terminal": `<terminal-output>`). */
  attachText?(kind: string, name: string, text: string, meta?: Record<string, string>): void;
  attachedImages?(): { path: string; name: string }[];
  /** Start a fresh provider session for the next message (keeps the transcript). */
  clearSession?(): void;
  setDraft?: (text: string) => void;
  getQueue?(): QueuedTask[];
  /** Run id of the current conversation's active run (tests/debugging). */
  activeRunId?(): string | null;
  // --- Code workspace contract (web/desktop-panel.js; driven by web/src/islands/code) ---
  setChatFactory?(fn: (() => unknown) | null): void;
  createChat?(extra: {
    id?: string;
    repoId?: string;
    worktree?: { path: string; branch: string | null } | null;
  }): void;
  switchProject?(key: string, name: string, options?: { select?: string; create?: boolean }): void;
  chatSummaries?(key: string): ChatSummary[];
  removeChat?(id: string): boolean;
  setOpenFile?(file: { path: string; text: string } | null): void;
  attachCodeHost?(el: HTMLElement | null): void;
  setCodeMode?(on: boolean): void;
  setStatus?(text: string): void;
  /** Chat selected when the app last closed: {key, chatId}. */
  initialSelection?(): { key?: string; chatId?: string } | null;
  actions?: WorkspaceActions;
};

export const workspace = () => window.agentWorkspace as unknown as Workspace | undefined;

const noop = () => () => {};
const subscribe = (fn: () => void) => workspace()?.subscribe?.(fn) ?? noop();
const getSnapshot = () => workspace()?.getState?.() ?? null;

/** Chat state; null when desktop-panel.js is unavailable. */
export function useChatState(): ChatState | null {
  return useSyncExternalStore(subscribe, getSnapshot);
}

/** Current time, ticking every second while `active` (for "Wondering for 3s"). */
export function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [active]);
  return active ? now : 0;
}

const modelCache = new Map<string, Promise<AgentModel[]>>();
/** Models a provider reports (Claude SDK supportedModels / Codex model/list), loaded when `enabled`. */
export function useModels(agent: string, enabled: boolean): AgentModel[] {
  const [models, setModels] = useState<AgentModel[]>([]);
  useEffect(() => {
    const list = workspace()?.listModels;
    if (!enabled || !list) return;
    let live = true;
    let request = modelCache.get(agent);
    if (!request) {
      request = list(agent).catch(() => {
        modelCache.delete(agent);
        return [];
      });
      modelCache.set(agent, request);
    }
    void request.then((value) => {
      // An empty list (web: signed out, model API off) is asked again next time instead of being kept.
      if (!value.length) modelCache.delete(agent);
      if (live) setModels(value.filter((m) => m.id !== "default"));
    });
    return () => {
      live = false;
    };
  }, [agent, enabled]);
  return models;
}

/**
 * The agents this runtime offers, from desktop-panel's `#project-agent` options (Claude/Codex on the desktop, the model
 * API `openrouter` on the web); `available` is false for one the transport did not detect.
 */
export function agentOptions(): { id: string; label: string; available: boolean }[] {
  const select = document.getElementById("project-agent") as HTMLSelectElement | null;
  return select
    ? [...select.options].map((o) => ({ id: o.value, label: o.text, available: !o.disabled }))
    : [];
}

/** Whether a provider was detected (desktop-panel disables the `<option>` of missing ones). */
export function agentAvailable(agent: string): boolean {
  const select = document.getElementById("project-agent") as HTMLSelectElement | null;
  const option = select ? [...select.options].find((o) => o.value === agent) : null;
  return option ? !option.disabled : true;
}

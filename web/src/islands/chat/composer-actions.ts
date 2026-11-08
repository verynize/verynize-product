// Actions behind the composer "+" menu (attach-menu.tsx) and the Verynize slash commands (slash-commands.tsx).
// Desktop calls: desktop/chat-attachments.cjs (design references, worktree copies, folder picker),
// desktop/terminal.cjs (terminalRecentOutput), desktop/agent-commands.cjs (listAgentCommands).
import { legacyClick, legacySet } from "@/lib/bridge";
import { errorMessage } from "../code/api";
import { workspace } from "./store";
import { OPEN_STYLE_PICKER_EVENT, hasStyleCatalog } from "./style-picker";
import { platform } from "@/lib/platform";

export type AgentCommand = {
  name: string;
  description: string;
  argumentHint: string;
  source: string;
};
export type ReferenceCollection = { id: string; name: string; count: number; createdAt: number };

export const chatDesktop = () => platform.desktop;

const status = (text: string) => workspace()?.setStatus?.(text);

/** Runs an action; failures go to the chat status line. */
export async function attempt(fn: () => unknown | Promise<unknown>) {
  try {
    await fn();
  } catch (error) {
    status(errorMessage(error));
  }
}

const promptEl = () => document.getElementById("project-prompt") as HTMLTextAreaElement | null;

export function focusPrompt() {
  promptEl()?.focus();
}

/** Copy files (or a folder) into the chat's worktree. */
export const addToWorktree = (folder: boolean) =>
  attempt(async () => {
    const root = workspace()?.getState().chatRoot;
    if (!root) throw Error("This chat has no worktree; open a repository first");
    const result = await chatDesktop()?.worktreeAddFiles?.({ root, folder });
    if (result)
      status(
        result.added.length
          ? `Added ${result.added.join(", ")} to this worktree`
          : "Nothing was added",
      );
  });

/** Add a folder as a working directory of this chat (picker when no path is given). */
export const addWorkingDirectory = (path?: string) =>
  attempt(async () => {
    const dir = path?.trim() || (await chatDesktop()?.pickWorkingDirectory?.());
    if (!dir) return;
    workspace()?.addDirectory?.(dir);
    status(`Added ${dir} as a working directory`);
  });

export const attachTerminalOutput = () =>
  attempt(async () => {
    const ws = workspace();
    const output = await chatDesktop()?.terminalRecentOutput?.({
      cwd: ws?.getState().chatRoot ?? null,
    });
    if (!output?.text.trim())
      throw Error("No terminal output yet: run something in the Code workspace terminal first");
    ws?.attachText?.("terminal", "Terminal output", output.text, { cwd: output.cwd });
  });

const FIGMA_URL = /^https:\/\/([\w-]+\.)?figma\.com\/(file|design|proto|board)\//i;
export async function attachFigma() {
  const ask = window.askText ?? (async (title: string) => window.prompt(title));
  const url = (await ask("Figma link (copy link to a frame or file)", ""))?.trim();
  if (!url) return;
  if (!FIGMA_URL.test(url)) {
    status("That doesn't look like a Figma link (https://www.figma.com/design/…)");
    return;
  }
  workspace()?.attachFigma?.(url);
}

export const attachCollection = (id: string) =>
  attempt(async () => {
    const ws = workspace();
    let chatId = ws?.getState().conversationId;
    if (!chatId) {
      ws?.newChat();
      chatId = ws?.getState().conversationId;
    }
    if (!chatId) return;
    const images = (await chatDesktop()?.designReferencesAttach?.({ id, chatId })) ?? [];
    ws?.attachImagePaths?.(images);
  });

export const saveAttachedCollection = () =>
  attempt(async () => {
    const images = workspace()?.attachedImages?.() ?? [];
    if (!images.length) throw Error("Attach images first, then save them as a collection");
    const ask = window.askText ?? (async (title: string) => window.prompt(title));
    const name = (await ask("Name this design reference collection", ""))?.trim();
    if (!name) return;
    const saved = await chatDesktop()?.designReferencesSave?.({
      name,
      images: images.map((image) => image.path),
    });
    if (saved)
      status(`Saved “${saved.name}” (${saved.count} image${saved.count === 1 ? "" : "s"})`);
  });

/** "+ New worktree" in "Link a chat or worktree": a fresh worktree of the repository, linked as a working directory. */
export const linkNewWorktree = (repoId: string) =>
  attempt(async () => {
    const api = chatDesktop()?.repositories;
    if (!api) throw Error("Worktrees need the desktop app");
    const worktree = await api.createChatWorktree({ repoId, chatId: crypto.randomUUID() });
    if (worktree.shared)
      throw Error("This repository has no commits yet, so it cannot have worktrees");
    workspace()?.addDirectory?.(worktree.path);
    status(`Linked new worktree ${worktree.branch ?? worktree.path}`);
  });

function toggleCheckbox(id: string, label: string) {
  const box = document.getElementById(id) as HTMLInputElement | null;
  if (!box) return;
  legacySet(box, !box.checked);
  status(`${label} ${box.checked ? "on" : "off"}`);
}

/** Verynize's own commands (run in the app, not sent to the agent). */
export type BuiltinCommand = AgentCommand & { run(args: string): void; when?: () => boolean };
const attached = () => (workspace()?.getState().projectKey ?? "unattached") !== "unattached";
export const BUILTIN_COMMANDS: BuiltinCommand[] = [
  {
    name: "add-dir",
    argumentHint: "[path]",
    description: "Add a folder to this chat as a working directory",
    source: "verynize",
    run: (args) => void addWorkingDirectory(args),
  },
  {
    name: "add-file",
    argumentHint: "",
    description: "Add a Verynize file to this worktree",
    source: "verynize",
    when: attached,
    run: () => void addToWorktree(false),
  },
  {
    name: "clear",
    argumentHint: "",
    description: "Start a fresh agent session; the transcript stays",
    source: "verynize",
    run: () => void attempt(() => workspace()?.clearSession?.()),
  },
  {
    name: "style",
    argumentHint: "",
    description: "Choose the design style for the next messages",
    source: "verynize",
    when: hasStyleCatalog,
    run: () => window.dispatchEvent(new Event(OPEN_STYLE_PICKER_EVENT)),
  },
  {
    name: "canvas-context",
    argumentHint: "",
    description: "Turn sending the canvas context with messages on or off",
    source: "verynize",
    run: () => toggleCheckbox("agent-canvas-context", "Canvas context"),
  },
  {
    name: "attach-canvas",
    argumentHint: "",
    description: "Attach the canvas document to this message",
    source: "verynize",
    run: () => legacyClick("chat-attach-canvas"),
  },
  {
    name: "open-file",
    argumentHint: "",
    description: "Turn including the file open in the editor on or off",
    source: "verynize",
    when: attached,
    run: () => toggleCheckbox("project-context", "Include the open file"),
  },
  {
    name: "review-changes",
    argumentHint: "",
    description: "Review the changes in this worktree",
    source: "verynize",
    when: attached,
    run: () => legacyClick("project-review"),
  },
  {
    name: "apply-design",
    argumentHint: "",
    description: "Implement the canvas design in this worktree",
    source: "verynize",
    when: attached,
    run: () => legacyClick("project-apply-design"),
  },
];

const commandCache = new Map<string, { at: number; request: Promise<AgentCommand[]> }>();
/** The agent's own commands and skills for the chat folder (cached 30s). */
export function loadAgentCommands(
  agent: string,
  root: string | null | undefined,
): Promise<AgentCommand[]> {
  const key = `${agent}\u0000${root ?? ""}`;
  const cached = commandCache.get(key);
  if (cached && Date.now() - cached.at < 30000) return cached.request;
  const list = chatDesktop()?.listAgentCommands;
  const request = list
    ? list({ agent, root: root ?? null })
        .then((result) => result.commands ?? [])
        .catch(() => {
          commandCache.delete(key);
          return [];
        })
    : Promise.resolve([]);
  commandCache.set(key, { at: Date.now(), request });
  return request;
}

/** Opens the slash-command list (the "+ › Commands" item). */
export const OPEN_COMMANDS_EVENT = "bd:open-slash-commands";
export function openCommands() {
  window.dispatchEvent(new Event(OPEN_COMMANDS_EVENT));
}

/** Replace the prompt text (fires input so listeners and the draft update). */
export function setPrompt(text: string, caret = text.length) {
  const prompt = promptEl();
  if (!prompt) return;
  legacySet(prompt, text);
  prompt.focus();
  prompt.setSelectionRange(caret, caret);
}

/* ---------- Agent commands inside the prompt text ---------- */
// A command or skill picked from the slash list stays in the prompt as "/name" (anywhere, so text can go before and
// after it); the composer draws it as a badge. Agents only run a command at the start of a message, so sending moves
// it to the front.
const commandNames = new Set<string>();
export const rememberCommand = (name: string) => void commandNames.add(name);

const TOKEN = /(^|\s)\/([^\s/]+)(?=\s|$)/g;
export type PromptRun = { text: string; command?: string };

/** The prompt split into plain text and picked-command tokens ("/name" at a word start). */
export function promptRuns(text: string): PromptRun[] {
  const runs: PromptRun[] = [];
  let last = 0;
  for (const match of text.matchAll(TOKEN)) {
    if (!commandNames.has(match[2])) continue;
    const start = match.index + match[1].length;
    if (start > last) runs.push({ text: text.slice(last, start) });
    runs.push({ text: `/${match[2]}`, command: match[2] });
    last = start + match[2].length + 1;
  }
  if (last < text.length) runs.push({ text: text.slice(last) });
  return runs;
}

/** Start of a picked-command token that ends exactly at `caret`, or -1. */
export function commandEndingAt(text: string, caret: number) {
  const found = text.slice(0, caret).match(/(^|\s)\/([^\s/]+)$/);
  return found && commandNames.has(found[2]) ? caret - found[2].length - 1 : -1;
}

/** "/name text before text after": the first picked command moved to the front of the prompt. */
export function commandFirst(text: string) {
  const runs = promptRuns(text);
  const index = runs.findIndex((run) => run.command);
  if (index <= 0) return text;
  const rest = runs
    .filter((_, i) => i !== index)
    .map((run) => run.text)
    .join("")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
  return rest ? `${runs[index].text} ${rest}` : runs[index].text;
}

/** Called just before the prompt is sent. */
export function moveCommandFirst() {
  const prompt = promptEl();
  if (prompt) prompt.value = commandFirst(prompt.value);
}

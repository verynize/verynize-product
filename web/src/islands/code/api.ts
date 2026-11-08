// Types of the desktop APIs the Code workspace uses (typed in @/lib/desktop-api) and access to the chat workspace
// (web/desktop-panel.js, typed in ../chat/store).
import { workspace } from "../chat/store";
import { platform } from "@/lib/platform";

export { workspace };
export type Repository = { id: string; name: string; root: string; addedAt: number; git?: boolean };
export type Worktree = { path: string; branch: string | null; shared: boolean };
export type PreviewProposal = {
  saved?: boolean;
  id: string;
  root: string;
  command: string[];
  setup?: string[];
  port: number;
  chatId?: string | null;
  name?: string | null;
};
export type DevServerStatus = {
  proposal?: PreviewProposal | null;
  state: "stopped" | "starting" | "running" | "exited" | "failed";
  root: string | null;
  url?: string | null;
  error?: string;
  tail?: string;
  detected?: { command: string[] } | null;
  config?: PreviewConfig | null;
  /** Setup job of this root while it runs. */
  setup?: { state: string; tail?: string } | null;
  /** The saved setup changed or did not finish: the next start runs it first. */
  setupPending?: boolean;
};
export type PreviewCommand = { name: string; command: string[]; url?: string };
export type PreviewConfig = {
  command: string[];
  setup?: string[];
  setupSteps?: string[][];
  stopSteps?: string[][];
  commands?: PreviewCommand[];
  url?: string;
};
export type PreviewConfigInput = {
  root?: string;
  command?: string[];
  commands?: PreviewCommand[];
  setup?: string[] | string[][];
  stop?: string[][];
  url?: string;
};
export type ProjectFile = { path: string; size: number };
export type ChangedFile = { path: string; status: string };

export const desktop = () => platform.desktop;

/** "Error invoking remote method 'desktop:x': Error: message" → "message". */
export function errorMessage(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, "");
}

export function setStatus(text: string) {
  workspace()?.setStatus?.(text);
}

// Shared preview state for the header split button, the chat cards and the Preview settings modal: one status
// store per repository root (desktop/dev-server.cjs via preload `devServer`) and the preview actions.
// The label must follow a start immediately: a start marks the root as starting synchronously, and the canvas
// frame (`bd:preview-state`, `bd:preview-setup-state`) and our own `bd:dev-server-changed` trigger a refresh,
// so the 4 s poll (1 s while starting) is only a fallback.
import { useEffect, useSyncExternalStore } from "react";
import { desktop, errorMessage, setStatus, workspace, type DevServerStatus } from "./api";
import { markStep } from "./next-steps";
import type { ChatState } from "../chat/store";

type LivePreviewApi = {
  show(url: string, options?: { root?: string; name?: string; chatId?: string }): void;
  ensure(options: { root: string; name?: string; chatId?: string; url?: string }): unknown;
  reveal?(): boolean;
};
type PreviewTabApi = { open(frameId: string): unknown };
type PreviewEditsApi = { confirmBeforeStop?: (frameId: string) => Promise<boolean> };
const globals = () =>
  window as unknown as {
    livePreview?: LivePreviewApi;
    previewTab?: PreviewTabApi;
    previewEdits?: PreviewEditsApi;
  };

/** idle: not running · investigating: the agent is detecting the setup · starting: setup or server starting. */
export type PreviewPhase = "idle" | "investigating" | "starting" | "running";
type Entry = {
  status: DevServerStatus | null;
  starting: number;
  investigating: boolean;
  snapshot: Snapshot;
};
export type Snapshot = { status: DevServerStatus | null; phase: PreviewPhase };

const entries = new Map<string, Entry>();
const listeners = new Map<string, Set<() => void>>();
const EMPTY: Snapshot = { status: null, phase: "idle" };

const phaseOf = (entry: Entry): PreviewPhase => {
  const s = entry.status;
  if (s?.state === "running") return entry.starting ? "starting" : "running";
  if (entry.starting || s?.state === "starting" || s?.setup?.state === "running") return "starting";
  return entry.investigating ? "investigating" : "idle";
};
const entryFor = (root: string) => {
  let entry = entries.get(root);
  if (!entry) {
    entry = { status: null, starting: 0, investigating: false, snapshot: EMPTY };
    entries.set(root, entry);
  }
  return entry;
};
function emit(root: string) {
  const entry = entryFor(root);
  entry.snapshot = { status: entry.status, phase: phaseOf(entry) };
  listeners.get(root)?.forEach((fn) => fn());
}
function update(root: string, patch: Partial<Omit<Entry, "snapshot">>) {
  Object.assign(entryFor(root), patch);
  emit(root);
}

const inFlight = new Map<string, Promise<void>>();
/** Re-read the status of `root` now (coalesced). */
export function refreshPreview(root: string | null | undefined): Promise<void> {
  const api = desktop()?.devServer;
  if (!root || !api) return Promise.resolve();
  const running = inFlight.get(root);
  if (running) return running;
  const next = api
    .status({ root })
    .then((status) => {
      if (status.root === root) update(root, { status });
    })
    .catch(() => {})
    .finally(() => inFlight.delete(root));
  inFlight.set(root, next);
  return next;
}
/** Tell every preview surface that the dev server of `root` may have changed. */
export const announce = (root: string) =>
  window.dispatchEvent(new CustomEvent("bd:dev-server-changed", { detail: { root } }));

export function usePreview(root: string | null | undefined): Snapshot {
  const snapshot = useSyncExternalStore(
    (fn) => {
      if (!root) return () => {};
      let set = listeners.get(root);
      if (!set) listeners.set(root, (set = new Set()));
      set.add(fn);
      return () => set.delete(fn);
    },
    () => (root ? entryFor(root).snapshot : EMPTY),
  );
  const phase = snapshot.phase;
  useEffect(() => {
    if (!root) return;
    void refreshPreview(root);
    const refresh = () => void refreshPreview(root);
    const timer = window.setInterval(refresh, phase === "starting" ? 1000 : 4000);
    window.addEventListener("bd:preview-state", refresh);
    window.addEventListener("bd:dev-server-changed", refresh);
    window.addEventListener("bd:preview-setup-state", refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("bd:preview-state", refresh);
      window.removeEventListener("bd:dev-server-changed", refresh);
      window.removeEventListener("bd:preview-setup-state", refresh);
    };
  }, [root, phase]);
  return snapshot;
}

/** The agent investigation started by a first Start ends with the chat's turn. */
export function setInvestigating(root: string, on: boolean) {
  if (entryFor(root).investigating !== on) update(root, { investigating: on });
}

const details = (state: ChatState) => ({
  root: state.activeRoot || "",
  name: `${state.projectName} › ${state.conversations.find((c) => c.id === state.conversationId)?.title || "App"}`,
  chatId: state.conversationId || undefined,
});

/** The canvas frame of this chat's preview (created paused when missing); its node id. */
export function previewFrame(state: ChatState): string | null {
  if (!state.activeRoot) return null;
  const id = globals().livePreview?.ensure(details(state));
  return typeof id === "string" ? id : null;
}

/** The frame of this chat's preview, without creating one. */
function existingFrame(state: ChatState): string | null {
  const doc = (
    window as unknown as {
      design?: {
        getDocument(): {
          pages: { nodes: { id: string; preview?: { root?: string; chatId?: string } }[] }[];
        };
      };
    }
  ).design?.getDocument();
  const node = doc?.pages
    .flatMap((page) => page.nodes)
    .find(
      (n) =>
        n.preview?.root === state.activeRoot &&
        (n.preview?.chatId || "") === (state.conversationId || ""),
    );
  return node?.id ?? null;
}

/** "Go to preview": leave Code mode, select the frame and zoom to it. */
export function goToPreview(state: ChatState) {
  const live = globals().livePreview;
  if (!live || !state.activeRoot) return;
  workspace()?.setCodeMode?.(false);
  workspace()?.openChat?.();
  const url = entryFor(state.activeRoot).status?.url;
  if (url) live.show(url, details(state));
  else {
    previewFrame(state);
    live.reveal?.();
  }
}

export function openInBrowser(root: string) {
  const url = entryFor(root).status?.url;
  if (url)
    void (
      desktop() as { openExternal?(url: string): Promise<unknown> } | undefined
    )?.openExternal?.(url);
}

/** "Open in a tab ⌘⌥P" (the tab is owned by window.previewTab); a separate window when no tab support exists. */
export function openInTab(state: ChatState) {
  const tab = globals().previewTab;
  const frame = previewFrame(state);
  if (tab && frame) {
    void tab.open(frame);
    return;
  }
  const url = state.activeRoot ? entryFor(state.activeRoot).status?.url : null;
  if (url) void desktop()?.previewApp?.({ url });
}
export const canOpenInTab = (running: boolean) => !!globals().previewTab || running;

/** First Start without a saved configuration asks the agent to set the Preview up. */
export function requestSetup(state: ChatState) {
  if (!state.activeRoot) return;
  const root = state.activeRoot;
  setInvestigating(root, true);
  window.dispatchEvent(new CustomEvent("bd:setup-preview"));
  // The investigation is the chat's turn; when no turn started (no agent), do not leave the button spinning.
  window.setTimeout(() => {
    if (!workspace()?.getState().busy) setInvestigating(root, false);
  }, 4000);
}

/** Start: show the frame as starting at once, run setup + start (main process), then load the app in the frame. */
export async function startPreview(state: ChatState): Promise<DevServerStatus | null> {
  const root = state.activeRoot;
  const api = desktop()?.devServer;
  if (!root) return null;
  const entry = entryFor(root);
  if (!api) {
    workspace()?.actions?.livePreview?.();
    return null;
  }
  if (!entry.status) await refreshPreview(root);
  if (!entry.status?.config) {
    requestSetup(state);
    return null;
  }
  if (entry.status.state === "running" && entry.status.url) {
    if (!state.codeMode) globals().livePreview?.show(entry.status.url, details(state));
    return entry.status;
  }
  update(root, { starting: entry.starting + 1 });
  announce(root);
  if (!state.codeMode) workspace()?.openChat?.();
  previewFrame(state);
  window.dispatchEvent(
    new CustomEvent("bd:preview-setup-state", { detail: { root, state: "starting", message: "" } }),
  );
  setStatus("Starting the preview…");
  try {
    const next = await api.start({ root });
    update(root, { status: next.root === root ? next : entry.status });
    if (next.state === "running" && next.url) {
      markStep("published");
      setStatus(`Preview running at ${next.url}`);
      if (!state.codeMode) globals().livePreview?.show(next.url, details(state));
    } else if (next.state !== "starting") {
      const message =
        next.error || next.tail?.split("\n").slice(-2).join(" ") || "The app did not start.";
      setStatus(message);
      // The frame card shows the exit code and command from this status (header-started runs too).
      window.dispatchEvent(
        new CustomEvent("bd:preview-setup-state", {
          detail: { root, state: "failed", message, status: next },
        }),
      );
    }
    return next;
  } catch (error) {
    const message = errorMessage(error);
    setStatus(message);
    window.dispatchEvent(
      new CustomEvent("bd:preview-setup-state", { detail: { root, state: "failed", message } }),
    );
    return null;
  } finally {
    update(root, { starting: Math.max(0, entryFor(root).starting - 1) });
    announce(root);
  }
}

/** Stop (after the staged-edits confirmation, when that exists): the server, its companions and the stop command. */
export async function stopPreview(state: ChatState) {
  const root = state.activeRoot;
  const api = desktop()?.devServer;
  if (!root || !api) return;
  const frame = existingFrame(state);
  const confirm = globals().previewEdits?.confirmBeforeStop;
  if (frame && confirm && !(await confirm(frame))) return;
  try {
    update(root, { status: await api.stop({ root }) });
    setStatus("Preview stopped");
  } catch (error) {
    setStatus(errorMessage(error));
  }
  announce(root);
}

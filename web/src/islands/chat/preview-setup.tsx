// Chat side of the Preview: the agent setup request ("Set up the Preview"), the review card for a proposal in
// ask/edit access, the transcript card of a proposal saved by auto/full access, the first-run intro card
// (PS1), the Code workspace "Your app is running" card (PS6), the Preview settings host and ⌘⌥P.
import { useEffect, useState, type ReactNode } from "react";
import { ChevronDownIcon, PlayIcon, XIcon, ChevronRightIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { desktop, errorMessage, type PreviewProposal } from "../code/api";
import { formatCommand, parsePreviewCommand } from "../code/preview-command";
import { PreviewSettingsHost } from "../code/preview-settings";
import { announce, goToPreview, openInTab, startPreview, usePreview } from "../code/preview-state";
import { PreviewGlyph } from "../code/topbar";
import { ChatActionButton, ChatIconButton } from "./controls";
import { ChatTip } from "./tip";
import { workspace, type ChatPart, type ChatState } from "./store";

type CanvasPreview = {
  ensure(options: { root: string; name?: string; chatId?: string; url?: string }): unknown;
  show(url: string, options?: { root: string; name?: string; chatId?: string }): void;
};
const preview = () => (window as unknown as { livePreview?: CanvasPreview }).livePreview;

/** The chat message a first Start sends; the transcript draws it as an app action (Wonder PS2: purple, logo). */
export const PREVIEW_SETUP_REQUEST = "Set up the Preview";
const INTRO_KEY = "verynize.preview-intro";
// Storage can be blocked (private mode, disabled site data); the intro then just shows for the session.
const introDismissed = () => {
  try {
    return localStorage.getItem(INTRO_KEY) === "dismissed";
  } catch {
    return false;
  }
};
const dismissIntro = () => {
  try {
    localStorage.setItem(INTRO_KEY, "dismissed");
  } catch {
    /* ignore */
  }
};
let introUsed = false; // a Start this session hides the intro until the next launch
const runningDismissed = new Set<string>();

export function PreviewSetup({ state }: { state: ChatState }) {
  const [proposal, setProposal] = useState<PreviewProposal | null>(null);
  useEffect(() => {
    let alive = true;
    const refresh = () =>
      void desktop()
        ?.devServer?.status()
        .then((status) => {
          if (alive)
            setProposal(
              status.root === state.activeRoot &&
                (!status.proposal?.chatId || status.proposal.chatId === state.conversationId)
                ? status.proposal || null
                : null,
            );
        })
        .catch(() => {});
    refresh();
    const timer = window.setInterval(refresh, 1200);
    const setup = () => {
      if (!state.activeRoot) return;
      workspace()?.openChat();
      workspace()?.attachText?.(
        "preview",
        "Preview setup",
        `Inspect this repository's stack, package manager, install/setup requirements, development command and listening port. Use the project's actual tools (npm, Yarn, pnpm, Bun, Python or another runtime); never assume Vite+ is installed. For plain HTML without a package manifest, use an available Python interpreter with -u -m http.server and --bind 127.0.0.1; setup can be omitted. Use the propose_preview tool with Setup, Run and Port: in ask or edit access it becomes a card for my review, in auto or full access it is saved directly. Never start the server or the preview yourself; I start it with Start preview. Pass chatId ${JSON.stringify(state.conversationId)} and a short app name. The project root is ${JSON.stringify(state.activeRoot)}.`,
      );
      workspace()?.queueMessage?.(PREVIEW_SETUP_REQUEST);
    };
    window.addEventListener("bd:setup-preview", setup);
    return () => {
      alive = false;
      clearInterval(timer);
      window.removeEventListener("bd:setup-preview", setup);
    };
  }, [state.activeRoot, state.conversationId]);
  // ⌘⌥P (Ctrl+Alt+P off macOS): Open in a tab (the tab itself belongs to window.previewTab).
  useEffect(() => {
    const mac = /Mac|iPhone|iPad/.test(navigator.platform);
    const onKey = (event: KeyboardEvent) => {
      const mod = mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
      if (
        event.defaultPrevented ||
        !mod ||
        !event.altKey ||
        event.shiftKey ||
        event.code !== "KeyP"
      )
        return;
      const current = workspace()?.getState();
      if (!current?.activeRoot) return;
      event.preventDefault();
      openInTab(current);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return (
    <>
      <PreviewSettingsHost state={state} />
      {proposal ? (
        <ProposalCard
          key={proposal.id}
          proposal={proposal}
          state={state}
          onDismiss={() => setProposal(null)}
        />
      ) : (
        <PreviewNotice state={state} />
      )}
    </>
  );
}

/** Above the composer: the first-run intro on the canvas (PS1) or "Your app is running" in Code mode (PS6). */
function PreviewNotice({ state }: { state: ChatState }) {
  const root = state.activeRoot;
  const { phase } = usePreview(root);
  const [, rerender] = useState(0);
  const dismissedIntro = introDismissed();
  if (!root) return null;
  if (state.codeMode) {
    if (phase !== "running" || runningDismissed.has(root)) return null;
    return (
      <NoticeCard
        id="preview-running-card"
        glyph={<PreviewGlyph phase="running" />}
        title="Your app is running"
        description="Open the Preview on the canvas next to this chat."
        action="Show preview"
        closeLabel="Dismiss"
        onAction={() => goToPreview(state)}
        onClose={() => {
          runningDismissed.add(root);
          rerender((n) => n + 1);
        }}
      />
    );
  }
  if (dismissedIntro || introUsed || phase !== "idle" || state.busy) return null;
  return (
    <NoticeCard
      id="preview-intro"
      glyph={<PlayIcon className="size-3.5 shrink-0 fill-current text-muted-foreground" />}
      title="Preview your app on the canvas"
      description="See your changes live, next to this chat."
      action="Start preview"
      closeLabel="Don’t show this again"
      onAction={() => {
        introUsed = true;
        rerender((n) => n + 1);
        void startPreview(state);
      }}
      onClose={() => {
        dismissIntro();
        rerender((n) => n + 1);
      }}
    />
  );
}

function NoticeCard({
  id,
  glyph,
  title,
  description,
  action,
  closeLabel,
  onAction,
  onClose,
}: {
  id: string;
  glyph: ReactNode;
  title: string;
  description: string;
  action: string;
  closeLabel: string;
  onAction(): void;
  onClose(): void;
}) {
  return (
    <section
      id={id}
      aria-label={title}
      className="mx-4 mb-2 flex shrink-0 flex-col gap-3 rounded-2xl border border-card-border bg-card pt-3 pr-2 pb-2 pl-4"
    >
      <div className="flex items-start gap-2">
        <span className="flex h-5 w-3.5 shrink-0 items-center justify-center">{glyph}</span>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm leading-5 text-foreground-2">{title}</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
        </div>
        <ChatTip label={closeLabel}>
          <ChatIconButton aria-label={closeLabel} onClick={onClose} size="sm">
            <XIcon className="size-3.5" />
          </ChatIconButton>
        </ChatTip>
      </div>
      <ChatActionButton
        type="button"
        variant="secondary"
        id={`${id}-action`}
        onClick={onAction}
        className="self-end"
      >
        {action}
      </ChatActionButton>
    </section>
  );
}

/** propose_preview results saved by auto/full access: `{saved: true, savedBy, command, …}`. */
export function savedPreview(
  part: ChatPart,
): { savedBy: string; command: string[]; setup?: string[] } | null {
  if (part.kind !== "tool" || !/propose_preview$/i.test(part.name ?? "") || !part.result)
    return null;
  const read = (value: unknown): unknown => {
    if (typeof value === "string") {
      try {
        return read(JSON.parse(value));
      } catch {
        return null;
      }
    }
    if (Array.isArray(value))
      return read(value.find((item) => item && typeof item === "object" && "text" in item)?.text);
    if (
      value &&
      typeof value === "object" &&
      "content" in value &&
      Array.isArray((value as { content: unknown }).content)
    )
      return read((value as { content: unknown[] }).content);
    return value;
  };
  const data = read(part.result) as {
    saved?: boolean;
    savedBy?: string;
    command?: unknown;
    setup?: unknown;
  } | null;
  if (!data?.saved || typeof data.savedBy !== "string" || !Array.isArray(data.command)) return null;
  return {
    savedBy: data.savedBy,
    command: data.command.map(String),
    ...(Array.isArray(data.setup) ? { setup: data.setup.map(String) } : {}),
  };
}

/** Transcript card: "▶ Preview setup  Saved by auto mode ⌄" → the command and where to change it (PS2). */
export function PreviewSavedCard({ part }: { part: ChatPart }) {
  const saved = savedPreview(part);
  if (!saved) return null;
  return (
    <details data-preview-saved className="group/saved m-0 flex flex-col">
      <summary className="flex h-6 list-none items-center gap-2 self-start rounded-md text-base outline-none focus-visible:ring-1 focus-visible:ring-ring">
        <PlayIcon className="size-3.5 fill-current text-muted-foreground" />
        <span className="text-foreground-2">Preview setup</span>
        <span className="text-muted-foreground">
          {saved.savedBy === "full" ? "Saved by full access" : "Saved by auto mode"}
        </span>
        <ChevronDownIcon className="size-3 -rotate-90 text-muted-foreground transition-transform group-open/saved:rotate-0" />
      </summary>
      <div className="mt-1 flex flex-col gap-1 pl-5.5 text-base text-muted-foreground">
        {saved.setup && <span className="break-words">{formatCommand(saved.setup)}</span>}
        <span className="break-words text-foreground-3">{formatCommand(saved.command)}</span>
        <span>You can change it in Preview settings.</span>
      </div>
    </details>
  );
}

function ProposalCard({
  proposal,
  state,
  onDismiss,
}: {
  proposal: PreviewProposal;
  state: ChatState;
  onDismiss(): void;
}) {
  const [edit, setEdit] = useState(false);
  const [setup, setSetup] = useState(() => formatCommand(proposal.setup));
  const [run, setRun] = useState(() => formatCommand(proposal.command));
  const [port, setPort] = useState(String(proposal.port));
  const [phase, setPhase] = useState("");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(!!proposal.saved);
  const dismiss = async () => {
    try {
      await desktop()?.devServer?.dismissProposal({ root: proposal.root });
      onDismiss();
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  const save = async () => {
    const api = desktop()?.devServer;
    if (!api) return;
    setError("");
    try {
      const command = parsePreviewCommand(run);
      const setupArgs = setup.trim() ? parsePreviewCommand(setup) : undefined;
      if (!command.length) throw Error("Enter a run command.");
      if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535)
        throw Error("Port must be between 1 and 65535.");
      setPhase("Saving configuration…");
      await api.configure({
        root: proposal.root,
        command,
        setup: setupArgs,
        url: `http://localhost:${port}/`,
      });
      const details = {
        root: proposal.root,
        name: proposal.name || "App",
        chatId: state.conversationId || undefined,
      };
      preview()?.ensure(details);
      workspace()?.setCodeMode?.(false);
      workspace()?.openChat();
      if (setupArgs) {
        setPhase("Setting up preview…");
        window.dispatchEvent(
          new CustomEvent("bd:preview-setup-state", {
            detail: { root: proposal.root, state: "setting-up", message: "Running setup command…" },
          }),
        );
        const result = await api.setup({ root: proposal.root });
        if (result.setup) setSetup(formatCommand(result.setup));
        if (result.exitCode !== 0)
          throw Error(result.output || "Setup failed. Edit the configuration and retry.");
      }
      setPhase("Starting preview…");
      window.dispatchEvent(
        new CustomEvent("bd:preview-setup-state", {
          detail: { root: proposal.root, state: "starting", message: "Waiting for your app…" },
        }),
      );
      const status = await api.start({ root: proposal.root });
      if (status.state === "failed" || status.state === "exited")
        throw Error(status.error || status.tail || "Preview failed to start.");
      if (workspace()?.getState().activeRoot !== proposal.root)
        throw Error("Repository changed. Your preview configuration was saved.");
      if (status.url && status.state === "running") preview()?.show(status.url, details);
      setSaved(true);
      await api.dismissProposal({ root: proposal.root, saved: true });
      announce(proposal.root);
    } catch (e) {
      setError(errorMessage(e));
      window.dispatchEvent(
        new CustomEvent("bd:preview-setup-state", {
          detail: { root: proposal.root, state: "failed", message: errorMessage(e) },
        }),
      );
    } finally {
      setPhase("");
      announce(proposal.root);
    }
  };
  if (saved)
    return (
      <div className="mx-3 mb-3 flex items-center gap-2 text-sm text-muted-foreground">
        <PlayIcon className="size-4" />
        Preview setup <span>Saved</span>
        <ChevronRightIcon className="size-3" />
      </div>
    );
  return (
    <section
      id="preview-proposal"
      className="mx-3 mb-3 rounded-xl border border-card-border bg-settings p-4"
      aria-label="Proposed Preview configuration"
    >
      <div className="flex items-start gap-3">
        <PlayIcon className="mt-1 size-4 shrink-0" />
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-medium">Proposed Preview configuration</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            The agent suggests how to run your app in the Preview.
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Dismiss preview proposal"
          disabled={!!phase}
          onClick={() => void dismiss()}
        >
          <XIcon className="size-4" />
        </Button>
      </div>
      <div className="mt-4 overflow-hidden rounded-lg bg-input">
        {(
          [
            ["Setup", setup, setSetup],
            ["Run", run, setRun],
            ["Port", port, setPort],
          ] as const
        ).map(([label, value, setValue]) => (
          <label
            key={label}
            className="flex items-center gap-4 border-b border-card-border px-3 py-2 text-sm last:border-0"
          >
            <span className="w-12 shrink-0 text-muted-foreground">{label}</span>
            {edit ? (
              <Input
                aria-label={`Preview ${label}`}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                disabled={!!phase}
              />
            ) : (
              <code className="min-w-0 flex-1 break-all">{value || "None"}</code>
            )}
          </label>
        ))}
      </div>
      {(phase || error) && (
        <p
          role="status"
          className="mt-3 max-h-32 overflow-auto whitespace-pre-wrap text-xs text-muted-foreground"
        >
          {error || phase}
        </p>
      )}
      <div className="mt-3 flex justify-end gap-2">
        <Button variant="outline" disabled={!!phase} onClick={() => setEdit(!edit)}>
          {edit ? "Done" : "Edit"}
        </Button>
        <Button disabled={!!phase} onClick={() => void save()}>
          {phase || "Save & start preview"}
        </Button>
      </div>
    </section>
  );
}

// Code workspace top bars: the breadcrumb + chat switcher (rendered into the window title bar) and the toolbar
// row with the status line, "Start preview" split button and the right-panel toggle. Preview logic: ./preview-state.
import { useEffect, useState } from "react";
import {
  AppWindowIcon,
  BoltIcon,
  ChevronDownIcon,
  ChevronsUpDownIcon,
  FolderIcon,
  GitBranchIcon,
  LoaderCircleIcon,
  Maximize2Icon,
  MessageSquareIcon,
  PauseIcon,
  PlayIcon,
  SquareArrowOutUpRightIcon,
} from "lucide-react";
import { PanelRightIcon, PlusIcon } from "@/components/icons";
import { cn } from "@/lib/utils";
import {
  ChatMenu,
  ChatMenuContent,
  ChatMenuItem,
  ChatMenuLabel,
  ChatMenuSeparator,
  ChatMenuTrigger,
} from "../chat/menu";
import type { ChatState } from "../chat/store";
import { workspace } from "./api";
import { newChat, openChat, QUICK, repositoryByKey, useRepositories } from "./controller";
import "./preview-settings";
import {
  canOpenInTab,
  goToPreview,
  openInBrowser,
  openInTab,
  setInvestigating,
  startPreview,
  stopPreview,
  usePreview,
  type PreviewPhase,
} from "./preview-state";

const iconButton =
  "flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-muted hover:text-foreground-2 focus-visible:ring-1 focus-visible:ring-ring aria-pressed:text-foreground-2";

/** `repo / chat ⌃⌄` in the title bar. */
export function Breadcrumb({ state }: { state: ChatState }) {
  useRepositories();
  const quick = state.projectKey === QUICK;
  const repo = repositoryByKey(state.projectKey);
  const chats = workspace()?.chatSummaries?.(state.projectKey) ?? [];
  const title =
    state.conversations.find((c) => c.id === state.conversationId)?.title ||
    (quick ? "New quick chat" : "New chat");
  return (
    <div className="flex min-w-0 items-center gap-1 text-sm">
      <span className="flex min-w-0 shrink items-center gap-2 px-1 text-foreground-2">
        {quick ? (
          <MessageSquareIcon className="size-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <FolderIcon className="size-3.5 shrink-0 text-muted-foreground" />
        )}
        <span id="code-breadcrumb-repo" className="truncate">
          {quick ? "Quick chats" : repo?.name || state.projectName}
        </span>
      </span>
      <span className="text-subtle-foreground">/</span>
      <ChatMenu modal={false}>
        <ChatMenuTrigger
          id="code-chat-switcher"
          title={state.branch ? `Branch ${state.branch}` : undefined}
          className="flex h-7 min-w-0 items-center gap-2 rounded-md px-2 text-foreground-2 outline-none hover:bg-muted focus-visible:ring-1 focus-visible:ring-ring data-[state=open]:bg-muted"
        >
          {quick ? (
            <MessageSquareIcon className="size-3.5 shrink-0 text-muted-foreground" />
          ) : (
            <GitBranchIcon className="size-3.5 shrink-0 text-muted-foreground" />
          )}
          <span className="truncate">{title}</span>
          <ChevronsUpDownIcon className="size-3 shrink-0 text-muted-foreground" />
        </ChatMenuTrigger>
        <ChatMenuContent align="start" className="w-64">
          <ChatMenuLabel>{quick ? "Quick chats" : repo?.name || state.projectName}</ChatMenuLabel>
          {chats.map((chat) => (
            <ChatMenuItem
              key={chat.id}
              checked={chat.id === state.conversationId}
              onSelect={() => openChat(state.projectKey, chat.id)}
            >
              {quick ? <MessageSquareIcon /> : <GitBranchIcon />}
              <span className="min-w-0 truncate">{chat.title}</span>
            </ChatMenuItem>
          ))}
          <ChatMenuSeparator />
          <ChatMenuItem onSelect={() => void newChat()}>
            <PlusIcon />
            {quick ? "Create quick chat" : "New chat"}
          </ChatMenuItem>
        </ChatMenuContent>
      </ChatMenu>
      {state.branch && (
        <span id="code-branch" className="ml-1 min-w-0 truncate text-xs text-subtle-foreground">
          {state.branch}
        </span>
      )}
    </div>
  );
}

/** Play, spinner, or pause with a green dot: the preview's state at a glance (PS1, X5). */
export function PreviewGlyph({ phase }: { phase: PreviewPhase }) {
  if (phase === "starting" || phase === "investigating")
    return (
      <LoaderCircleIcon className="size-3.5 shrink-0 animate-spin text-muted-foreground motion-reduce:animate-none" />
    );
  if (phase === "running")
    return (
      <span className="relative flex size-3.5 shrink-0 items-center justify-center">
        <PauseIcon className="size-3.5 fill-current text-muted-foreground" />
        <span
          data-preview-dot
          className="absolute right-0 bottom-0 size-1.5 rounded-full bg-preview-running ring-1 ring-background"
        />
      </span>
    );
  return <PlayIcon className="size-3 shrink-0 fill-current text-muted-foreground" />;
}

/** "Start preview / Stop preview" split button and its menu (PS1, X5). Shared by the chat dock and the Code toolbar. */
export function PreviewButton({
  state,
  idPrefix = "code",
}: {
  state: ChatState;
  idPrefix?: string;
}) {
  const root = state.activeRoot;
  const { status, phase } = usePreview(root);
  const running = phase === "running";
  const live = running || phase === "starting";
  // The agent investigation ends with the chat's turn.
  useEffect(() => {
    if (root && !state.busy) setInvestigating(root, false);
  }, [root, state.busy]);
  const label = live ? "Stop preview" : "Start preview";
  const toggle = () => (live ? void stopPreview(state) : void startPreview(state));
  const segment =
    "flex h-6.5 items-center text-sm text-foreground-2 outline-none hover:bg-muted focus-visible:ring-1 focus-visible:ring-ring data-[state=open]:bg-muted disabled:opacity-60";
  return (
    <div
      data-preview-phase={phase}
      className="flex shrink-0 items-center rounded-md border border-edge bg-background"
    >
      <button
        type="button"
        id={`${idPrefix}-start-preview`}
        disabled={!root || phase === "investigating"}
        className={cn(segment, "gap-2.5 rounded-l-md pr-2.5 pl-2.5")}
        onClick={toggle}
      >
        <PreviewGlyph phase={phase} />
        {label}
      </button>
      <span className="h-6.5 w-px bg-edge" />
      <ChatMenu modal={false}>
        <ChatMenuTrigger
          id={`${idPrefix}-preview-menu`}
          aria-label="Preview options"
          className={cn(segment, "w-6 justify-center rounded-r-md")}
        >
          <ChevronDownIcon className="size-3 text-muted-foreground" />
        </ChatMenuTrigger>
        {/* oxlint-disable-next-line shadcn/no-restyle -- Wonder's preview split menu: 176px wide, 12px radius (PS1, X5). */}
        <ChatMenuContent align="end" className="w-44 rounded-2xl">
          <ChatMenuItem
            id={`${idPrefix}-preview-tab`}
            className="h-6.25"
            disabled={!root || !canOpenInTab(running)}
            onSelect={() => openInTab(state)}
          >
            <Maximize2Icon />
            Open in a tab
            <span className="ml-auto text-xs text-muted-foreground">⌘⌥P</span>
          </ChatMenuItem>
          {running && (
            <>
              <ChatMenuItem
                id={`${idPrefix}-preview-go`}
                className="h-6.25"
                onSelect={() => goToPreview(state)}
              >
                <AppWindowIcon />
                Go to preview
              </ChatMenuItem>
              <ChatMenuItem
                id={`${idPrefix}-preview-browser`}
                className="h-6.25"
                disabled={!status?.url}
                onSelect={() => root && openInBrowser(root)}
              >
                <SquareArrowOutUpRightIcon />
                Open in browser
              </ChatMenuItem>
            </>
          )}
          <ChatMenuSeparator />
          <ChatMenuItem
            id={`${idPrefix}-configure-preview`}
            className="h-6.25"
            disabled={!root}
            onSelect={() => root && window.previewSettings?.open(root)}
          >
            <BoltIcon />
            Preview settings
          </ChatMenuItem>
        </ChatMenuContent>
      </ChatMenu>
    </div>
  );
}

/** Status line: the latest workspace message, shown for a few seconds. */
function StatusLine({ state }: { state: ChatState }) {
  const at = state.statusAt ?? 0;
  const [expired, setExpired] = useState(0);
  useEffect(() => {
    const timer = window.setTimeout(() => setExpired(at), Math.max(0, at + 8000 - Date.now()));
    return () => window.clearTimeout(timer);
  }, [at]);
  const visible = !!state.status && expired !== at;
  return (
    <p
      id="code-status"
      aria-live="polite"
      title={state.status}
      className="min-w-0 flex-1 truncate text-xs text-muted-foreground"
    >
      {visible ? state.status : ""}
    </p>
  );
}

export function Toolbar({
  state,
  panelOpen,
  onTogglePanel,
}: {
  state: ChatState;
  panelOpen: boolean;
  onTogglePanel: () => void;
}) {
  return (
    <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border pr-2 pl-4">
      <StatusLine state={state} />
      <PreviewButton state={state} />
      <button
        type="button"
        id="code-panel-toggle"
        aria-label={panelOpen ? "Hide files and terminal" : "Show files and terminal"}
        title={panelOpen ? "Hide files and terminal" : "Show files and terminal"}
        aria-pressed={panelOpen}
        onClick={onTogglePanel}
        className={iconButton}
      >
        <PanelRightIcon className="size-4" />
      </button>
    </div>
  );
}

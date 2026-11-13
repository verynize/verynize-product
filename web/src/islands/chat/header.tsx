// Dock header (29, 33, 34): project / chat switcher on the left, "Start preview" split button on the right.
import {
  ChevronsUpDownIcon,
  FolderIcon,
  FolderOpenIcon,
  GitBranchIcon,
  GitForkIcon,
  LaptopIcon,
  MessageSquareIcon,
  ChevronLeftIcon,
} from "lucide-react";
import { PanelLeftIcon, PlusIcon } from "@/components/icons";
import { useBodyClass } from "@/lib/bridge";
import { can } from "@/lib/platform";
import { cn } from "@/lib/utils";
import {
  ChatMenu,
  ChatMenuContent,
  ChatMenuItem,
  ChatMenuLabel,
  ChatMenuSeparator,
  ChatMenuSub,
  ChatMenuSubContent,
  ChatMenuSubTrigger,
  ChatMenuTrigger,
} from "./menu";
import { ChangesButton } from "./changes-panel";
import { ChatHeaderButton, ChatIconButton } from "./controls";
import { PreviewButton } from "../code/topbar";
import { hook } from "./hooks";
import { ChatTip } from "./tip";
import { workspace, type ChatState } from "./store";

/** Parallel chats: the workspace reports which conversations are running (busyChats); switching stays enabled. */
const parallel = (state: ChatState) => Array.isArray(state.busyChats);
const running = (state: ChatState, id: string | null) =>
  !!id &&
  (parallel(state) ? state.busyChats!.includes(id) : state.busy && id === state.conversationId);

/** Small pulsing dot marking a conversation whose agent is running. */
function RunningDot({ className }: { className?: string }) {
  return (
    <span
      role="img"
      aria-label="Running"
      className={cn("relative flex size-1.5 shrink-0", className)}
    >
      <span className="absolute inset-0 animate-ping rounded-full bg-primary-text opacity-60 motion-reduce:animate-none" />
      <span className="relative size-1.5 rounded-full bg-primary-text" />
    </span>
  );
}

function ChatList({ state, createLabel }: { state: ChatState; createLabel: string }) {
  const ws = workspace();
  const locked = state.busy && !parallel(state);
  return (
    <>
      {state.conversations.map((chat) => (
        <ChatMenuItem
          key={chat.id}
          disabled={locked && chat.id !== state.conversationId}
          checked={chat.id === state.conversationId}
          onSelect={() => ws?.selectChat(chat.id)}
        >
          <MessageSquareIcon />
          <span className="min-w-0 truncate">{chat.title}</span>
          {running(state, chat.id) && (
            <RunningDot className={chat.id === state.conversationId ? "ml-auto" : "mr-1 ml-auto"} />
          )}
        </ChatMenuItem>
      ))}
      <ChatMenuSeparator />
      <ChatMenuItem disabled={locked} onSelect={() => ws?.newChat()}>
        <PlusIcon />
        {createLabel}
      </ChatMenuItem>
    </>
  );
}

function Switcher({ state }: { state: ChatState }) {
  const attached = state.projectKey !== "unattached";
  const title = state.conversations.find((c) => c.id === state.conversationId)?.title || "New chat";
  const elsewhere = (state.busyChats ?? []).filter((id) => id !== state.conversationId).length;
  return (
    <ChatMenu modal={false}>
      <div className="flex min-w-0 items-center gap-1 text-base leading-5.25">
        {attached && (
          <>
            <span className="flex min-w-0 shrink items-center gap-2 px-1.5 text-foreground-3">
              <FolderIcon className="size-3.5 shrink-0" />
              <span className="truncate">{state.projectName}</span>
            </span>
            <span className="text-subtle-foreground">/</span>
          </>
        )}
        <ChatMenuTrigger asChild>
          <ChatHeaderButton id="chat-switcher" className="h-7 min-w-0 shrink justify-start">
            {attached ? (
              <GitBranchIcon className="size-3.5 shrink-0 text-muted-foreground" />
            ) : (
              <MessageSquareIcon className="size-3.5 shrink-0 text-muted-foreground" />
            )}
            <span className="truncate">{title}</span>
            {elsewhere > 0 && (
              <span
                title={`${elsewhere} other ${elsewhere === 1 ? "chat is" : "chats are"} running`}
                className="flex"
              >
                <RunningDot />
              </span>
            )}
            <ChevronsUpDownIcon className="size-3 shrink-0 text-muted-foreground" />
          </ChatHeaderButton>
        </ChatMenuTrigger>
      </div>
      <ChatMenuContent align="start" className="w-56">
        {!attached ? (
          <ChatMenuSub>
            <ChatMenuSubTrigger>
              <MessageSquareIcon />
              Quick chats
            </ChatMenuSubTrigger>
            <ChatMenuSubContent className="w-60">
              <ChatList state={state} createLabel="Create quick chat" />
            </ChatMenuSubContent>
          </ChatMenuSub>
        ) : (
          <ChatMenuItem onSelect={() => workspace()?.openProject()}>
            <FolderOpenIcon />
            Open in Code workspace
          </ChatMenuItem>
        )}
        {/* Repositories and worktrees are desktop-only (the `git` capability); the web chat has its chats only. */}
        {can("git") && (
          <>
            <ChatMenuSeparator />
            <ChatMenuLabel>Repositories</ChatMenuLabel>
            {attached && (
              <ChatMenuSub>
                <ChatMenuSubTrigger>
                  <FolderIcon />
                  <span className="min-w-0 truncate">{state.projectName}</span>
                </ChatMenuSubTrigger>
                <ChatMenuSubContent className="w-60">
                  <ChatList state={state} createLabel="New chat" />
                </ChatMenuSubContent>
              </ChatMenuSub>
            )}
            {attached && <ChatMenuSeparator />}
            <ChatMenuItem onSelect={() => void window.codeWorkspace?.addRepository("new")}>
              <PlusIcon />
              Create new repository
            </ChatMenuItem>
            <ChatMenuItem onSelect={() => void window.codeWorkspace?.addRepository("clone")}>
              <GitForkIcon />
              Start from GitHub
            </ChatMenuItem>
            <ChatMenuItem onSelect={() => void window.codeWorkspace?.addRepository("local")}>
              <LaptopIcon />
              Start from local folder
            </ChatMenuItem>
          </>
        )}
      </ChatMenuContent>
    </ChatMenu>
  );
}

export function DockHeader({ state }: { state: ChatState }) {
  const attached = state.projectKey !== "unattached";
  // With the repositories / chats sidebar open (code/design-sidebar.tsx) the dock sits right of it: no traffic-light inset.
  const sidebarOpen = useBodyClass("chat-sidebar-open") && !state.codeMode;
  return (
    <>
      {/* Top row shares the window title bar (chrome island leaves the left --chat-dock-width to the dock): traffic-light inset. */}
      <div
        className={cn(
          hook.drag,
          "flex h-10 shrink-0 items-center gap-1 border-b border-border bg-settings pr-1.5",
          sidebarOpen ? "pl-1.5" : "pl-traffic",
        )}
      >
        {!sidebarOpen && can("projects") && (
          <ChatTip label="Show sidebar" side="bottom">
            <ChatIconButton
              aria-label="Show sidebar"
              onClick={() => document.body.classList.add("chat-sidebar-open")}
            >
              <PanelLeftIcon className="size-4" />
            </ChatIconButton>
          </ChatTip>
        )}
        <Switcher state={state} />
        <span className="flex-1" />
        <ChatTip label="Hide chat" side="bottom">
          <ChatIconButton aria-label="Hide chat" onClick={() => workspace()?.closeChat()}>
            <ChevronLeftIcon className="size-3" />
          </ChatIconButton>
        </ChatTip>
      </div>
      {/* In Code mode the Changes button lives in the code workspace's files panel (ids must stay unique). */}
      {attached && !state.codeMode && (
        <div className="flex h-10 shrink-0 items-center justify-between gap-2 border-b border-border bg-settings pr-2 pl-1.5">
          <ChangesButton state={state} />
          <span className="flex-1" />
          <PreviewButton state={state} idPrefix="chat" />
        </div>
      )}
    </>
  );
}

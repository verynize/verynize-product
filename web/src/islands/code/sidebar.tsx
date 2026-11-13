// Code workspace sidebar (Wonder 80/81, code mode): new chat, repositories with their chats, quick chats,
// "Next steps" checklist and the profile footer.
import { useState, type ReactNode } from "react";
import {
  ArchiveIcon,
  ChevronDownIcon,
  CircleCheckIcon,
  CircleHelpIcon,
  CircleIcon,
  EllipsisIcon,
  FolderIcon,
  FolderOpenIcon,
  FolderPlusIcon,
  GitBranchIcon,
  GitForkIcon,
  LaptopIcon,
  MessageSquareIcon,
  SettingsIcon,
  SquarePenIcon,
  XIcon,
} from "lucide-react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { PlusIcon } from "@/components/icons";
import { openSharePopover } from "../share/api";
import { cn, textOf } from "@/lib/utils";
import {
  ChatMenu,
  ChatMenuContent,
  ChatMenuItem,
  ChatMenuSeparator,
  ChatMenuTrigger,
} from "../chat/menu";
import type { ChatState, ChatSummary } from "../chat/store";
import { workspace, type Repository } from "./api";
import { usePreference } from "../settings/preference-store";
import {
  addRepository,
  archiveChat,
  archiveRepository,
  chatFolder,
  newChat,
  newQuickChat,
  openChat,
  openRepository,
  QUICK,
  useRepositories,
} from "./controller";
import { openMemory } from "./editor-state";
import { useLineStats, type LineStat } from "./line-stats";
import { useNextSteps } from "./next-steps";

const iconButton =
  "flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-muted hover:text-foreground-2 focus-visible:ring-1 focus-visible:ring-ring data-[state=open]:bg-muted data-[state=open]:text-foreground-2";
const row =
  "group/row relative flex h-7.5 w-full min-w-0 items-center gap-2 rounded-lg pr-1 text-sm text-foreground-2 outline-none hover:bg-muted focus-visible:ring-1 focus-visible:ring-ring";

type MenuEntry = {
  id?: string;
  label: string;
  icon: ReactNode;
  run: () => void;
  separator?: boolean;
};

/** The same entries as a "…" dropdown and as a right-click context menu. */
function RowMenus({
  label,
  entries,
  children,
}: {
  label: string;
  entries: MenuEntry[];
  children: ReactNode;
}) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div className="relative">
          {children}
          <ChatMenu modal={false}>
            <ChatMenuTrigger
              aria-label={`${label} actions`}
              className={cn(
                iconButton,
                "absolute top-0.75 right-1 opacity-0 group-hover/rows:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100",
              )}
            >
              <EllipsisIcon className="size-3.5" />
            </ChatMenuTrigger>
            <ChatMenuContent align="start" className="w-56">
              {entries.map((entry) => (
                <MenuEntryItem key={entry.label} entry={entry} />
              ))}
            </ChatMenuContent>
          </ChatMenu>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-56">
        {entries.map((entry) => (
          <span key={entry.label} className="contents">
            {entry.separator && <ContextMenuSeparator />}
            <ContextMenuItem onSelect={entry.run}>
              {entry.icon}
              {entry.label}
            </ContextMenuItem>
          </span>
        ))}
      </ContextMenuContent>
    </ContextMenu>
  );
}

function MenuEntryItem({ entry }: { entry: MenuEntry }) {
  return (
    <>
      {entry.separator && <ChatMenuSeparator />}
      <ChatMenuItem id={entry.id} onSelect={entry.run}>
        {entry.icon}
        {entry.label}
      </ChatMenuItem>
    </>
  );
}

function RunningDot() {
  return (
    <span role="img" aria-label="Running" className="relative ml-auto flex size-1.5 shrink-0">
      <span className="absolute inset-0 animate-ping rounded-full bg-primary-text opacity-60 motion-reduce:animate-none" />
      <span className="relative size-1.5 rounded-full bg-primary-text" />
    </span>
  );
}

function LineChanges({ stat }: { stat?: LineStat }) {
  if (!stat || (!stat.added && !stat.removed)) return null;
  return (
    <span
      data-line-changes
      className="flex shrink-0 items-center gap-1 text-xs tabular-nums"
      title={`${stat.files} ${stat.files === 1 ? "file" : "files"} changed`}
    >
      <span className="text-diff-add">+{stat.added}</span>
      <span className="text-diff-remove">−{stat.removed}</span>
    </span>
  );
}

function ChatRow({
  chat,
  chatKey,
  active,
  quick,
  stat,
  tabs = 1,
}: {
  chat: ChatSummary;
  chatKey: string;
  active: boolean;
  quick: boolean;
  stat?: LineStat;
  /** Chats sharing this worktree when chat tabs are on (the row stands for all of them). */
  tabs?: number;
}) {
  const entries: MenuEntry[] = [
    { label: "Open chat", icon: <MessageSquareIcon />, run: () => openChat(chatKey, chat.id) },
    {
      label: "Archive chat",
      icon: <ArchiveIcon />,
      run: () => void archiveChat(chatKey, chat.id),
      separator: true,
    },
  ];
  return (
    <li className="group/rows">
      <RowMenus label={chat.title} entries={entries}>
        <button
          type="button"
          data-chat-id={chat.id}
          aria-current={active ? "true" : undefined}
          title={chat.branch ? `${chat.title} · ${chat.branch}` : chat.title}
          onClick={() => openChat(chatKey, chat.id)}
          className={cn(row, "pl-7", active && "bg-input text-foreground hover:bg-input")}
        >
          {quick ? (
            <MessageSquareIcon className="size-3.5 shrink-0 text-muted-foreground" />
          ) : (
            <GitBranchIcon
              className={cn(
                "size-3.5 shrink-0",
                active ? "text-primary-text" : "text-muted-foreground",
              )}
            />
          )}
          <span className="min-w-0 flex-1 truncate text-left">{chat.title}</span>
          <LineChanges stat={stat} />
          {tabs > 1 && (
            <span
              data-tab-count={tabs}
              title={`${tabs} tabs`}
              className="shrink-0 rounded-sm bg-muted px-1 text-xs text-muted-foreground tabular-nums"
            >
              {tabs}
            </span>
          )}
          {chat.busy && <RunningDot />}
        </button>
      </RowMenus>
    </li>
  );
}

function RepositoryGroup({ repo, state }: { repo: Repository; state: ChatState }) {
  const ws = workspace();
  const chats = ws?.chatSummaries?.(repo.root) ?? [];
  const current = state.projectKey === repo.root;
  const actions = ws?.actions;
  const chatTabs = usePreference("chatTabs") === true;
  const lineChanges = usePreference("lineChanges") === true;
  const stats = useLineStats(
    chats.map((chat) => chatFolder(chat, repo.root)),
    lineChanges,
  );
  const activeId = current ? state.conversationId : null;
  // Chat tabs: one row per worktree, standing for the open (else most recent) chat in it.
  const rows: { chat: ChatSummary; tabs: number; busy: boolean }[] = [];
  if (chatTabs) {
    const groups = new Map<string, ChatSummary[]>();
    for (const chat of chats) {
      const folder = chatFolder(chat, repo.root);
      groups.set(folder, [...(groups.get(folder) ?? []), chat]);
    }
    for (const group of groups.values()) {
      const shown = group.find((c) => c.id === activeId) ?? group[0];
      rows.push({ chat: shown, tabs: group.length, busy: group.some((c) => c.busy) });
    }
  } else rows.push(...chats.map((chat) => ({ chat, tabs: 1, busy: !!chat.busy })));
  const entries: MenuEntry[] = [
    { label: "New chat", icon: <SquarePenIcon />, run: () => void newChat(repo) },
    {
      label: "Project memory",
      icon: <FolderOpenIcon />,
      run: () => void openRepositoryThen(repo, openMemory),
      separator: true,
    },
    {
      label: "Git status",
      icon: <GitBranchIcon />,
      run: () => void openRepositoryThen(repo, () => actions?.gitStatus?.()),
    },
    {
      label: "Create worktree…",
      icon: <GitForkIcon />,
      run: () => void openRepositoryThen(repo, () => actions?.createWorktree?.()),
    },
    {
      label: "Open design…",
      icon: <FolderOpenIcon />,
      run: () => actions?.openDesign?.(),
      separator: true,
    },
    { label: "Save design", icon: <FolderIcon />, run: () => actions?.saveDesign?.() },
    {
      label: "Remove from list",
      icon: <ArchiveIcon />,
      run: () => void archiveRepository(repo),
      separator: true,
    },
  ];
  return (
    <li data-repository={repo.name} className="flex flex-col">
      <div className="group/rows">
        <RowMenus label={repo.name} entries={entries}>
          <button
            type="button"
            title={repo.root}
            onClick={() => void openRepository(repo)}
            className={cn(row, "pl-2", current && "text-foreground")}
          >
            <FolderIcon className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate text-left">{repo.name}</span>
          </button>
        </RowMenus>
      </div>
      {chats.length > 0 && (
        <ul aria-label={`${repo.name} chats`} className="m-0 flex list-none flex-col p-0">
          {rows.map(({ chat, tabs, busy }) => (
            <ChatRow
              key={chat.id}
              chat={busy && !chat.busy ? { ...chat, busy } : chat}
              chatKey={repo.root}
              active={chat.id === activeId}
              quick={false}
              stat={lineChanges ? stats[chatFolder(chat, repo.root)] : undefined}
              tabs={tabs}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

async function openRepositoryThen(repo: Repository, then: () => void) {
  if (workspace()?.getState().projectKey !== repo.root) await openRepository(repo);
  then();
}

function AddRepositoryMenu() {
  return (
    <ChatMenu modal={false}>
      <ChatMenuTrigger
        id="code-add-repository"
        aria-label="Add repository"
        title="Add repository"
        className={iconButton}
      >
        <FolderPlusIcon className="size-3.5" />
      </ChatMenuTrigger>
      <ChatMenuContent align="start" className="w-56">
        <ChatMenuItem id="project-new" onSelect={() => void addRepository("new")}>
          <PlusIcon />
          Create new repository
        </ChatMenuItem>
        <ChatMenuItem id="project-clone" onSelect={() => void addRepository("clone")}>
          <GitForkIcon />
          Start from GitHub
        </ChatMenuItem>
        <ChatMenuItem id="project-open" onSelect={() => void addRepository("local")}>
          <LaptopIcon />
          Start from local folder
        </ChatMenuItem>
      </ChatMenuContent>
    </ChatMenu>
  );
}

function NextSteps({ connected }: { connected: boolean }) {
  const steps = useNextSteps();
  if (steps.dismissed) return null;
  const items: { id: string; label: string; done: boolean; run: () => void }[] = [
    {
      id: "connect",
      label: "Connect a repository",
      done: connected,
      run: () => void addRepository("local"),
    },
    {
      id: "invite",
      label: "Invite a teammate",
      done: steps.invited,
      run: () => {
        steps.mark("invited");
        workspace()?.setCodeMode?.(false);
        requestAnimationFrame(openSharePopover);
      },
    },
    {
      id: "publish",
      label: "Publish a Preview",
      done: steps.published,
      run: () => document.getElementById("code-start-preview")?.click(),
    },
  ];
  return (
    <section
      aria-labelledby="code-next-steps-title"
      id="code-next-steps"
      className="mx-3 mb-3 shrink-0 rounded-xl border border-border bg-code-raised"
    >
      <div className="flex flex-col gap-1 px-3 pt-2.5 pb-2.5">
        <div className="flex items-center justify-between">
          <h2 id="code-next-steps-title" className="text-sm font-medium text-foreground">
            Next steps
          </h2>
          <button
            type="button"
            aria-label="Dismiss next steps"
            className={cn(iconButton, "-mr-1 size-5")}
            onClick={() => steps.mark("dismissed")}
          >
            <XIcon className="size-3" />
          </button>
        </div>
        <p className="text-xs text-muted-foreground">
          A few next steps to get started with Verynize.
        </p>
      </div>
      <ul className="m-0 flex list-none flex-col border-t border-border p-1">
        {items.map((item) => (
          <li key={item.id}>
            <button
              type="button"
              data-step={item.id}
              data-done={item.done ? "true" : undefined}
              onClick={item.run}
              className="flex h-7 w-full items-center gap-2.5 rounded-md px-2 text-xs text-foreground-2 outline-none hover:bg-muted focus-visible:ring-1 focus-visible:ring-ring"
            >
              {item.done ? (
                <CircleCheckIcon aria-label="Done" className="size-3.5 shrink-0 text-success" />
              ) : (
                <CircleIcon className="size-3.5 shrink-0 text-muted-foreground" />
              )}
              <span className={cn("truncate", item.done && "text-muted-foreground line-through")}>
                {item.label}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Footer() {
  const name = textOf(window.appPreferences?.get?.().displayName || "You");
  return (
    <div
      id="code-profile"
      className="m-0 flex h-11 shrink-0 items-center gap-2 border-t border-border p-0 pr-2 pl-3"
    >
      <span
        aria-hidden="true"
        className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary-tint text-xs font-medium text-primary-text"
      >
        {name.trim().charAt(0).toUpperCase() || "?"}
      </span>
      <span className="min-w-0 flex-1 truncate text-sm text-foreground-2">{name}</span>
      <Popover>
        <PopoverTrigger asChild>
          <button type="button" aria-label="Help" title="Help" className={iconButton}>
            <CircleHelpIcon className="size-3.5" />
          </button>
        </PopoverTrigger>
        <PopoverContent side="top" align="end" className="w-64">
          <p className="mb-1 text-foreground">Code workspace</p>
          <ul className="m-0 flex list-none flex-col gap-1 p-0 text-muted-foreground">
            <li>Each repository chat works in its own git worktree and branch.</li>
            <li>⌘L focuses the composer · ⌘B toggles this sidebar.</li>
            <li>Right-click a repository or chat for more actions.</li>
          </ul>
        </PopoverContent>
      </Popover>
      <button
        type="button"
        aria-label="Settings"
        title="Settings"
        className={iconButton}
        onClick={() => window.appSettings?.open()}
      >
        <SettingsIcon className="size-3.5" />
      </button>
    </div>
  );
}

export function CodeSidebar({ state }: { state: ChatState }) {
  const { repositories, pending } = useRepositories();
  const [reposOpen, setReposOpen] = useState(true);
  const quickChats = workspace()?.chatSummaries?.(QUICK) ?? [];
  const inQuick = state.projectKey === QUICK;
  return (
    <aside
      id="code-sidebar"
      aria-label="Repositories and chats"
      className="m-0 flex w-code-sidebar shrink-0 flex-col border-r border-border bg-code-sidebar p-0 pt-chrome"
    >
      <div className="shrink-0 px-3 pt-1.5">
        <button
          type="button"
          id="code-new-chat"
          disabled={pending}
          onClick={() => void newChat()}
          className="flex h-7.5 w-full items-center gap-2 rounded-lg border border-border bg-code-raised px-2.5 text-sm text-foreground outline-none hover:bg-muted focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-60"
        >
          <SquarePenIcon className="size-3.5 text-foreground-3" />
          Create new chat
        </button>
      </div>
      <nav
        aria-label="Chats"
        className="mt-3 flex min-h-0 flex-1 flex-col overflow-y-auto px-2 pb-3"
      >
        <div className="flex h-7 shrink-0 items-center gap-1 pr-1 pl-1">
          <button
            type="button"
            aria-expanded={reposOpen}
            onClick={() => setReposOpen((open) => !open)}
            className="flex h-6 items-center gap-1 rounded-md px-1 text-xs text-muted-foreground outline-none hover:text-foreground-2 focus-visible:ring-1 focus-visible:ring-ring"
          >
            Repositories
            <ChevronDownIcon
              className={cn(
                "size-3 transition-transform motion-reduce:transition-none",
                !reposOpen && "-rotate-90",
              )}
            />
          </button>
          <span className="flex-1" />
          <button
            type="button"
            aria-label="Archive current chat"
            title="Archive current chat"
            disabled={!state.conversationId}
            className={cn(iconButton, "disabled:opacity-40")}
            onClick={() =>
              state.conversationId && void archiveChat(state.projectKey, state.conversationId)
            }
          >
            <ArchiveIcon className="size-3.5" />
          </button>
          <AddRepositoryMenu />
        </div>
        {reposOpen && (
          <ul aria-label="Repositories" className="m-0 mt-1 flex list-none flex-col gap-1.5 p-0">
            {repositories.map((repo) => (
              <RepositoryGroup key={repo.id} repo={repo} state={state} />
            ))}
            {!repositories.length && (
              <li className="px-2 py-1 text-xs text-subtle-foreground">
                Add a repository to work on code with an agent.
              </li>
            )}
          </ul>
        )}
        <div className="mt-2.5 flex flex-col">
          <div className={cn(row, "pl-2 hover:bg-transparent")}>
            <FolderIcon className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="truncate">Quick chats</span>
          </div>
          <ul aria-label="Quick chats" className="m-0 flex list-none flex-col p-0">
            {quickChats.map((chat) => (
              <ChatRow
                key={chat.id}
                chat={chat}
                chatKey={QUICK}
                active={inQuick && chat.id === state.conversationId}
                quick
              />
            ))}
            <li>
              <button
                type="button"
                id="code-new-quick-chat"
                onClick={() => void newQuickChat()}
                className={cn(row, "pl-7 text-muted-foreground")}
              >
                <PlusIcon className="size-3.5 shrink-0" />
                <span className="truncate">Create quick chat</span>
              </button>
            </li>
          </ul>
        </div>
      </nav>
      <NextSteps connected={repositories.length > 0} />
      <Footer />
    </aside>
  );
}

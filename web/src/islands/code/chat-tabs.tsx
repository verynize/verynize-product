// "Chat tabs" preference: the chats that share the current chat's worktree, as tabs above the transcript.
// "+" opens another chat in the same worktree (same folder and branch, no new worktree).
import { XIcon } from "lucide-react";
import { PlusIcon } from "@/components/icons";
import { cn } from "@/lib/utils";
import type { ChatState } from "../chat/store";
import { usePreference } from "../settings/preference-store";
import { workspace } from "./api";
import { archiveChat, chatFolder, newTab, openChat, QUICK, repositoryByKey } from "./controller";

export function ChatTabs({ state }: { state: ChatState }) {
  const enabled = usePreference("chatTabs") === true;
  const key = state.projectKey;
  if (!enabled || key === QUICK || !repositoryByKey(key) || !state.conversationId) return null;
  const chats = workspace()?.chatSummaries?.(key) ?? [];
  const current = chats.find((c) => c.id === state.conversationId);
  if (!current) return null;
  const folder = chatFolder(current, key);
  // Oldest first, like opening tabs left to right.
  const tabs = chats.filter((c) => chatFolder(c, key) === folder).reverse();
  return (
    <div
      id="code-chat-tabs"
      role="tablist"
      aria-label="Chats in this worktree"
      className="flex h-9 shrink-0 items-center gap-1 overflow-x-auto border-b border-border px-2"
    >
      {tabs.map((chat) => {
        const active = chat.id === current.id;
        return (
          <div
            key={chat.id}
            className={cn(
              "group/tab flex h-7 max-w-48 min-w-0 shrink-0 items-center rounded-md text-sm",
              active
                ? "bg-input text-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground-2",
            )}
          >
            <button
              type="button"
              role="tab"
              aria-selected={active}
              data-chat-tab={chat.id}
              title={chat.title}
              onClick={() => !active && openChat(key, chat.id)}
              className="flex h-full min-w-0 items-center gap-1.5 rounded-md pr-1 pl-2.5 outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <span className="truncate">{chat.title}</span>
              {chat.busy && (
                <span
                  aria-label="Running"
                  role="img"
                  className="size-1.5 shrink-0 rounded-full bg-primary-text"
                />
              )}
            </button>
            {tabs.length > 1 && (
              <button
                type="button"
                aria-label={`Archive ${chat.title}`}
                title="Archive chat"
                onClick={() => void archiveChat(key, chat.id)}
                className={cn(
                  "mr-1 flex size-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring",
                  !active && "opacity-0 group-hover/tab:opacity-100 focus-visible:opacity-100",
                )}
              >
                <XIcon className="size-3" />
              </button>
            )}
          </div>
        );
      })}
      <button
        type="button"
        id="code-new-tab"
        aria-label="New tab in this worktree"
        title="New tab in this worktree"
        onClick={() => void newTab()}
        className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-muted hover:text-foreground-2 focus-visible:ring-1 focus-visible:ring-ring"
      >
        <PlusIcon className="size-3.5" />
      </button>
    </div>
  );
}

/* oxlint-disable shadcn/no-restyle -- Wonder chat density (13px text, 24px rows, chat menu surface) applied to the shared
   shadcn parts in one place per file, like the local wrappers in ./menu.tsx. */
// Slash commands ("Runs in this chat", Wonder): typing "/" at the start of a word in the prompt (or "+ › Commands")
// opens a shadcn Command list above the composer, filtered as you type. ↑↓ move, Enter / Tab choose, Esc closes. Agent
// commands and skills stay in the text as "/name", drawn as a badge (sending passes "/name …" to the agent, which runs
// it); Verynize's own
// commands run right away. Keys are read on the adopted #project-prompt in the capture phase, like the @ popover.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { MessageSquareIcon } from "lucide-react";
import type { ComponentProps } from "react";
import { Command, CommandEmpty, CommandItem, CommandList } from "@/components/ui/command";
import { cn } from "@/lib/utils";
import {
  BUILTIN_COMMANDS,
  OPEN_COMMANDS_EVENT,
  loadAgentCommands,
  rememberCommand,
  setPrompt,
  type AgentCommand,
  type BuiltinCommand,
} from "./composer-actions";
import type { ChatState } from "./store";

/** "/query" typed at the start of a word, caret still inside the command name. */
const TOKEN = /(?:^|\s)\/([^\s/]*)$/;
type Entry = AgentCommand & { run?: BuiltinCommand["run"] };

function rank(entry: Entry, query: string) {
  if (!query) return 0;
  const name = entry.name.toLowerCase();
  if (name.startsWith(query)) return 0;
  if (name.includes(query)) return 1;
  if (entry.description.toLowerCase().includes(query)) return 2;
  return -1;
}

// Chat density (13px text, 24px rows, the chat menu surface) on the shared shadcn Command parts.
function Surface({ className, ...props }: ComponentProps<typeof Command>) {
  return (
    <Command
      className={cn(
        "h-auto rounded-xl border border-card-border bg-background p-1 text-sm text-foreground-2 shadow-menu",
        className,
      )}
      {...props}
    />
  );
}
function Empty({ className, ...props }: ComponentProps<typeof CommandEmpty>) {
  return (
    <CommandEmpty
      className={cn("flex h-6 items-center px-2 py-0 text-sm text-subtle-foreground", className)}
      {...props}
    />
  );
}
function Row({ className, ...props }: ComponentProps<typeof CommandItem>) {
  return (
    <CommandItem
      className={cn(
        "h-6 gap-1.5 text-sm text-foreground data-[selected=true]:bg-muted data-[selected=true]:text-foreground",
        className,
      )}
      {...props}
    />
  );
}

export function SlashCommands({ state }: { state: ChatState }) {
  const [query, setQuery] = useState<string | null>(null);
  const [agentCommands, setAgentCommands] = useState<AgentCommand[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const agent = state.defaults.agent;
  const root = state.chatRoot;
  const open = query !== null;

  // Load the agent's commands whenever the list opens (cached briefly in composer-actions).
  useEffect(() => {
    if (!open) return;
    let live = true;
    setLoading(true);
    void loadAgentCommands(agent, root).then((list) => {
      if (!live) return;
      setAgentCommands(list);
      setLoading(false);
    });
    return () => {
      live = false;
    };
  }, [open, agent, root]);

  const entries = useMemo(() => {
    if (query === null) return [];
    const q = query.toLowerCase();
    const builtins = BUILTIN_COMMANDS.filter((c) => !c.when || c.when());
    const names = new Set(builtins.map((c) => c.name));
    const all: Entry[] = [...builtins, ...agentCommands.filter((c) => !names.has(c.name))];
    return all
      .map((entry) => ({ entry, score: rank(entry, q) }))
      .filter((item) => item.score >= 0)
      .sort((a, b) => a.score - b.score || a.entry.name.localeCompare(b.entry.name))
      .map((item) => item.entry);
  }, [query, agentCommands]);

  const live = useRef({ entries, selected, open });
  useLayoutEffect(() => {
    live.current = { entries, selected, open };
  });

  // Keep the highlighted row valid as the list filters.
  useEffect(() => {
    if (!entries.length) return;
    if (!entries.some((e) => e.name === selected)) setSelected(entries[0].name);
  }, [entries, selected]);

  useEffect(() => {
    listRef.current?.querySelector('[data-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  useEffect(() => {
    const prompt = document.getElementById("project-prompt") as HTMLTextAreaElement | null;
    if (!prompt) return;
    let dismissedAt: string | null = null;
    let forced = false;
    const close = () => {
      forced = false;
      setQuery(null);
      prompt.setAttribute("aria-expanded", "false");
      prompt.removeAttribute("aria-activedescendant");
    };
    const update = () => {
      const caret = prompt.selectionStart ?? prompt.value.length;
      const found =
        prompt.selectionStart === prompt.selectionEnd
          ? prompt.value.slice(0, caret).match(TOKEN)
          : null;
      if (!found) {
        dismissedAt = null;
        if (forced && !prompt.value.startsWith("/")) return;
        return close();
      }
      forced = false;
      if (dismissedAt === found[0]) return;
      dismissedAt = null;
      setQuery(found[1]);
      prompt.setAttribute("aria-expanded", "true");
    };
    const choose = (entry: Entry | undefined) => {
      if (!entry) return;
      // The typed "/query" token is replaced in place; opened from the + menu (no token), the command goes first.
      const value = prompt.value;
      const caret = prompt.selectionStart ?? value.length;
      const found = value.slice(0, caret).match(TOKEN);
      const start = found ? caret - found[1].length - 1 : 0;
      const end = found ? caret + (value.slice(caret).match(/^\S*/)?.[0].length ?? 0) : 0;
      const before = value.slice(0, start);
      const after = value.slice(end);
      close();
      if (entry.run) {
        const rest = found ? after.replace(/^ /, "") : after;
        setPrompt(before + rest, start);
        entry.run(found ? rest.trim() : "");
        return;
      }
      rememberCommand(entry.name);
      const token = `/${entry.name}${after.startsWith(" ") ? "" : " "}`;
      setPrompt(before + token + after, start + token.length);
    };
    const onKey = (event: KeyboardEvent) => {
      const { entries: list, selected: current, open: isOpen } = live.current;
      if (!isOpen) return;
      const stop = () => {
        event.preventDefault();
        event.stopImmediatePropagation();
      };
      const index = Math.max(
        0,
        list.findIndex((e) => e.name === current),
      );
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        if (!list.length) return;
        stop();
        setSelected(
          list[(index + (event.key === "ArrowDown" ? 1 : list.length - 1)) % list.length].name,
        );
      } else if (
        (event.key === "Enter" || event.key === "Tab") &&
        !event.shiftKey &&
        !event.metaKey &&
        !event.ctrlKey &&
        list.length
      ) {
        stop();
        choose(list[index]);
      } else if (event.key === "Escape") {
        stop();
        const found = prompt.value.slice(0, prompt.selectionStart ?? 0).match(TOKEN);
        dismissedAt = found ? found[0] : null;
        close();
      }
    };
    const onPick = (event: Event) => choose((event as CustomEvent<Entry>).detail);
    const onOpen = () => {
      // "+ › Commands": an empty prompt gets a "/" so typing filters; otherwise the list opens over the text.
      if (!prompt.value.trim()) {
        setPrompt("/");
        return;
      }
      forced = true;
      setQuery("");
      prompt.focus();
      prompt.setAttribute("aria-expanded", "true");
    };
    let blurTimer = 0;
    const onBlur = () => {
      window.clearTimeout(blurTimer);
      blurTimer = window.setTimeout(() => document.activeElement !== prompt && close(), 120);
    };
    prompt.setAttribute("aria-haspopup", "listbox");
    prompt.addEventListener("input", update);
    prompt.addEventListener("click", update);
    prompt.addEventListener("keydown", onKey, true);
    prompt.addEventListener("blur", onBlur);
    prompt.addEventListener("bd-slash-pick", onPick);
    window.addEventListener(OPEN_COMMANDS_EVENT, onOpen);
    update();
    return () => {
      window.clearTimeout(blurTimer);
      prompt.removeEventListener("input", update);
      prompt.removeEventListener("click", update);
      prompt.removeEventListener("keydown", onKey, true);
      prompt.removeEventListener("blur", onBlur);
      prompt.removeEventListener("bd-slash-pick", onPick);
      window.removeEventListener(OPEN_COMMANDS_EVENT, onOpen);
    };
  }, []);

  if (!open) return null;
  const pick = (entry: Entry) =>
    document
      .getElementById("project-prompt")
      ?.dispatchEvent(new CustomEvent("bd-slash-pick", { detail: entry }));
  return (
    <Surface
      id="chat-slash-commands"
      shouldFilter={false}
      value={selected}
      onValueChange={setSelected}
      className="absolute inset-x-0 bottom-full z-40 mb-1.5"
    >
      <p className="flex h-6 items-center px-2 text-muted-foreground">Runs in this chat</p>
      <CommandList
        ref={listRef}
        id="chat-slash-list"
        aria-label="Slash commands"
        className="max-h-72"
      >
        <Empty>{loading ? "Loading commands…" : "No matching commands"}</Empty>
        {entries.map((entry) => (
          <Row
            key={entry.name}
            value={entry.name}
            data-command={entry.name}
            data-source={entry.source}
            onMouseDown={(event) => event.preventDefault()}
            onSelect={() => pick(entry)}
          >
            <span className="shrink-0">/{entry.name}</span>
            <span className="ml-auto min-w-0 truncate text-muted-foreground">
              {[entry.argumentHint, entry.description].filter(Boolean).join(" · ")}
            </span>
            <MessageSquareIcon className="ml-1 size-3.5 text-muted-foreground" aria-hidden="true" />
          </Row>
        ))}
      </CommandList>
    </Surface>
  );
}

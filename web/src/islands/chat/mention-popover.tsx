// "@" mentions: typing @ in the composer opens a list of canvas elements (workspace.searchElements); Enter / Tab
// turns the token into a mention chip (workspace.addMention). Listens on the adopted #project-prompt directly, in the
// capture phase, so Enter/Escape never reach the legacy handlers while the list is open.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  BoxIcon,
  FrameIcon,
  ImageIcon,
  SparklesIcon,
  SquareIcon,
  TargetIcon,
  TypeIcon,
} from "lucide-react";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { legacySet } from "@/lib/bridge";
import { cn } from "@/lib/utils";
import { hook } from "./hooks";
import { workspace, type ChatMention } from "./store";

const TOKEN = /(?:^|\s)@([^\s@]{0,40})$/;

export function MentionIcon({ type, className }: { type?: string; className?: string }) {
  // A DOM element picked in a live preview's Edit mode (Wonder PM5): purple target.
  if (type === "element")
    return <TargetIcon className={cn("size-3.5 shrink-0 text-primary-text", className)} />;
  const Icon =
    type === "frame"
      ? FrameIcon
      : type === "text"
        ? TypeIcon
        : type === "image"
          ? ImageIcon
          : type === "shader"
            ? SparklesIcon
            : type === "rectangle"
              ? SquareIcon
              : BoxIcon;
  return <Icon className={cn("size-3.5 shrink-0 text-muted-foreground", className)} />;
}

type Match = { start: number; end: number; query: string };

export function MentionPopover() {
  const [match, setMatch] = useState<Match | null>(null);
  const [items, setItems] = useState<ChatMention[]>([]);
  const [active, setActive] = useState(0);
  const live = useRef({ match, items, active });
  useLayoutEffect(() => {
    live.current = { match, items, active };
  });
  const dismissed = useRef<number | null>(null);

  useEffect(() => {
    const prompt = document.getElementById("project-prompt") as HTMLTextAreaElement | null;
    if (!prompt) return;
    const close = () => {
      setMatch(null);
      setItems([]);
      prompt.removeAttribute("aria-activedescendant");
      prompt.setAttribute("aria-expanded", "false");
    };
    const update = () => {
      // Feature-detected per keystroke: the workspace may gain searchElements after mount.
      if (!workspace()?.searchElements) return close();
      const caret = prompt.selectionStart ?? prompt.value.length;
      const found =
        prompt.selectionStart === prompt.selectionEnd
          ? prompt.value.slice(0, caret).match(TOKEN)
          : null;
      if (!found) {
        dismissed.current = null;
        return close();
      }
      const start = caret - found[1].length - 1;
      if (dismissed.current === start) return close();
      let results: ChatMention[] = [];
      try {
        results = (workspace()?.searchElements?.(found[1]) ?? []).slice(0, 8);
      } catch {
        results = [];
      }
      setMatch({ start, end: caret, query: found[1] });
      setItems(results);
      setActive(0);
      prompt.setAttribute("aria-expanded", "true");
    };
    const choose = (item: ChatMention) => {
      const m = live.current.match;
      if (!m) return;
      const value = prompt.value.slice(0, m.start) + prompt.value.slice(m.end);
      legacySet(prompt, value);
      prompt.setSelectionRange(m.start, m.start);
      workspace()?.addMention?.(item);
      close();
    };
    const onKey = (event: KeyboardEvent) => {
      const { match: m, items: list, active: index } = live.current;
      if (!m) return;
      const stop = () => {
        event.preventDefault();
        event.stopImmediatePropagation();
      };
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        if (!list.length) return;
        stop();
        setActive((index + (event.key === "ArrowDown" ? 1 : list.length - 1)) % list.length);
      } else if ((event.key === "Enter" || event.key === "Tab") && !event.shiftKey && list.length) {
        stop();
        choose(list[index] ?? list[0]);
      } else if (event.key === "Escape") {
        stop();
        dismissed.current = m.start;
        close();
      }
    };
    const onPick = (event: Event) => choose((event as CustomEvent<ChatMention>).detail);
    prompt.setAttribute("aria-haspopup", "listbox");
    prompt.setAttribute("aria-controls", "bd-mention-list");
    prompt.setAttribute("aria-expanded", "false");
    prompt.addEventListener("input", update);
    prompt.addEventListener("click", update);
    prompt.addEventListener("keydown", onKey, true);
    prompt.addEventListener("blur", close);
    prompt.addEventListener("bd-mention-pick", onPick);
    return () => {
      prompt.removeEventListener("input", update);
      prompt.removeEventListener("click", update);
      prompt.removeEventListener("keydown", onKey, true);
      prompt.removeEventListener("blur", close);
      prompt.removeEventListener("bd-mention-pick", onPick);
      for (const name of [
        "aria-haspopup",
        "aria-controls",
        "aria-expanded",
        "aria-activedescendant",
      ])
        prompt.removeAttribute(name);
    };
  }, []);

  useEffect(() => {
    const prompt = document.getElementById("project-prompt");
    if (match && items[active])
      prompt?.setAttribute("aria-activedescendant", `bd-mention-${active}`);
  }, [match, items, active]);

  const pick = (item: ChatMention) =>
    document
      .getElementById("project-prompt")
      ?.dispatchEvent(new CustomEvent("bd-mention-pick", { detail: item }));
  // shadcn Popover anchored to the composer's top edge. Focus stays in the prompt (aria-activedescendant); Escape,
  // outside clicks and blur are handled by the prompt listeners above, so the popover's own dismissal is disabled.
  return (
    <Popover open={!!match}>
      <PopoverAnchor asChild>
        <span aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-0" />
      </PopoverAnchor>
      {match && (
        <PopoverContent
          side="top"
          align="start"
          sideOffset={6}
          role={undefined}
          onOpenAutoFocus={(event) => event.preventDefault()}
          onCloseAutoFocus={(event) => event.preventDefault()}
          onEscapeKeyDown={(event) => event.preventDefault()}
          onInteractOutside={(event) => event.preventDefault()}
          className="w-(--radix-popover-trigger-width)"
        >
          {/* -m-2 pulls the rows out to a 4px inset inside the popover's 12px padding, like the chat menus. */}
          <div className={cn(hook.mentionPopover, "-m-2 text-sm text-foreground-2")}>
            <p className="flex h-6 items-center px-2 text-muted-foreground">
              {match.query ? `Layers matching “${match.query}”` : "Mention a layer"}
            </p>
            <ul
              id="bd-mention-list"
              role="listbox"
              aria-label="Canvas layers"
              className="m-0 flex max-h-56 list-none flex-col overflow-y-auto p-0"
            >
              {items.length === 0 && (
                <li className="flex h-6 items-center px-2 text-subtle-foreground">
                  No matching layers
                </li>
              )}
              {items.map((item, i) => (
                <li
                  key={item.id}
                  id={`bd-mention-${i}`}
                  role="option"
                  aria-selected={i === active}
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseMove={() => setActive(i)}
                  onClick={() => pick(item)}
                  className={cn(
                    "flex h-6 cursor-default items-center gap-2 rounded-md px-2",
                    i === active && "bg-muted",
                  )}
                >
                  <MentionIcon type={item.type} />
                  <span className="min-w-0 truncate">{item.label}</span>
                  {item.type && (
                    <span className="ml-auto shrink-0 text-xs text-subtle-foreground capitalize">
                      {item.type}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </PopoverContent>
      )}
    </Popover>
  );
}

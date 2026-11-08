// Design style picker: a menu opened by the "/style" slash command (Wonder's composer toolbar has no style control, so
// there is no chip) that pins one entry of the runtime's design style catalog (platform.desktop.designStylesList) for
// the next runs. "Auto" (no style) lets the agent choose. The pick is remembered for the session (localStorage) and read
// by web/desktop-panel.js when it composes a task, through window.chatDesignStyle.get(); the run request then carries it
// as `designStyle`. The menu anchors to the top edge of the composer, like the slash command list; the trigger is a
// hidden zero-height anchor. Nothing renders when the desktop build has no style catalog.
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { platform } from "@/lib/platform";
import {
  ChatMenu,
  ChatMenuContent,
  ChatMenuLabel,
  ChatMenuOptionItem,
  ChatMenuRadioGroup,
  ChatMenuSeparator,
  ChatMenuTrigger,
} from "./menu";

export type DesignStyle = { id: string; name: string; summary?: string };

const STORAGE_KEY = "verynize.chat.design-style";
export const OPEN_STYLE_PICKER_EVENT = "bd:open-style-picker";

const styleDesktop = (): { designStylesList?: () => Promise<DesignStyle[]> } | null =>
  platform.desktop;
/** Whether this desktop build offers the style catalog. */
export const hasStyleCatalog = () => typeof styleDesktop()?.designStylesList === "function";

/* ---------- Selected style (one value for the session, shared with desktop-panel.js) ---------- */
const listeners = new Set<() => void>();
let current = (() => {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
})();

function setDesignStyle(id: string) {
  const next = typeof id === "string" ? id.trim() : "";
  if (next === current) return;
  current = next;
  try {
    if (next) localStorage.setItem(STORAGE_KEY, next);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage full or unavailable: the choice still holds until reload.
  }
  for (const fn of listeners) fn();
}

const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

declare global {
  interface Window {
    /** Composer design style (empty = Auto). Read by web/desktop-panel.js when a task is composed. */
    chatDesignStyle?: { get(): string; set(id: string): void };
  }
}
// Only a style the catalog offers is sent; an unknown leftover id (older catalog) falls back to Auto.
let known: Set<string> | null = null;
window.chatDesignStyle = {
  get: () => (current && hasStyleCatalog() && (!known || known.has(current)) ? current : ""),
  set: setDesignStyle,
};

/* ---------- Catalog (loaded once per page) ---------- */
let catalog: Promise<DesignStyle[]> | null = null;
function loadStyles(): Promise<DesignStyle[]> {
  const list = styleDesktop()?.designStylesList;
  if (!list) return Promise.resolve([]);
  catalog ??= list()
    .then((items) => {
      const styles = (Array.isArray(items) ? items : []).filter(
        (s) => s && typeof s.id === "string" && s.id,
      );
      known = new Set(styles.map((s) => s.id));
      return styles;
    })
    .catch(() => {
      catalog = null;
      return [];
    });
  return catalog;
}

function useStyles(): DesignStyle[] {
  const [styles, setStyles] = useState<DesignStyle[]>([]);
  useEffect(() => {
    let live = true;
    void loadStyles().then((value) => live && setStyles(value));
    return () => {
      live = false;
    };
  }, []);
  return styles;
}

const AUTO = "";

export function StylePicker() {
  const selected = useSyncExternalStore(subscribe, () => current);
  const styles = useStyles();
  const [open, setOpen] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener(OPEN_STYLE_PICKER_EVENT, show);
    return () => window.removeEventListener(OPEN_STYLE_PICKER_EVENT, show);
  }, []);

  // Radix focuses the menu itself on open; move on to the current choice so ↑↓ / Enter work straight from the keyboard.
  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() =>
      contentRef.current
        ?.querySelector<HTMLElement>("[role=menuitemradio][aria-checked=true]")
        ?.focus(),
    );
    return () => cancelAnimationFrame(frame);
  }, [open]);

  if (!hasStyleCatalog() || styles.length === 0) return null;
  const active = styles.find((s) => s.id === selected);
  return (
    <ChatMenu open={open} onOpenChange={setOpen} modal={false}>
      <ChatMenuTrigger asChild>
        <span
          aria-hidden="true"
          tabIndex={-1}
          className="pointer-events-none absolute inset-x-0 top-0 h-0"
        />
      </ChatMenuTrigger>
      <ChatMenuContent
        ref={contentRef}
        id="chat-style-menu"
        aria-label="Design style"
        align="start"
        side="top"
        className="max-h-(--radix-dropdown-menu-content-available-height) w-72 overflow-y-auto"
        onCloseAutoFocus={(event) => {
          // The hidden anchor can't take focus back; return it to the prompt the command was typed in.
          event.preventDefault();
          document.getElementById("project-prompt")?.focus();
        }}
      >
        <ChatMenuLabel>Design style</ChatMenuLabel>
        <ChatMenuRadioGroup value={active?.id ?? AUTO} onValueChange={setDesignStyle}>
          <ChatMenuOptionItem value={AUTO} data-style-id={AUTO}>
            <span className="flex min-w-0 flex-col">
              <span className="text-foreground">Auto</span>
              <span className="text-xs leading-4 text-muted-foreground">
                Let the agent choose a direction from the brief.
              </span>
            </span>
          </ChatMenuOptionItem>
          <ChatMenuSeparator />
          {styles.map((style) => (
            <ChatMenuOptionItem
              key={style.id}
              value={style.id}
              data-style-id={style.id}
              textValue={style.name}
            >
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-foreground">{style.name}</span>
                {style.summary && (
                  <span className="line-clamp-2 text-xs leading-4 text-muted-foreground">
                    {style.summary}
                  </span>
                )}
              </span>
            </ChatMenuOptionItem>
          ))}
        </ChatMenuRadioGroup>
      </ChatMenuContent>
    </ChatMenu>
  );
}

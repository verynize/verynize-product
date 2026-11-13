// ⌘K command palette (Wonder canvas-audit P2): "Jump to or find anything...", a 672 × 480 sectioned list over the canvas
// command registry (`window.design.commands()`), app and workspace commands, and the layers of the active page.
// The empty state lists the commands run from here most recently (Recent) and three Application commands; typing
// searches every section, with layer matches first. ↓ ↑ move, ↵ runs the active row and closes, Esc closes and keeps
// the canvas selection. A focused terminal, the code workspace and the Files home keep their own ⌘K.
import { useEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from "react";
import { Dialog } from "radix-ui";
import { Command as Cmdk } from "cmdk";
import {
  CircleDot,
  ClipboardPaste,
  Command as CommandIcon,
  Copy,
  Hand,
  Keyboard,
  MessageSquare,
  MousePointer2,
  Scaling,
  Scan,
  Search,
  Settings,
  Type,
  Undo2,
  X,
} from "lucide-react";
import { PanelLeftIcon, ShaderIcon } from "@/components/icons";
import { activePage, design, portalContainer, type LayerNode } from "@/lib/bridge";
import { HELP_LINKS, openExternal } from "./help-links";
import { applyLayout, currentLayout } from "./hooks";
import { run } from "./legacy";
import {
  keyChips,
  registryCommands,
  sectionOfCommand,
  setPanelOpen,
  usePanelOpen,
} from "./shortcuts";

type Icon = ComponentType<{ className?: string }>;

type PaletteCommand = {
  id: string;
  label: string;
  section: string;
  chips?: string[];
  /** Extra words the search matches (Wonder lists the toolbar views under "select"). */
  keywords?: string[];
  /** Listed under Application on the empty palette (Wonder P2-empty). */
  suggested?: boolean;
  icon?: Icon;
  /** Right-aligned text (a layer's ancestors). */
  detail?: string;
  run: () => void;
};

/** Section order; cmdk then moves the section with the best match to the top. Layers, then tools (P2-frame). */
const SECTIONS = [
  "Layers",
  "Tools",
  "Edit",
  "Selection",
  "Workspace",
  "View",
  "Transform",
  "Shape",
  "Alignment",
  "Pages",
  "Application",
];

const mod = /Mac/.test(navigator.platform) ? "⌘" : "Ctrl";

/** Commands that live outside the canvas registry. */
function appCommands(): PaletteCommand[] {
  const layout = (name: "details" | "design" | "canvas") => () => applyLayout(name);
  return [
    {
      id: "app.findLayers",
      label: "Find layers",
      section: "Edit",
      chips: [mod, "F"],
      icon: Search,
      run: () => setPanelOpen("find", true),
    },
    {
      id: "app.shortcuts",
      label: "Open keyboard shortcuts",
      section: "Application",
      suggested: true,
      icon: Keyboard,
      run: () => setPanelOpen("shortcuts", true),
    },
    {
      id: "app.tour",
      label: "Restart tour",
      section: "Application",
      keywords: ["onboarding"],
      suggested: true,
      icon: Undo2,
      run: () => window.dispatchEvent(new Event("bd:open-onboarding")),
    },
    {
      id: "app.feedback",
      label: "Give feedback",
      section: "Application",
      suggested: true,
      icon: MessageSquare,
      run: () => {
        if (HELP_LINKS.feedback) openExternal(HELP_LINKS.feedback);
      },
    },
    {
      id: "app.settings",
      label: "Go to settings",
      section: "Application",
      chips: [mod, ","],
      icon: Settings,
      run: () => window.appSettings?.open(),
    },
    {
      id: "app.searchFiles",
      label: "Search files",
      section: "Application",
      icon: Search,
      run: () => run("shell-search"),
    },
    {
      id: "layout.details",
      label: "Switch to the first toolbar view",
      section: "Workspace",
      chips: ["⌥", "1"],
      keywords: ["select", "details"],
      run: layout("details"),
    },
    {
      id: "layout.design",
      label: "Switch to the second toolbar view",
      section: "Workspace",
      chips: ["⌥", "2"],
      keywords: ["select", "design"],
      run: layout("design"),
    },
    {
      id: "layout.applyDesign",
      label: "Apply Design view",
      section: "Workspace",
      run: layout("design"),
    },
    {
      id: "layout.applyDetails",
      label: "Apply Details view",
      section: "Workspace",
      run: layout("details"),
    },
    {
      id: "layout.applyCanvas",
      label: "Apply Canvas view",
      section: "Workspace",
      chips: ["⌥", "0"],
      run: layout("canvas"),
    },
    {
      id: "layout.reset",
      label: "Reset layout to active view",
      section: "Workspace",
      run: () => applyLayout(currentLayout()),
    },
    {
      id: "chat.focus",
      label: "Focus chat",
      section: "Workspace",
      icon: MessageSquare,
      run: () => window.agentWorkspace?.openChat?.(),
    },
    {
      id: "view.savedViews",
      label: "Saved views…",
      section: "View",
      run: () => run("saved-views-open"),
    },
    {
      id: "view.snap",
      label: "Toggle snap to objects",
      section: "View",
      // The hidden `#snap` checkbox (zoom proxies) owns the state legacy drag code reads.
      run: () => (document.getElementById("snap") as HTMLInputElement | null)?.click(),
    },
  ];
}

const TOOL_ICONS: Record<string, Icon> = {
  "tool.move": MousePointer2,
  "tool.scale": Scaling,
  "tool.hand": Hand,
  "tool.frame": Scan,
  "tool.text": Type,
  "tool.shader": ShaderIcon,
};

/** Wonder's row icons: target circle for selection, clipboard for paste, panel for workspace, magnifier for layers. */
function iconOf(command: PaletteCommand): Icon {
  if (command.icon) return command.icon;
  const id = command.id.toLowerCase();
  if (command.section === "Workspace") return PanelLeftIcon;
  if (command.section === "Tools") return TOOL_ICONS[command.id] ?? Scan;
  if (id.includes("paste")) return ClipboardPaste;
  if (id.includes("copy")) return Copy;
  if (id.startsWith("select.")) return CircleDot;
  return CommandIcon;
}

function paletteCommands(): PaletteCommand[] {
  const registry = registryCommands().map((c) => {
    const section = sectionOfCommand(c.id) ?? c.section ?? "Commands";
    const label = c.label ?? c.id;
    return {
      id: c.id,
      // Tools read "Frame tool" as in Wonder's shortcut list and palette (P2-frame).
      label: c.id.startsWith("tool.") && !/ tool$/i.test(label) ? `${label} tool` : label,
      section,
      chips: c.keys?.[0] ? keyChips(c.keys[0]) : undefined,
      run: () => window.design.runCommand(c.id),
    };
  });
  return [...appCommands(), ...registry];
}

/** The active page's layers in Layers-panel order (top-most first, depth-first), with their ancestor path. */
function layerCommands(): PaletteCommand[] {
  let nodes: LayerNode[] = [];
  try {
    nodes = activePage(design().getDocument())?.nodes ?? [];
  } catch {
    return [];
  }
  const children = new Map<string | null, LayerNode[]>();
  for (const n of nodes) {
    const key = n.parentId || null;
    children.set(key, [...(children.get(key) ?? []), n]);
  }
  const out: PaletteCommand[] = [];
  const walk = (parent: string | null, path: string[]) => {
    const list = children.get(parent) ?? [];
    for (let i = list.length - 1; i >= 0; i--) {
      const node = list[i];
      const name = node.name || node.type;
      out.push({
        id: "layer:" + node.id,
        label: name,
        section: "Layers",
        detail: path.join(" / "),
        icon: Search,
        run: () => design().setSelection([node.id]),
      });
      walk(node.id, [...path, name]);
    }
  };
  walk(null, []);
  return out;
}

/* ---------- Recent: the last commands run from the palette (this profile) ---------- */
const RECENT_KEY = "verynize.palette.recent";
const RECENT_MAX = 7;
function recentIds(): string[] {
  try {
    const list = JSON.parse(localStorage.getItem(RECENT_KEY) || "[]");
    return Array.isArray(list) ? list.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}
function remember(id: string) {
  if (id.startsWith("layer:")) return;
  const next = [id, ...recentIds().filter((other) => other !== id)].slice(0, RECENT_MAX);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // Storage full or unavailable: the palette still works without recents.
  }
}

/**
 * Whether ⌘K belongs to the palette here: the code workspace, any focused terminal (⌘K clears it) and the Files home
 * keep their own ⌘K.
 */
export function paletteKeyAllowed(target: EventTarget | null) {
  if (target instanceof Element && target.closest(".xterm")) return false;
  const body = document.body.classList;
  return !["code-mode", "files-view", "settings-open", "onboarding-open"].some((c) =>
    body.contains(c),
  );
}

export function CommandPalette() {
  const open = usePanelOpen("palette");
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const isMod = /Mac/.test(navigator.platform) ? e.metaKey : e.ctrlKey;
      if (!isMod || e.altKey || e.shiftKey || e.code !== "KeyK" || !paletteKeyAllowed(e.target))
        return;
      // Capture phase: runs before wonder-shell's window ⌘K (Files search) and stops it.
      e.preventDefault();
      e.stopImmediatePropagation();
      setPanelOpen("palette", true);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);
  return open ? <Palette /> : null;
}

/**
 * Rank by the label first: a label that starts with the query beats one that contains it, which beats a match that
 * only hits the id or the keywords. Every query word must appear, so "select all" never ranks "Paste over selection"
 * (cmdk's default fuzzy score does) above "Select all".
 */
function scoreCommand(value: string, search: string, keywords: string[] = []) {
  const query = search.trim().toLowerCase();
  if (!query) return 1;
  const text = value.toLowerCase();
  const label = text.slice(0, text.lastIndexOf(" "));
  if (label.startsWith(query)) return 1;
  if (label.includes(query)) return 0.8;
  const words = query.split(/\s+/);
  if (words.every((word) => label.includes(word))) return 0.6;
  const extra = `${text} ${keywords.join(" ").toLowerCase()}`;
  if (words.every((word) => extra.includes(word))) return 0.3;
  return 0;
}

/** The label with the parts that match the query bright and the rest dimmed (Wonder P2-select). */
function Highlighted({ text, query }: { text: string; query: string }) {
  const q = query.trim().toLowerCase();
  const lower = text.toLowerCase();
  const marks = Array.from(text, () => false);
  if (q) {
    const words = lower.includes(q) ? [q] : q.split(/\s+/).filter(Boolean);
    for (const word of words) {
      const at = lower.indexOf(word);
      if (at >= 0) marks.fill(true, at, at + word.length);
    }
  }
  if (!marks.includes(true)) return <span className="truncate">{text}</span>;
  const parts: ReactNode[] = [];
  let start = 0;
  for (let i = 1; i <= text.length; i++) {
    if (i < text.length && marks[i] === marks[start]) continue;
    parts.push(
      <span key={start} className={marks[start] ? "text-foreground-2" : "text-muted-foreground"}>
        {text.slice(start, i)}
      </span>,
    );
    start = i;
  }
  return <span className="truncate">{parts}</span>;
}

export function Keycap({ children, footer = false }: { children: ReactNode; footer?: boolean }) {
  return (
    <kbd
      className={
        footer
          ? "inline-flex h-palette-footer-keycap min-w-palette-footer-keycap items-center justify-center rounded-sm bg-command-palette-keycap px-1 font-sans text-xs text-foreground-3 shadow-palette-keycap"
          : "inline-flex h-palette-keycap min-w-palette-keycap items-center justify-center rounded-sm bg-command-palette-keycap px-1 font-sans text-xs text-foreground-3 shadow-palette-keycap"
      }
    >
      {children}
    </kbd>
  );
}

function Row({
  command,
  value,
  query,
  onChoose,
}: {
  command: PaletteCommand;
  value: string;
  query: string;
  onChoose: (command: PaletteCommand) => void;
}) {
  const Glyph = iconOf(command);
  return (
    <Cmdk.Item
      value={value}
      keywords={command.keywords}
      data-command-id={command.id}
      onSelect={() => onChoose(command)}
      className="flex h-8 cursor-default items-center gap-3 rounded-lg px-3 text-base text-foreground-2 outline-none select-none data-[selected=true]:bg-command-palette-highlight"
    >
      <Glyph className="size-4 shrink-0 text-muted-foreground" />
      <Highlighted text={command.label} query={query} />
      {command.detail ? (
        <span className="ml-auto shrink-0 truncate text-muted-foreground">{command.detail}</span>
      ) : null}
      {command.chips?.length ? (
        <span className="ml-auto flex shrink-0 items-center gap-1">
          {command.chips.map((chip, i) => (
            <Keycap key={i}>{chip}</Keycap>
          ))}
        </span>
      ) : null}
    </Cmdk.Item>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Cmdk.Group value={title} data-palette-section={title}>
      <div className="flex h-palette-heading items-end px-3 pb-2 text-xs text-subtle-foreground">
        {title}
      </div>
      {children}
    </Cmdk.Group>
  );
}

function Palette() {
  const commands = useMemo(paletteCommands, []);
  const layers = useMemo(layerCommands, []);
  const [query, setQuery] = useState("");
  const searching = query.trim().length > 0;
  const listRef = useRef<HTMLDivElement>(null);
  // Each keystroke re-ranks the rows: start from the top and keep the active row in view (otherwise the list keeps the
  // previous query's scroll offset and the best match can sit off-screen).
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const list = listRef.current;
      if (!list) return;
      list.scrollTop = 0;
      list.querySelector("[cmdk-item][data-selected=true]")?.scrollIntoView({ block: "nearest" });
    });
    return () => cancelAnimationFrame(frame);
  }, [query]);
  const byId = useMemo(() => new Map(commands.map((c) => [c.id, c])), [commands]);
  const recent = useMemo(
    () =>
      recentIds()
        .map((id) => byId.get(id))
        .filter((c): c is PaletteCommand => !!c),
    [byId],
  );
  const choose = (command: PaletteCommand) => {
    remember(command.id);
    setPanelOpen("palette", false);
    // After the dialog has closed and returned focus, so canvas commands see the normal focus state.
    requestAnimationFrame(() => command.run());
  };
  const sections = [
    ...SECTIONS,
    ...new Set(commands.map((c) => c.section).filter((s) => !SECTIONS.includes(s))),
  ];
  const valueOf = (command: PaletteCommand, prefix = "") =>
    `${command.label} ${prefix}${command.id}`;
  // Wonder lists at most eight layer matches (P2-frame), in Layers-panel order.
  const layerMatches = layers.filter((l) => scoreCommand(valueOf(l), query) > 0).slice(0, 8);
  return (
    <Dialog.Root open onOpenChange={(value) => setPanelOpen("palette", value)}>
      <Dialog.Portal container={portalContainer()}>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-command-palette-scrim" />
        <Dialog.Content
          data-command-palette=""
          className="fixed top-palette-top left-1/2 z-50 flex h-palette-height w-palette -translate-x-1/2 flex-col overflow-hidden rounded-palette bg-command-palette text-base text-foreground-2 shadow-palette outline-none"
        >
          <Dialog.Title className="sr-only">Command palette</Dialog.Title>
          <Dialog.Description className="sr-only">
            Search for a command or a layer
          </Dialog.Description>
          <Cmdk filter={scoreCommand} className="flex min-h-0 flex-1 flex-col">
            <div
              data-palette-input=""
              className="flex h-palette-input shrink-0 items-center gap-2 px-2.5 shadow-palette-input"
            >
              <Search className="size-3.5 shrink-0 text-muted-foreground" />
              <Cmdk.Input
                value={query}
                onValueChange={setQuery}
                placeholder="Jump to or find anything..."
                className="h-full min-w-0 flex-1 bg-transparent text-base text-foreground-2 outline-none placeholder:text-subtle-foreground"
              />
              {searching ? (
                <button
                  type="button"
                  aria-label="Clear search"
                  onClick={() => setQuery("")}
                  className="flex size-4 shrink-0 items-center justify-center text-subtle-foreground hover:text-foreground-2"
                >
                  <X className="size-3.5" />
                </button>
              ) : null}
            </div>
            <Cmdk.List ref={listRef} className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
              <Cmdk.Empty className="py-6 text-center text-muted-foreground">No results</Cmdk.Empty>
              {searching ? (
                sections.map((section) => {
                  const rows =
                    section === "Layers"
                      ? layerMatches
                      : commands.filter((c) => c.section === section);
                  if (!rows.length) return null;
                  return (
                    <Section key={section} title={section}>
                      {rows.map((command) => (
                        <Row
                          key={command.id}
                          command={command}
                          value={valueOf(command)}
                          query={query}
                          onChoose={choose}
                        />
                      ))}
                    </Section>
                  );
                })
              ) : (
                <>
                  {recent.length ? (
                    <Section title="Recent">
                      {recent.map((command) => (
                        <Row
                          key={command.id}
                          command={command}
                          value={valueOf(command, "recent:")}
                          query=""
                          onChoose={choose}
                        />
                      ))}
                    </Section>
                  ) : null}
                  <Section title="Application">
                    {commands
                      .filter((c) => c.suggested)
                      .map((command) => (
                        <Row
                          key={command.id}
                          command={command}
                          value={valueOf(command)}
                          query=""
                          onChoose={choose}
                        />
                      ))}
                  </Section>
                </>
              )}
            </Cmdk.List>
            <div
              data-palette-footer=""
              className="flex h-palette-footer shrink-0 items-center justify-end gap-4 bg-command-palette-footer px-5 text-base text-subtle-foreground shadow-palette-footer"
            >
              <span className="flex items-center gap-1.5">
                Navigate
                <Keycap footer>↓</Keycap>
                <Keycap footer>↑</Keycap>
              </span>
              <span className="h-4 w-px bg-command-palette-edge" />
              <span className="flex items-center gap-1.5">
                Open
                <Keycap footer>↵</Keycap>
              </span>
              <span className="h-4 w-px bg-command-palette-edge" />
              <span className="flex items-center gap-1.5">
                Close
                <Keycap footer>Esc</Keycap>
              </span>
            </div>
          </Cmdk>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

// Keyboard shortcut reference (Wonder K1): rows built from the canvas command registry (`window.design.commands()`)
// plus the few bindings handled outside it (Space pan, arrow nudges, ⌥ layouts, text-editing keys, ⌘K, ⌘,).
// Only bindings Verynize actually has are listed; Wonder's labels are used where the action is the same.
import { useSyncExternalStore } from "react";

export type RegistryCommand = { id: string; label?: string; section?: string; keys?: string[] };
export type ShortcutRow = { id: string; label: string; keys: string[] };
export type ShortcutSection = { title: string; rows: ShortcutRow[] };

/** Wonder's section order. Sections without a Verynize binding are left out. */
export const SECTION_ORDER = [
  "APPLICATION",
  "TOOLS",
  "EDIT",
  "SELECTION",
  "VIEW",
  "TRANSFORM",
  "COMPONENTS",
  "SHAPE",
  "ALIGNMENT",
  "MOVEMENT",
  "PAGES",
  "TEXT EDITING",
] as const;

const REGISTRY_SECTION: Record<string, string> = {
  Tools: "TOOLS",
  Edit: "EDIT",
  Selection: "SELECTION",
  View: "VIEW",
  Transform: "TRANSFORM",
  Components: "COMPONENTS",
  Shape: "SHAPE",
  Alignment: "ALIGNMENT",
  Pages: "PAGES",
};

const IS_MAC = typeof navigator === "undefined" || /Mac|iPhone|iPad/.test(navigator.platform);
const KEY_GLYPHS: Record<string, string> = {
  "=": "+",
  plus: "+",
  "-": "−",
  enter: "↵",
  escape: "Esc",
  delete: "⌦",
  backspace: "⌫",
  tab: "Tab",
  space: "Space",
};

/** `mod+shift+c` → ["⌘", "⇧", "C"] in Wonder's modifier order (⌃ ⌘ ⇧ ⌥). */
export function keyChips(combo: string): string[] {
  const parts = combo.split("+").filter((p, i, all) => p || i === all.length - 1);
  // "mod+plus" / "mod+=": the last part is the key; an empty last part means "+".
  const key = parts.pop() || "+";
  const mods = new Set(parts);
  const chips: string[] = [];
  if (mods.has("ctrl")) chips.push("⌃");
  if (mods.has("mod")) chips.push(IS_MAC ? "⌘" : "Ctrl");
  if (mods.has("shift")) chips.push("⇧");
  if (mods.has("alt")) chips.push("⌥");
  chips.push(KEY_GLYPHS[key] ?? (key.length === 1 ? key.toUpperCase() : key));
  return chips;
}

/** A registry command shown in a section. `keys` picks which of its bindings get a row (default: all); every row
 * after the first is labelled "(alt)" unless `labels` names it, as in Wonder ("Redo (alt)", "Eye dropper (alt)"). */
type Pick = { command: string; label: string; keys?: number[]; labels?: string[] };
/** A binding handled outside the registry. */
type Fixed = { id: string; label: string; chips: string[] };
type Entry = Pick | Fixed;

const mod = IS_MAC ? "⌘" : "Ctrl";
const LAYOUT: Entry[] = [
  { id: "layout.details", label: "Switch to the first toolbar view", chips: ["⌥", "1"] },
  { id: "layout.design", label: "Switch to the second toolbar view", chips: ["⌥", "2"] },
  { id: "layout.canvas", label: "Switch to the Canvas view", chips: ["⌥", "0"] },
];

const ENTRIES: Record<(typeof SECTION_ORDER)[number], Entry[]> = {
  APPLICATION: [
    { id: "app.palette", label: "Command palette", chips: [mod, "K"] },
    { id: "app.settings", label: "Go to settings", chips: [mod, ","] },
  ],
  TOOLS: [
    { command: "tool.move", label: "Move tool" },
    { command: "tool.scale", label: "Scale tool" },
    { command: "tool.hand", label: "Hand tool" },
    { id: "tool.tempHand", label: "Temporary hand tool", chips: ["Space"] },
    { command: "tool.frame", label: "Frame tool" },
    { command: "tool.text", label: "Text tool" },
    { command: "tool.shader", label: "Shader tool" },
    { command: "tool.eyedropper", label: "Eye dropper" },
    { command: "tool.rectangle", label: "Rectangle tool" },
    { command: "tool.ellipse", label: "Ellipse tool" },
  ],
  EDIT: [
    { id: "app.findLayers", label: "Find layers", chips: [mod, "F"] },
    { command: "edit.copy", label: "Copy" },
    { command: "edit.copyCode", label: "Copy as code" },
    { command: "edit.copyStyle", label: "Copy styles" },
    { command: "edit.paste", label: "Paste" },
    { command: "edit.pasteStyle", label: "Paste styles" },
    { command: "edit.pasteInPlace", label: "Paste in place" },
    { command: "edit.cut", label: "Cut" },
    { command: "edit.undo", label: "Undo" },
    { command: "edit.redo", label: "Redo" },
    { command: "edit.duplicate", label: "Duplicate" },
    { command: "edit.delete", label: "Delete", keys: [1] },
    { command: "select.all", label: "Select all" },
  ],
  SELECTION: [
    { command: "select.inverse", label: "Select inverse" },
    { command: "select.next", label: "Cycle next layer" },
    { command: "select.previous", label: "Cycle previous layer" },
    { command: "select.child", label: "Select child" },
    {
      command: "select.parent",
      label: "Select parent",
      labels: ["Select parent", "Move selection up to parent"],
    },
    { command: "select.matching", label: "Select all matching layers" },
    { command: "select.escape", label: "Deselect" },
  ],
  VIEW: [
    { command: "view.zoomIn", label: "Zoom in", keys: [0] },
    { command: "view.zoomOut", label: "Zoom out", keys: [0] },
    { command: "view.zoom100", label: "Zoom to 100%", keys: [1, 0] },
    { command: "view.fit", label: "Zoom to fit" },
    { command: "view.selection", label: "Zoom to selection" },
    ...LAYOUT,
    { command: "layer.visibility", label: "Toggle visibility" },
    { command: "layer.lock", label: "Toggle lock" },
    { id: "view.opacity", label: "Set opacity", chips: ["0–9"] },
  ],
  TRANSFORM: [
    { command: "transform.flipH", label: "Flip horizontal" },
    { command: "transform.flipV", label: "Flip vertical" },
    { command: "transform.autoLayout", label: "Add auto layout" },
    { command: "transform.removeAutoLayout", label: "Remove auto layout" },
    { command: "transform.frame", label: "Frame selection" },
    { command: "transform.unframe", label: "Unframe selection" },
    { command: "arrange.backward", label: "Send backward" },
    { command: "arrange.forward", label: "Bring forward" },
    { command: "arrange.back", label: "Send to back" },
    { command: "arrange.front", label: "Bring to front" },
    { command: "transform.rotate90", label: "Rotate 90° right" },
    { command: "transform.rotate90ccw", label: "Rotate 90° left" },
  ],
  COMPONENTS: [
    { command: "component.create", label: "Create component" },
    { command: "component.detach", label: "Detach instance" },
  ],
  SHAPE: [],
  ALIGNMENT: [
    { command: "align.left", label: "Align left" },
    { command: "align.center", label: "Align horizontal center" },
    { command: "align.right", label: "Align right" },
    { command: "align.top", label: "Align top" },
    { command: "align.middle", label: "Align vertical middle" },
    { command: "align.bottom", label: "Align bottom" },
    { command: "align.distributeX", label: "Distribute horizontal spacing" },
    { command: "align.distributeY", label: "Distribute vertical spacing" },
  ],
  MOVEMENT: [
    { id: "move.left", label: "Move left", chips: ["←"] },
    { id: "move.right", label: "Move right", chips: ["→"] },
    { id: "move.up", label: "Move up", chips: ["↑"] },
    { id: "move.down", label: "Move down", chips: ["↓"] },
    { id: "move.left10", label: "Move left 10px", chips: ["⇧", "←"] },
    { id: "move.right10", label: "Move right 10px", chips: ["⇧", "→"] },
    { id: "move.up10", label: "Move up 10px", chips: ["⇧", "↑"] },
    { id: "move.down10", label: "Move down 10px", chips: ["⇧", "↓"] },
  ],
  PAGES: [],
  "TEXT EDITING": [
    { id: "text.bold", label: "Bold", chips: [mod, "B"] },
    { id: "text.italic", label: "Italic", chips: [mod, "I"] },
  ],
};

/** The drawer section a registry command is listed in, as a title ("EDIT" → "Edit"); Select all is under Edit. */
export function sectionOfCommand(id: string): string | undefined {
  for (const title of SECTION_ORDER) {
    if (ENTRIES[title].some((entry) => "command" in entry && entry.command === id))
      return title.charAt(0) + title.slice(1).toLowerCase();
  }
  return undefined;
}

/** Every section with its rows, from the live registry. Registry commands that have a binding but no entry above
 * (added later) are appended to their registry section with the registry label. */
export function shortcutSections(commands: RegistryCommand[]): ShortcutSection[] {
  const byId = new Map(commands.map((c) => [c.id, c]));
  const used = new Set<string>();
  const sections = SECTION_ORDER.map((title) => {
    const rows: ShortcutRow[] = [];
    for (const entry of ENTRIES[title]) {
      if ("chips" in entry) {
        rows.push({ id: entry.id, label: entry.label, keys: entry.chips });
        continue;
      }
      const command = byId.get(entry.command);
      if (!command?.keys?.length) continue;
      used.add(command.id);
      const indexes = entry.keys ?? command.keys.map((_, i) => i);
      indexes.forEach((index, n) => {
        const combo = command.keys?.[index];
        if (!combo) return;
        const label = entry.labels?.[n] ?? (n === 0 ? entry.label : `${entry.label} (alt)`);
        rows.push({ id: `${command.id}#${index}`, label, keys: keyChips(combo) });
      });
    }
    return { title, rows };
  });
  for (const command of commands) {
    if (used.has(command.id) || !command.keys?.length) continue;
    const section = sections.find((s) => s.title === REGISTRY_SECTION[command.section ?? ""]);
    if (!section) continue;
    section.rows.push({
      id: `${command.id}#0`,
      label: command.label ?? command.id,
      keys: keyChips(command.keys[0]),
    });
  }
  return sections.filter((s) => s.rows.length);
}

export function filterSections(sections: ShortcutSection[], query: string): ShortcutSection[] {
  const q = query.trim().toLowerCase();
  if (!q) return sections;
  return sections
    .map((s) => ({
      ...s,
      rows: s.rows.filter(
        (r) => r.label.toLowerCase().includes(q) || s.title.toLowerCase().includes(q),
      ),
    }))
    .filter((s) => s.rows.length);
}

export function registryCommands(): RegistryCommand[] {
  try {
    return (window.design?.commands?.() ?? []) as RegistryCommand[];
  } catch {
    return [];
  }
}

/* ---------- Open state for the drawer and the palette (shared by the help menu, ⌘K and the palette) ---------- */
type Panel = "shortcuts" | "palette" | "files" | "find";
const state: Record<Panel, boolean> = {
  shortcuts: false,
  palette: false,
  files: false,
  find: false,
};
const listeners = new Set<() => void>();
export function setPanelOpen(panel: Panel, open: boolean) {
  if (state[panel] === open) return;
  state[panel] = open;
  listeners.forEach((fn) => fn());
}
export function usePanelOpen(panel: Panel): boolean {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => state[panel],
  );
}

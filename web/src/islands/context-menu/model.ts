// Target-dependent context menus (Wonder canvas audit CM1–CM10). The menus are data so the canvas, the artboard label
// and the layer rows share one model; `entries.tsx` renders it with the Radix parts.
//
// Wonder evidence (design/wonder/canvas-audit/wonder/):
// - CM1-empty-verified: Select all ⌘A | Paste here | Hide left sidebar, Hide right sidebar.
// - CM2-frame-ready (+ copy-as / select-layer / arrange / layout): the frame menu M.
// - CM3-text-menu: M without Hide label. CM5-multi-verified: no Copy link to selection, Use as mask after Layout.
// - CM6-hidden / CM6-locked: Show / Unlock follow the layer state. CM7-row: M without Select layer and its separator.
// - CM9-label: the layer-row menu (no Select layer, Copy link to selection runs straight into Paste). CM10: the paste
//   family stays listed.
// - P3-inside-menu / P3-normal-context / P4 / P5 (notes-2026-10-31-b, taken after "Copy styles" in P1): "Paste styles
//   ⌘⌥V" sits between Paste and Paste to replace. The earlier CM2/CM5/CM9/CM10 captures (no styles copied yet) do not
//   list it, so it is shown only while styles are on the clipboard (assumption from those two states).
// - P4 (notes-2026-10-31-b): "Set as file thumbnail" is the last row after a separator in every layer menu (frame,
//   nested frame, text, multi-selection, layer row: CM2/CM3/CM5/CM7/P4 captures). Choosing it toasts "Thumbnail
//   updated" and the label stays the same. Only a single frame was exercised in Wonder; for a multi-selection
//   Verynize uses the first selected layer (unproven).
//
// - P5-mask-menu: "Use as mask" follows Layout for two selected siblings; CM5-multi-verified offers it for four too. P5-mask-result-menu: a layer with a shape mask
//   gets "Detach mask as shape" and "Remove mask" there instead (inspector/shape-mask.ts).
import { toast } from "sonner";
import { toggleBodyClass } from "../chrome/hooks";
import { design, activePage, type LayerNode } from "@/lib/bridge";
import { componentInfo, type ComponentInfo } from "@/lib/components";
import {
  detachShapeMask,
  maskGroup,
  removeMask,
  shapeMaskIndex,
  useAsMask,
} from "../inspector/shape-mask";

export type Entry =
  | {
      type: "item";
      command: string;
      label: string;
      shortcut?: string;
      disabled?: boolean;
      run: () => void;
    }
  | { type: "separator" }
  | { type: "sub"; command: string; label: string; disabled?: boolean; entries: Entry[] };

export type Point = { x: number; y: number };

type Runner = (id: string, arg?: unknown) => unknown;
type ChatMention = { id: string };
type ChatWorkspace = {
  openChat?: () => void;
  searchElements?: (query: string) => ChatMention[];
  addMention?: (mention: ChatMention) => void;
};
type CanvasModule = { canPaste?: () => boolean; canPasteStyle?: () => boolean };

const registered = () =>
  new Set(
    design()
      .commands()
      .map((c) => c.id),
  );
/** `window.design.runCommand` forwards an optional argument (the document point for `clipboard.pasteHere`). */
const runCommand = (id: string, arg?: unknown) =>
  (design().runCommand as unknown as Runner)(id, arg);
const chat = () => window.agentWorkspace as unknown as ChatWorkspace | undefined;
/** The in-app clipboard (layers copied with ⌘C); unknown means the canvas cannot tell, so Paste stays enabled. */
const canPaste = () =>
  (window as unknown as { BetterCanvas?: CanvasModule }).BetterCanvas?.canPaste?.() ?? true;

/** Whether "Copy styles" has filled the canvas's style clipboard. */
const canPasteStyle = () =>
  !!(window as unknown as { BetterCanvas?: CanvasModule }).BetterCanvas?.canPasteStyle?.();

function join(groups: Entry[][]): Entry[] {
  const out: Entry[] = [];
  for (const group of groups) {
    if (!group.length) continue;
    if (out.length) out.push({ type: "separator" });
    out.push(...group);
  }
  return out;
}

function commandItem(
  have: Set<string>,
  command: string,
  label: string,
  shortcut?: string,
  options: { disabled?: boolean; arg?: unknown } = {},
): Entry {
  return {
    type: "item",
    command,
    label,
    shortcut,
    disabled: !have.has(command) || options.disabled,
    run: () => runCommand(command, options.arg),
  };
}

/** Add the layers to the chat as context chips and open the chat. */
export function addContext(ids: string[]) {
  const workspace = chat();
  if (!workspace?.addMention) return false;
  workspace.openChat?.();
  for (const id of ids) {
    const mention = workspace.searchElements?.(id).find((m) => m.id === id);
    if (mention) workspace.addMention(mention);
  }
  return true;
}

/** Store the layer as the file's thumbnail (`document.thumbnailNodeId`, one undo step) and toast like Wonder. */
export function setFileThumbnail(id: string) {
  if (!design().setThumbnail(id)) return false;
  toast.success("Thumbnail updated", { id: "file-thumbnail" });
  return true;
}

/** Empty canvas (CM1). The sidebar items flip the chrome's `left-collapsed` / `right-collapsed` body classes. */
export function emptyCanvasMenu(point: Point | null): Entry[] {
  const have = registered();
  const body = document.body.classList;
  const left = body.contains("left-collapsed");
  const right = body.contains("right-collapsed");
  return join([
    [commandItem(have, "select.all", "Select all", "⌘A")],
    [
      commandItem(have, "clipboard.pasteHere", "Paste here", undefined, {
        arg: point,
        disabled: !canPaste(),
      }),
    ],
    [
      {
        type: "item",
        command: "view.toggleLeftSidebar",
        label: left ? "Show left sidebar" : "Hide left sidebar",
        run: () => toggleBodyClass("left-collapsed"),
      },
      {
        type: "item",
        command: "view.toggleRightSidebar",
        label: right ? "Show right sidebar" : "Hide right sidebar",
        run: () => toggleBodyClass("right-collapsed"),
      },
    ],
  ]);
}

/**
 * The layer menu for the current selection (CM2–CM7, CM9).
 * `under` lists the layers under the pointer, top-most first (canvas only; rows and the artboard label have no
 * Select layer, Wonder CM7-row / CM9-label).
 */
export function layerMenu(surface: "canvas" | "label" | "row", under: string[] = []): Entry[] {
  const have = registered();
  const doc = design().getDocument();
  const nodes = activePage(doc)?.nodes ?? [];
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const ids = design().getSelection();
  const selected = ids.map((id) => byId.get(id)).filter((n): n is LayerNode => !!n);
  if (!selected.length) return emptyCanvasMenu(null);
  const multi = selected.length > 1;
  const paste = !canPaste();
  const every = (key: string) => selected.every((n) => Boolean(n[key]));
  const artboards = selected.every((n) => !n.parentId && n.type === "frame");

  const copy: Entry[] = [
    commandItem(have, "edit.copy", "Copy", "⌘C"),
    {
      type: "sub",
      command: "menu.copyAs",
      label: "Copy as",
      entries: [
        commandItem(have, "edit.copyCode", "Copy as code", "⌘⇧C"),
        commandItem(have, "edit.copyPng", "Copy as PNG"),
        commandItem(have, "clipboard.copyPrompt", "Copy prompt", "⌘⇧⌥C"),
        commandItem(have, "edit.copyStyle", "Copy styles", "⌘⌥C"),
      ],
    },
  ];
  if (!multi) copy.push(commandItem(have, "clipboard.copyLink", "Copy link to selection"));

  const pasting: Entry[] = [
    // Menu Paste puts the clipboard inside a selected frame, centred (Wonder P3); ⌘V keeps the canvas paste.
    commandItem(have, "edit.paste", "Paste", "⌘V", { disabled: paste, arg: { menu: true } }),
    ...(canPasteStyle() ? [commandItem(have, "edit.pasteStyle", "Paste styles", "⌘⌥V")] : []),
    commandItem(have, "clipboard.pasteToReplace", "Paste to replace", "⌘⇧R", { disabled: paste }),
    commandItem(have, "clipboard.pasteOverSelection", "Paste over selection", "⌘⇧V", {
      disabled: paste,
    }),
    commandItem(have, "edit.duplicate", "Duplicate", "⌘D"),
  ];
  let middle: Entry[][];
  if (surface === "canvas") {
    const stack = (under.length ? under : ids)
      .map((id) => byId.get(id))
      .filter((n): n is LayerNode => !!n);
    const selectLayer: Entry = {
      type: "sub",
      command: "menu.selectLayer",
      label: "Select layer",
      disabled: !stack.length,
      entries: stack.slice(0, 20).map((n) => ({
        type: "item",
        command: "menu.selectLayer." + n.id,
        label: n.name || n.type,
        run: () => design().setSelection([n.id]),
      })),
    };
    middle = [copy, [selectLayer, ...pasting]];
  } else {
    middle = [[...copy, ...pasting]];
  }

  const flags: Entry[] = [
    commandItem(have, "layer.visibility", every("hidden") ? "Show" : "Hide", "⌘⇧H"),
    commandItem(have, "layer.lock", every("locked") ? "Unlock" : "Lock", "⌘⇧L"),
  ];
  if (artboards && !multi) {
    // Version history panel (web/src/islands/history, docs/version-history.md).
    const artboard = selected[0].id;
    flags.push({
      type: "item",
      command: "menu.versionHistory",
      label: "Version history",
      run: () =>
        window.dispatchEvent(
          new CustomEvent("bd:open-version-history", { detail: { artboardId: artboard } }),
        ),
    });
  }
  if (artboards) {
    const hidden = every("labelHidden");
    flags.push({
      type: "item",
      command: "menu.hideLabel",
      label: hidden ? "Show label" : "Hide label",
      run: () => design().updateNodes(ids, { labelHidden: hidden ? undefined : true }),
    });
  }

  const masking: Entry[] = [];
  if (multi && maskGroup())
    masking.push({ type: "item", command: "menu.useAsMask", label: "Use as mask", run: useAsMask });
  const shapeMask = multi ? -1 : shapeMaskIndex(selected[0]);
  if (shapeMask >= 0) {
    const id = selected[0].id;
    masking.push(
      {
        type: "item",
        command: "menu.detachMask",
        label: "Detach mask as shape",
        run: () => detachShapeMask(id, shapeMask),
      },
      {
        type: "item",
        command: "menu.removeMask",
        label: "Remove mask",
        run: () => removeMask(id, shapeMask),
      },
    );
  }

  // Components (design/component-audit/README.md "UI"; Figma 12-instance-actions). Create component sits in Layout
  // next to Frame selection; mains, instances, their layers and frames inside a main get their own group.
  const info = multi ? null : componentInfo(selected[0].id);
  const components = multi ? [] : componentEntries(have, selected[0], info, nodes);
  const canCreate = multi || !info?.instanceId;

  return join([
    [
      {
        type: "item",
        command: "menu.addContext",
        label: "Add context",
        shortcut: "⌘L",
        disabled: !chat()?.addMention,
        run: () => addContext(ids),
      },
    ],
    ...middle,
    flags,
    [
      {
        type: "sub",
        command: "menu.arrange",
        label: "Arrange",
        entries: join([
          [
            commandItem(have, "arrange.front", "Bring to front", "⌥⌘]"),
            commandItem(have, "arrange.forward", "Bring forward", "⌘]"),
            commandItem(have, "arrange.backward", "Send backward", "⌘["),
            commandItem(have, "arrange.back", "Send to back", "⌥⌘["),
          ],
          [
            commandItem(have, "transform.flipH", "Flip horizontal", "⇧H"),
            commandItem(have, "transform.flipV", "Flip vertical", "⇧V"),
          ],
        ]),
      },
    ],
    [
      {
        type: "sub",
        command: "menu.layout",
        label: "Layout",
        entries: [
          commandItem(have, "transform.frame", "Frame selection", "⌘G"),
          ...(canCreate ? [commandItem(have, "component.create", "Create component", "⌥⌘K")] : []),
          commandItem(have, "transform.autoLayout", "Add auto layout", "⇧A"),
        ],
      },
      ...masking,
    ],
    components,
    [
      {
        type: "item",
        command: "menu.setThumbnail",
        label: "Set as file thumbnail",
        disabled: selected.length !== 1 || selected[0].type !== "frame",
        run: () => setFileThumbnail(selected[0].id),
      },
      ...(doc.thumbnailNodeId
        ? [
            {
              type: "item" as const,
              command: "menu.restoreThumbnail",
              label: "Restore default thumbnail",
              run: () => setFileThumbnail(""),
            },
          ]
        : []),
    ],
  ]);
}

/** Component commands for one selected layer that is a main, an instance, a layer inside one or a frame inside a
 * main; empty for any other layer. */
function componentEntries(
  have: Set<string>,
  node: LayerNode,
  info: ComponentInfo | null,
  nodes: LayerNode[],
): Entry[] {
  const role = info?.role ?? null;
  const out: Entry[] = [];
  if (role === "main" || role === "instance")
    out.push(
      commandItem(have, "component.instance", "Create instance", undefined, {
        disabled: info?.missingMain,
      }),
    );
  if (info?.instanceId) {
    out.push(
      commandItem(have, "component.goToMain", "Go to main component", undefined, {
        disabled: info.missingMain,
      }),
      commandItem(have, "component.reset", "Reset overrides", undefined, {
        disabled: !info.overrideCount,
      }),
    );
    if (role === "instance")
      out.push(commandItem(have, "component.detach", "Detach instance", "⌥⌘B"));
  }
  if (role === "slot" && !info?.instanceId)
    out.push(commandItem(have, "component.removeSlot", "Remove slot"));
  if (!role && node.type === "frame" && insideMain(node, nodes))
    out.push(commandItem(have, "component.convertToSlot", "Convert to slot"));
  return out;
}

function insideMain(node: LayerNode, nodes: LayerNode[]) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const seen = new Set<string>();
  for (
    let p = byId.get(node.parentId ?? "");
    p && !seen.has(p.id);
    p = byId.get(p.parentId ?? "")
  ) {
    seen.add(p.id);
    if (p.component === true) return true;
  }
  return false;
}

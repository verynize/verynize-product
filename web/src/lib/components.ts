// Components, instances and slots for the islands (spec: design/component-audit/README.md "UI"). The engine is
// web/component-core.js; `window.design.components` runs each action validated and as one undo step, and the canvas
// commands (`component.*` in web/canvas-interactions.js) add wrapping, placement and Go to main component.
// This module types that API, derives a layer's role from its link fields, lists the mains of the document, inserts
// instances and builds the App shell / Page shell presets.
import { toast } from "sonner";
import { design, type DesignDocument, type LayerNode } from "./bridge";

export type SlotState = "default" | "modified";
export type SlotInfo = { id: string; name: string; state?: SlotState };
/** `componentInfo()` of web/component-core.js. */
export type ComponentInfo = {
  id: string;
  role: "main" | "instance" | "inherited" | "slot" | "local" | null;
  mainId: string | null;
  mainName: string | null;
  missingMain: boolean;
  cyclic: boolean;
  instanceId: string | null;
  overrides: string[];
  overrideCount: number;
  instanceCount: number;
  slots: SlotInfo[];
  slot: SlotInfo | null;
};
type ComponentsApi = {
  create(frameId?: string): string;
  instance(mainId: string, options?: { parentId?: string | null; x?: number; y?: number }): string;
  detach(rootId?: string): string;
  reset(ids?: string[], options?: { all?: boolean }): boolean;
  setSlot(frameId: string, on?: boolean, name?: string): boolean;
  info(nodeId?: string): ComponentInfo | null;
  problems(): { id: string; message: string }[];
};

const api = () => design()?.components as ComponentsApi | undefined;

/** Runs an engine action; a refusal (it throws with a reason) becomes a toast instead of an uncaught error. */
function attempt<T>(fn: (components: ComponentsApi) => T): T | null {
  const components = api();
  if (!components) return null;
  try {
    return fn(components);
  } catch (error) {
    toast.error(error instanceof Error ? error.message : String(error), { id: "component-error" });
    return null;
  }
}

export const componentInfo = (id: string): ComponentInfo | null => {
  try {
    return api()?.info(id) ?? null;
  } catch {
    return null;
  }
};
export const resetOverrides = (ids: string[], all = false) => attempt((c) => c.reset(ids, { all }));
export const detachInstance = (id: string) => attempt((c) => c.detach(id));
export const setSlot = (id: string, on: boolean, name?: string) =>
  attempt((c) => c.setSlot(id, on, name));
/** Runs a canvas command (`component.goToMain`, `component.instance`, …) on the current selection. */
export const runComponentCommand = (id: string) => design().runCommand(id);

/** Selects `id` and runs Go to main component (switches page and zooms when needed). */
export function goToMain(id: string) {
  design().setSelection([id]);
  return runComponentCommand("component.goToMain");
}

/** Layer-row role from the node's own link fields (no document index needed). */
export type LayerRole = "main" | "instance" | "slot" | "inherited" | null;
export function layerRole(n: Partial<LayerNode>): LayerRole {
  if (n.component === true) return "main";
  if (typeof n.instanceOf === "string" && n.instanceOf) return "instance";
  if (n.slot === true) return "slot";
  if (typeof n.sourceId === "string" && n.sourceId) return "inherited";
  return null;
}

export type MainEntry = {
  id: string;
  name: string;
  pageId: string;
  pageName: string;
  instances: number;
};
/** Every main component of the document, in page order, with its instance count. */
export function listMains(doc: DesignDocument): MainEntry[] {
  const instances = new Map<string, number>();
  for (const page of doc.pages)
    for (const n of page.nodes ?? [])
      if (typeof n.instanceOf === "string" && n.sourceId === n.instanceOf)
        instances.set(n.instanceOf, (instances.get(n.instanceOf) ?? 0) + 1);
  const out: MainEntry[] = [];
  for (const page of doc.pages)
    for (const n of page.nodes ?? [])
      if (n.type === "frame" && n.component === true)
        out.push({
          id: n.id,
          name: n.name,
          pageId: page.id,
          pageName: page.name,
          instances: instances.get(n.id) ?? 0,
        });
  return out;
}

/** World point at the centre of the canvas viewport. */
function viewportCenter() {
  const wrap = document.getElementById("canvas-wrap")?.getBoundingClientRect();
  const toWorld = design().screenToWorld as
    | ((x: number, y: number) => { x: number; y: number })
    | undefined;
  if (!wrap || !toWorld) return { x: 0, y: 0 };
  return toWorld(wrap.left + wrap.width / 2, wrap.top + wrap.height / 2);
}

/**
 * Inserts an instance of `mainId` on the active page, centred on `point` (world coordinates; default: the middle
 * of the viewport), and selects it.
 */
export function insertInstance(mainId: string, point?: { x: number; y: number }) {
  const main = design()
    .getDocument()
    .pages.flatMap((p) => p.nodes ?? [])
    .find((n) => n.id === mainId);
  if (!main) return null;
  const at = point ?? viewportCenter();
  return attempt((c) =>
    c.instance(mainId, {
      parentId: null,
      x: Math.round(at.x - (main.w || 0) / 2),
      y: Math.round(at.y - (main.h || 0) / 2),
    }),
  );
}

/* ---------- Presets ---------- */
// Colours of the built-in templates (web/views-templates.js): ink, muted text, surface, white.
const INK = "#24232b",
  MUTED = "#797581",
  SURFACE = "#f5f2ed",
  WHITE = "#ffffff";

type Draft = Partial<LayerNode> & { id: string; type: string; name: string };
const uid = () => crypto.randomUUID();

function frame(name: string, parentId: string | null, extra: Partial<LayerNode> = {}): Draft {
  return {
    id: uid(),
    type: "frame",
    name,
    parentId,
    x: 0,
    y: 0,
    w: 100,
    h: 100,
    color: "transparent",
    radius: 0,
    layout: "flex",
    direction: "row",
    gap: 0,
    padding: 0,
    alignItems: "flex-start",
    justifyContent: "flex-start",
    ...extra,
  };
}
function text(
  name: string,
  parentId: string,
  value: string,
  extra: Partial<LayerNode> = {},
): Draft {
  return {
    id: uid(),
    type: "text",
    name,
    parentId,
    x: 0,
    y: 0,
    w: 120,
    h: 20,
    text: value,
    textRuns: [],
    color: INK,
    fontSize: 14,
    fontWeight: "400",
    wMode: "hug",
    hMode: "hug",
    ...extra,
  };
}
const navItems = (parentId: string, labels: string[], extra: Partial<LayerNode> = {}) =>
  labels.map((label) => text(label, parentId, label, { color: MUTED, ...extra }));

/** App Shell: header (title + nav), sidebar (items) and a `Content` slot, all auto layout. */
function appShell(x: number, y: number): Draft[] {
  const root = frame("App Shell", null, {
    x,
    y,
    w: 1280,
    h: 800,
    direction: "column",
    color: WHITE,
    component: true,
  });
  const header = frame("Header", root.id, {
    h: 64,
    wMode: "fill",
    padding: 20,
    alignItems: "center",
    justifyContent: "space-between",
    color: WHITE,
  });
  const nav = frame("Navigation", header.id, {
    gap: 24,
    wMode: "hug",
    hMode: "hug",
    alignItems: "center",
  });
  const body = frame("Body", root.id, { wMode: "fill", hMode: "fill" });
  const sidebar = frame("Sidebar", body.id, {
    w: 240,
    hMode: "fill",
    direction: "column",
    gap: 12,
    padding: 24,
    color: SURFACE,
  });
  const content = frame("Content", body.id, {
    wMode: "fill",
    hMode: "fill",
    direction: "column",
    gap: 16,
    padding: 32,
    color: WHITE,
    slot: true,
    slotName: "Content",
  });
  return [
    root,
    header,
    text("Title", header.id, "Acme", { fontSize: 18, fontWeight: "600" }),
    nav,
    ...navItems(nav.id, ["Overview", "Projects", "Settings"]),
    body,
    sidebar,
    ...navItems(sidebar.id, ["Dashboard", "Inbox", "Reports", "Team"], { color: INK }),
    content,
  ];
}

/** Page Shell: header (title + nav), a `Content` slot and a footer, all auto layout. */
function pageShell(x: number, y: number): Draft[] {
  const root = frame("Page Shell", null, {
    x,
    y,
    w: 1280,
    h: 900,
    direction: "column",
    color: WHITE,
    component: true,
  });
  const header = frame("Header", root.id, {
    h: 72,
    wMode: "fill",
    padding: 24,
    alignItems: "center",
    justifyContent: "space-between",
    color: WHITE,
  });
  const nav = frame("Navigation", header.id, {
    gap: 28,
    wMode: "hug",
    hMode: "hug",
    alignItems: "center",
  });
  const content = frame("Content", root.id, {
    wMode: "fill",
    hMode: "fill",
    direction: "column",
    gap: 24,
    padding: 48,
    color: WHITE,
    slot: true,
    slotName: "Content",
  });
  const footer = frame("Footer", root.id, {
    h: 64,
    wMode: "fill",
    padding: 24,
    alignItems: "center",
    color: SURFACE,
  });
  return [
    root,
    header,
    text("Title", header.id, "Acme", { fontSize: 20, fontWeight: "600" }),
    nav,
    ...navItems(nav.id, ["Product", "Pricing", "About"]),
    content,
    footer,
    text("Footer text", footer.id, "© Acme", { color: MUTED, fontSize: 13 }),
  ];
}

export const PRESETS = {
  appShell: { label: "App shell", build: appShell, w: 1280, h: 800 },
  pageShell: { label: "Page shell", build: pageShell, w: 1280, h: 900 },
} as const;
export type PresetId = keyof typeof PRESETS;

/** Adds a preset main component in the middle of the viewport (one undo step) and selects it. */
export function insertPreset(id: PresetId): string | null {
  const preset = PRESETS[id];
  const c = viewportCenter();
  const nodes = preset.build(Math.round(c.x - preset.w / 2), Math.round(c.y - preset.h / 2));
  const doc = design().getDocument();
  const page = doc.pages.find((p) => p.id === doc.activePage) ?? doc.pages[0];
  page.nodes.push(...(nodes as LayerNode[]));
  try {
    design().setDocument(doc);
  } catch (error) {
    toast.error(error instanceof Error ? error.message : String(error), { id: "component-error" });
    return null;
  }
  design().setSelection([nodes[0].id]);
  return nodes[0].id;
}

/* ---------- Notices from the canvas (refused moves, failed commands) ---------- */
let listening = false;
/** Shows the canvas's `bd:notice` events (e.g. a refused component cycle) as toasts; installed once. */
export function listenForNotices() {
  if (listening) return;
  listening = true;
  window.addEventListener("bd:notice", (event) => {
    const message = (event as CustomEvent<{ message?: string }>).detail?.message;
    if (message) toast(message, { id: "canvas-notice" });
  });
}

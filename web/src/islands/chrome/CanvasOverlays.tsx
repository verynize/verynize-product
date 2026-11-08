// Floating controls inside #workspace: bottom toolbar + views menu (20/22/19), page pill (22/29), `?` help and the
// zoom readout + zoom menu. Rendered through a portal into a host appended to #workspace.
import { useState, type ComponentType, type ReactNode } from "react";
import {
  Check,
  ChevronsUpDown,
  File,
  Hand,
  MousePointer2,
  PenTool,
  Pin,
  SquareArrowUpRight,
  Scan,
  Search,
  Type,
} from "lucide-react";
import { activePage, legacySet, legacy, useBodyClass, useDesign } from "@/lib/bridge";
import { cn } from "@/lib/utils";
import {
  CanvasLayoutIcon,
  DesignLayoutIcon,
  DetailsLayoutIcon,
  LogoIcon,
  PanelLeftIcon,
  ShaderIcon,
  PlusIcon,
} from "@/components/icons";
import {
  applyLayout,
  currentLayout,
  isExactLayout,
  LAYOUTS,
  toggleBodyClass,
  useAppliedLayout,
  useTool,
  useZoom,
  type LayoutName,
} from "./hooks";
import { initialSnap, run } from "./legacy";
import { HelpMenu } from "./HelpMenu";
import {
  Kbd,
  MenuContent,
  MenuGroup,
  MenuItem,
  MenuLabel,
  MenuPseudoLabelItem,
  MenuRoot,
  MenuSeparator,
  MenuTrigger,
  Shortcut,
} from "./menu";
import { Tip } from "./tip";
import { FindLayersPanel } from "./find-layers/FindLayersPanel";
import { setPanelOpen } from "./shortcuts";
import { PreviewToolbar } from "./PreviewToolbar";

type Icon = ComponentType<{ className?: string }>;
// Wonder T1: Move, Scale, Hand | Frame, Shader, Text, plus Verynize's Pen (vector layers, web/vector-edit.js).
// Eyedropper (I) and Ellipse (O) stay on the keyboard and in the command palette.
const TOOLS: { id: string; tool: string; label: string; key: string; icon: Icon }[] = [
  { id: "select-tool", tool: "move", label: "Move", key: "V", icon: MousePointer2 },
  { id: "scale-tool", tool: "scale", label: "Scale", key: "K", icon: SquareArrowUpRight },
  { id: "pan-tool", tool: "hand", label: "Hand", key: "H", icon: Hand },
  { id: "add-frame", tool: "frame", label: "Frame", key: "F", icon: Scan },
  { id: "add-shader", tool: "shader", label: "Shader", key: "S", icon: ShaderIcon },
  { id: "text", tool: "text", label: "Text", key: "T", icon: Type },
  { id: "pen-tool", tool: "pen", label: "Pen", key: "P", icon: PenTool },
];
/** Index of the first creation tool (Frame); a divider separates it from the pointer tools. */
const TOOL_GROUP_SPLIT = TOOLS.findIndex((t) => t.id === "add-frame");
// Viewers in a shared room (body.cloud-read-only) get Move and Hand only, as in Wonder (share-audit collab/13).
const VIEWER_TOOLS = TOOLS.filter((t) => t.tool === "move" || t.tool === "hand");
const LAYOUT_ICONS: Record<LayoutName, Icon> = {
  details: DetailsLayoutIcon,
  design: DesignLayoutIcon,
  canvas: CanvasLayoutIcon,
};

// 32px tool buttons (22): resets legacy `#canvas-toolbar button` rules (padding, min-width, borders, backgrounds).
const toolButton =
  "flex size-8 min-w-0 shrink-0 items-center justify-center rounded-xl border-0 bg-transparent p-0 text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-1 focus-visible:ring-primary focus-visible:ring-inset [&_svg]:size-5";
const layoutButton =
  "flex size-7 min-w-0 shrink-0 items-center justify-center rounded-lg border-0 bg-transparent p-0 text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-1 focus-visible:ring-primary focus-visible:ring-inset aria-expanded:bg-accent aria-expanded:text-foreground [&_svg]:size-5";
const floating = "absolute z-30 border border-toolbar-edge bg-background";

export function CanvasOverlays() {
  const filesView = useBodyClass("files-view");
  const leftCollapsed = useBodyClass("left-collapsed");
  if (filesView) return <ZoomProxies />;
  return (
    <>
      <Toolbar />
      <FindLayersPanel />
      <PreviewToolbar />
      {leftCollapsed && <PagePill />}
      <HelpMenu />
      <Zoom />
    </>
  );
}

/* ---------- Bottom toolbar ---------- */
function Toolbar() {
  const tool = useTool();
  const readOnly = useBodyClass("cloud-read-only");
  const tools = readOnly ? VIEWER_TOOLS : TOOLS;
  useBodyClass("left-collapsed");
  useBodyClass("right-collapsed");
  const layout = currentLayout();
  // Wonder (canvas audit T1, T3, T4, V3 …): the toggle of the panel layout on screen stays drawn active even when the
  // view reads "Design · edited"; only while the views menu is open does the `+` take the highlight (T2-plus).
  const [viewsOpen, setViewsOpen] = useState(false);
  const active = isExactLayout() && !viewsOpen;
  return (
    <div
      id="canvas-toolbar"
      role="toolbar"
      aria-label="Canvas tools"
      className={cn(
        floating,
        "bottom-3 left-1/2 flex h-11 -translate-x-1/2 transform-none items-stretch gap-0 rounded-3xl p-0 shadow-toolbar",
      )}
    >
      <div className="flex items-center gap-1 pr-2 pl-1.5">
        {tools.map(({ id, tool: name, label, key, icon: Icon }, index) => (
          <ToolSlot key={id} separator={!readOnly && index === TOOL_GROUP_SPLIT}>
            <Tip label={label} shortcut={key}>
              <button
                type="button"
                id={id}
                aria-label={label}
                aria-pressed={tool === name}
                className={cn(
                  toolButton,
                  tool === name && "bg-accent text-foreground hover:bg-accent",
                )}
                onClick={() => (name === "text" || name === "pen" ? toggleTool(name) : run(id))}
              >
                <Icon />
              </button>
            </Tip>
          </ToolSlot>
        ))}
        <ToolSlot separator>
          <Tip label="Find layers" shortcut="⌘F">
            <button
              type="button"
              id="find-layers-button"
              aria-label="Find layers"
              className={toolButton}
              onClick={() => setPanelOpen("find", true)}
            >
              <Search />
            </button>
          </Tip>
        </ToolSlot>
      </div>
      <span aria-hidden="true" className="w-px shrink-0 bg-toolbar-divider" />
      <div className="flex items-center pr-1.5 pl-2">
        <div className="flex h-8 items-center gap-0.5 rounded-xl bg-muted p-0.5">
          {LAYOUTS.filter((l) => l.name !== "canvas").map(({ name, label, key }) => {
            const Icon = LAYOUT_ICONS[name];
            return (
              <Tip key={name} label={label} shortcut={`⌥${key}`}>
                <button
                  type="button"
                  id={`layout-${name}`}
                  aria-label={`${label} layout`}
                  aria-pressed={active && layout === name}
                  className={cn(
                    layoutButton,
                    active &&
                      layout === name &&
                      "bg-accent text-primary-text hover:text-primary-text",
                  )}
                  onClick={() => applyLayout(name)}
                >
                  <Icon />
                </button>
              </Tip>
            );
          })}
          <ViewMenu layout={layout} open={viewsOpen} onOpenChange={setViewsOpen} />
        </div>
      </div>
    </div>
  );
}

/** Text and Pen arm the tool like Frame does (Wonder TX1): canvas clicks then create the layer. */
function toggleTool(name: string) {
  window.design.setTool(window.design.getTool() === name ? "move" : name);
}

function ToolSlot({ separator, children }: { separator: boolean; children: ReactNode }) {
  return (
    <>
      {separator && <span aria-hidden="true" className="h-5 w-px shrink-0 bg-toolbar-divider" />}
      {children}
    </>
  );
}

/* ---------- Views menu (19) ---------- */
function ViewMenu({
  layout,
  open,
  onOpenChange: setOpen,
}: {
  layout: LayoutName;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const edited = useAppliedLayout() !== layout || !isExactLayout();
  const label = LAYOUTS.find((l) => l.name === layout)?.label ?? "Design";
  const choose = applyLayout;
  return (
    <MenuRoot open={open} onOpenChange={setOpen} modal={false}>
      <Tip label="Save or choose a view">
        <MenuTrigger asChild>
          <button
            type="button"
            id="bd-view-menu-button"
            aria-label="Views"
            className={layoutButton}
          >
            <PlusIcon />
          </button>
        </MenuTrigger>
      </Tip>
      <MenuContent side="top" align="end" sideOffset={8} className="w-view-menu">
        <MenuGroup>
          <MenuLabel>
            {label}
            {edited ? " · edited" : ""}
          </MenuLabel>
          <MenuItem onSelect={() => run("saved-views-open")}>Save current view</MenuItem>
          <MenuItem
            onSelect={() => {
              choose(layout);
              run("zoom-fit");
            }}
          >
            Reset to {label}
          </MenuItem>
        </MenuGroup>
        <MenuSeparator />
        <MenuGroup>
          {LAYOUTS.map(({ name, label: text, key }) => {
            const Icon = LAYOUT_ICONS[name];
            return (
              <MenuItem key={name} aria-checked={layout === name} onSelect={() => choose(name)}>
                <Icon />
                {text}
                {name !== "canvas" && <Pin className="size-3.5 rotate-45 text-muted-foreground" />}
                <Kbd keys={["⌥", key]} className="mr-4" />
              </MenuItem>
            );
          })}
        </MenuGroup>
      </MenuContent>
    </MenuRoot>
  );
}

/* ---------- Page pill (sidebar hidden / chat open) ---------- */
function PagePill() {
  const doc = useDesign();
  const page = doc ? activePage(doc) : null;
  return (
    <div
      id="bd-page-pill"
      role="group"
      aria-label="Page"
      className={cn(
        floating,
        "top-1.75 left-1.75 flex h-10.5 w-page-pill items-center rounded-lg p-1.5",
      )}
    >
      <Tip label="Main menu" side="bottom">
        <button
          type="button"
          aria-label="Main menu"
          ref={markAppMenuTrigger}
          className="flex size-7 shrink-0 items-center justify-center rounded-lg text-foreground outline-none hover:bg-muted focus-visible:ring-1 focus-visible:ring-ring [&_svg]:size-4"
        >
          <LogoIcon />
        </button>
      </Tip>
      <MenuRoot modal={false}>
        <MenuTrigger asChild>
          <button
            type="button"
            aria-label="Switch page"
            className="flex h-7 min-w-0 items-center gap-1.5 rounded-lg px-1.5 text-xs text-foreground outline-none hover:bg-muted focus-visible:ring-1 focus-visible:ring-ring aria-expanded:bg-muted"
          >
            <span className="truncate">{page?.name ?? "Page"}</span>
            <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" />
          </button>
        </MenuTrigger>
        <MenuContent align="start" sideOffset={10} alignOffset={-36} className="w-page-pill">
          <MenuGroup>
            <MenuLabel>Pages</MenuLabel>
            {doc?.pages.map((p) => (
              <MenuItem
                key={p.id}
                aria-checked={p.id === doc.activePage}
                onSelect={() => window.design.setActivePage(p.id)}
              >
                <File />
                <span className="truncate">{p.name}</span>
                {p.id === doc.activePage && <Check className="ml-auto" />}
              </MenuItem>
            ))}
          </MenuGroup>
          <MenuSeparator />
          <MenuGroup>
            <MenuItem onSelect={() => run("add-page")}>
              <PlusIcon />
              New page
            </MenuItem>
          </MenuGroup>
        </MenuContent>
      </MenuRoot>
      <div className="flex-1" />
      <Tip label="Show sidebar" side="bottom">
        <button
          type="button"
          aria-label="Show sidebar"
          className="flex size-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring [&_svg]:size-4"
          onClick={() => toggleBodyClass("left-collapsed", false)}
        >
          <PanelLeftIcon />
        </button>
      </Tip>
    </div>
  );
}

/** `.app-menu-trigger` is the cross-island contract class (tests click `.app-menu-trigger:visible`); it is a marker,
 * not a Tailwind class, so it is added outside className. */
function markAppMenuTrigger(node: HTMLButtonElement | null) {
  node?.classList.add("app-menu-trigger");
}

/* ---------- Zoom readout + menu ---------- */
// Wonder T6: Zoom to 50%, Zoom to 100% ⇧0, Zoom to 200% | Zoom in ⌘+, Zoom out ⌘−, Zoom to fit ⇧1.
// Snap to objects and Saved views… moved out of this menu: both are in the ⌘K command palette, and Saved views is
// also the `+` views menu's "Save current view". Their ids stay on hidden proxies for legacy code and tests.
let snapState = initialSnap;
function useSnap(): [boolean, (value: boolean) => void] {
  const [snap, setSnapState] = useState(() => snapState);
  return [
    snap,
    (value) => {
      snapState = value;
      setSnapState(value);
      legacySet(legacy<HTMLInputElement>("snap"), value);
    },
  ];
}

const zoomTo = (percent: 50 | 200) => () => window.design.runCommand(`view.zoom${percent}`);

function Zoom() {
  const zoom = useZoom();
  const [open, setOpen] = useState(false);
  return (
    <>
      <MenuRoot open={open} onOpenChange={setOpen} modal={false}>
        <MenuTrigger asChild>
          <button
            type="button"
            id="zoom-menu-button"
            aria-label={`Zoom ${zoom}%`}
            className="absolute right-2 bottom-2 z-30 flex h-6 items-center rounded-md px-2 text-xs text-muted-foreground tabular-nums outline-none hover:bg-muted hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring aria-expanded:bg-muted aria-expanded:text-foreground"
          >
            {zoom}%
          </button>
        </MenuTrigger>
        <MenuContent
          id="bd-zoom-menu"
          aria-label="Zoom"
          side="top"
          align="end"
          sideOffset={6}
          className="w-44"
        >
          <MenuGroup>
            <MenuItem id="zoom-50" onSelect={zoomTo(50)}>
              Zoom to 50%
            </MenuItem>
            {/* Text content stays the live percentage (tests and legacy applyCamera() use it); the visible
                label "Zoom to 100% ⇧0" comes from chrome.css ::before/::after. */}
            <MenuPseudoLabelItem
              id="zoom-reset"
              data-zoom-reset=""
              aria-label="Zoom to 100%"
              onSelect={() => run("zoom-reset")}
            >
              {`${zoom}%`}
            </MenuPseudoLabelItem>
            <MenuItem id="zoom-200" onSelect={zoomTo(200)}>
              Zoom to 200%
            </MenuItem>
          </MenuGroup>
          <MenuSeparator />
          <MenuGroup>
            <MenuItem id="zoom-in" onSelect={() => run("zoom-in")}>
              Zoom in
              <Shortcut>⌘+</Shortcut>
            </MenuItem>
            <MenuItem id="zoom-out" onSelect={() => run("zoom-out")}>
              Zoom out
              <Shortcut>⌘−</Shortcut>
            </MenuItem>
            <MenuItem id="zoom-fit" onSelect={() => run("zoom-fit")}>
              Zoom to fit
              <Shortcut>⇧1</Shortcut>
            </MenuItem>
          </MenuGroup>
        </MenuContent>
      </MenuRoot>
      <ZoomProxies zoom={zoom} menuOpen={open} />
    </>
  );
}

/** Hidden owners of the zoom ids while the zoom menu is closed (or the editor is behind Files), plus the snap
 * checkbox and the saved-views command, which no longer have a place in the zoom menu. */
function ZoomProxies({ zoom, menuOpen = false }: { zoom?: number; menuOpen?: boolean }) {
  const fallbackZoom = useZoom();
  const [snap, setSnap] = useSnap();
  return (
    <div hidden data-chrome-proxies="zoom">
      {!menuOpen && (
        <>
          {(["zoom-in", "zoom-out", "zoom-fit"] as const).map((id) => (
            <button key={id} type="button" id={id} tabIndex={-1} onClick={() => run(id)} />
          ))}
          <button type="button" id="zoom-reset" tabIndex={-1} onClick={() => run("zoom-reset")}>
            {`${zoom ?? fallbackZoom}%`}
          </button>
        </>
      )}
      <button
        type="button"
        id="saved-views-open"
        tabIndex={-1}
        onClick={() => run("saved-views-open")}
      />
      <input
        type="checkbox"
        id="snap"
        tabIndex={-1}
        checked={snap}
        onChange={(event) => setSnap(event.target.checked)}
      />
    </div>
  );
}

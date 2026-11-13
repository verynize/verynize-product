// Main app menu: every command without another home (undo/redo, file, insert, page, settings).
// Opened by any `.app-menu-trigger` click or `window.dispatchEvent(new CustomEvent("bd:open-app-menu", {detail:{anchor}}))`.
// Command ids stay reachable: inside the open menu they are menu items; while it is closed hidden proxies own them
// (tests call e.g. `document.getElementById('delete-page').click()`; legacy shortcuts call `$('#undo').click()`).
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";
import {
  Braces,
  Code,
  Download,
  FolderOpen,
  Globe,
  ImageIcon,
  Lock,
  LayoutGrid,
  MonitorPlay,
  Pencil,
  PenTool,
  Play,
  Redo2,
  Save,
  ScanLine,
  Settings,
  Square,
  Star,
  Trash2,
  Undo2,
  FolderGit2,
} from "lucide-react";
import { legacySet, useDesign } from "@/lib/bridge";
import { legacySelect, MENU_IDS, run } from "./legacy";
import {
  MenuContent,
  MenuGroup,
  MenuItem,
  MenuLabel,
  MenuRoot,
  MenuSeparator,
  MenuTrigger,
  Shortcut,
} from "./menu";
import { useIconKinds } from "./useIconKinds";
import { requestVisibility, useCloudState } from "../share/api";

type Command = {
  id: (typeof MENU_IDS)[number];
  label: string;
  icon: ComponentType<{ className?: string }>;
  shortcut?: string;
};
const GROUPS: { label?: string; items: Command[] }[] = [
  {
    items: [
      { id: "undo", label: "Undo", icon: Undo2, shortcut: "⌘Z" },
      { id: "redo", label: "Redo", icon: Redo2, shortcut: "⇧⌘Z" },
    ],
  },
  {
    label: "File",
    items: [
      { id: "open-project", label: "Open design…", icon: FolderOpen, shortcut: "⌘O" },
      { id: "save-project", label: "Save design", icon: Save, shortcut: "⌘S" },
      { id: "export", label: "Export HTML", icon: Download },
      { id: "preview", label: "Preview", icon: Play },
      { id: "show-live-preview", label: "Running app", icon: MonitorPlay },
      { id: "project-toggle", label: "Code workspace", icon: FolderGit2 },
      { id: "templates-open", label: "Templates", icon: LayoutGrid },
    ],
  },
  {
    label: "Insert",
    items: [
      { id: "rectangle", label: "Rectangle", icon: Square, shortcut: "R" },
      { id: "image", label: "Image / SVG", icon: ImageIcon },
      { id: "add-icon", label: "Icon", icon: Star },
      { id: "import", label: "Import HTML", icon: Code },
      { id: "figma-import", label: "Import Figma", icon: PenTool },
      { id: "trace-bitmap", label: "Trace selected bitmap", icon: ScanLine },
      { id: "capture-webpage", label: "Capture web page", icon: Globe },
      { id: "import-tokens", label: "Paste CSS variables", icon: Braces },
    ],
  },
  {
    label: "Page",
    items: [
      { id: "rename-page", label: "Rename page", icon: Pencil },
      { id: "delete-page", label: "Delete page", icon: Trash2 },
    ],
  },
  { items: [{ id: "shell-settings", label: "Settings", icon: Settings, shortcut: "⌘," }] },
];

// Former project-dialog actions (web/desktop-panel.js window.agentWorkspace.actions), listed under File.
type WorkspaceActions = Partial<Record<"saveDesignAs" | "captureApp" | "exportPDF", () => void>>;
const FILE_ACTIONS: {
  id: string;
  action: keyof WorkspaceActions;
  label: string;
  icon: ComponentType<{ className?: string }>;
}[] = [
  { id: "design-save-as", action: "saveDesignAs", label: "Save design as…", icon: Save },
  {
    id: "project-capture",
    action: "captureApp",
    label: "Capture app to canvas",
    icon: MonitorPlay,
  },
  { id: "project-pdf", action: "exportPDF", label: "Export PDF", icon: Download },
];
const workspaceActions = () =>
  (window.agentWorkspace as unknown as { actions?: WorkspaceActions } | undefined)?.actions;

const exists = (id: string) =>
  !!(document.getElementById(`legacy-${id}`) || document.getElementById(id));

export function AppMenu() {
  const doc = useDesign();
  const [open, setOpen] = useState(false);
  const [available, setAvailable] = useState<Set<string>>(() => new Set(MENU_IDS.filter(exists)));
  const anchorRef = useRef<HTMLElement | null>(null);
  const triggerRef = useRef<HTMLSpanElement>(null);
  const openRef = useRef(false);
  const skipClick = useRef<EventTarget | null>(null);
  const iconKinds = useIconKinds();
  const cloud = useCloudState();
  // Wonder SL4 File menu: one entry toggling the file's visibility, confirmed by the share island's dialog.
  const makePublic = cloud.visibility !== "public";
  const canChangeVisibility = !cloud.connected || cloud.role === "owner";

  const show = useCallback((anchor: HTMLElement | null) => {
    anchorRef.current = anchor;
    const trigger = triggerRef.current;
    if (trigger) {
      const rect = anchor?.getBoundingClientRect() ?? new DOMRect(8, 40, 0, 0);
      Object.assign(trigger.style, {
        left: `${rect.left}px`,
        top: `${rect.top}px`,
        width: `${rect.width}px`,
        height: `${rect.height}px`,
      });
    }
    // Some commands are created late by desktop-only modules; refresh which ones exist.
    setAvailable(new Set(MENU_IDS.filter(exists)));
    setOpen(true);
  }, []);

  useEffect(() => {
    openRef.current = open;
  }, [open]);

  useEffect(() => {
    const onEvent = (event: Event) =>
      show((event as CustomEvent<{ anchor?: HTMLElement }>).detail?.anchor ?? null);
    // Route every `.app-menu-trigger` (sidebar header, page pill, …) here, whoever rendered it.
    const triggerOf = (event: Event) =>
      event.target instanceof Element
        ? event.target.closest<HTMLElement>(".app-menu-trigger")
        : null;
    const onPointerDown = (event: PointerEvent) => {
      const trigger = triggerOf(event);
      skipClick.current =
        trigger && openRef.current && anchorRef.current === trigger ? trigger : null;
    };
    const onClick = (event: MouseEvent) => {
      const trigger = triggerOf(event);
      if (!trigger) return;
      event.stopImmediatePropagation();
      event.preventDefault();
      if (skipClick.current === trigger) {
        skipClick.current = null;
        return;
      }
      show(trigger);
    };
    window.addEventListener("bd:open-app-menu", onEvent);
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("bd:open-app-menu", onEvent);
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("click", onClick, true);
    };
  }, [show]);

  const canUndo = doc ? window.design.canUndo() : false;
  const canRedo = doc ? window.design.canRedo() : false;
  const disabled: Partial<Record<string, boolean>> = {
    undo: !canUndo,
    redo: !canRedo,
    "delete-page": (doc?.pages.length ?? 0) < 2,
  };

  const iconKind = (
    <select
      id="icon-kind"
      aria-label="Icon shape"
      value={iconKinds.value}
      onChange={(event) => {
        legacySet(legacySelect("icon-kind"), event.target.value);
        iconKinds.refresh();
        setOpen(false);
      }}
      onKeyDown={(event) => event.stopPropagation()}
      className="h-5 shrink-0 rounded-sm bg-input px-1.5 text-xs text-foreground-2 outline-none focus-visible:ring-1 focus-visible:ring-ring"
    >
      {iconKinds.options.map(([value, label]) => (
        <option key={value} value={value}>
          {label}
        </option>
      ))}
    </select>
  );

  return (
    <>
      <MenuRoot open={open} onOpenChange={setOpen} modal={false}>
        <MenuTrigger asChild>
          <span
            ref={triggerRef}
            aria-hidden="true"
            tabIndex={-1}
            className="pointer-events-none fixed"
          />
        </MenuTrigger>
        <MenuContent
          id="bd-app-menu"
          aria-label="Main menu"
          align="start"
          sideOffset={6}
          className="w-app-menu"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            const active = document.activeElement;
            if (!active || active === document.body)
              anchorRef.current?.focus({ preventScroll: true });
          }}
        >
          {GROUPS.map((group, index) => {
            const items = group.items.filter((item) => available.has(item.id));
            if (!items.length) return null;
            return (
              <Section key={group.label ?? index} label={group.label} first={index === 0}>
                {items.map(({ id, label, icon: Icon, shortcut }) => {
                  const item = (
                    <MenuItem
                      key={id}
                      id={id}
                      disabled={disabled[id]}
                      className={id === "add-icon" ? "flex-1" : undefined}
                      onSelect={() => run(id)}
                    >
                      <Icon />
                      <span className="truncate">{label}</span>
                      {shortcut ? <Shortcut>{shortcut}</Shortcut> : null}
                    </MenuItem>
                  );
                  if (id !== "add-icon") return item;
                  return (
                    <div key={id} className="flex items-center gap-1 pr-1">
                      {item}
                      {iconKind}
                    </div>
                  );
                })}
                {group.label === "File" && (
                  <MenuItem
                    id={makePublic ? "file-make-public" : "file-make-private"}
                    disabled={!canChangeVisibility}
                    // After the menu has closed, so its focus return does not fight the dialog.
                    onSelect={() =>
                      requestAnimationFrame(() =>
                        requestVisibility(makePublic ? "public" : "private"),
                      )
                    }
                  >
                    {makePublic ? <Globe /> : <Lock />}
                    <span className="truncate">
                      {makePublic ? "Make file public" : "Make file private"}
                    </span>
                  </MenuItem>
                )}
                {group.label === "File" &&
                  workspaceActions() &&
                  FILE_ACTIONS.map(({ id, action, label, icon: Icon }) => (
                    <MenuItem key={id} id={id} onSelect={() => workspaceActions()?.[action]?.()}>
                      <Icon />
                      <span className="truncate">{label}</span>
                    </MenuItem>
                  ))}
              </Section>
            );
          })}
        </MenuContent>
      </MenuRoot>

      {!open && (
        <div hidden data-chrome-proxies="app-menu">
          {MENU_IDS.map((id) => (
            <button key={id} type="button" id={id} tabIndex={-1} onClick={() => run(id)} />
          ))}
          <select
            id="icon-kind"
            tabIndex={-1}
            value={iconKinds.value}
            onChange={(event) => {
              legacySet(legacySelect("icon-kind"), event.target.value);
              iconKinds.refresh();
            }}
          >
            {iconKinds.options.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
      )}
    </>
  );
}

function Section({
  label,
  first,
  children,
}: {
  label?: string;
  first: boolean;
  children: ReactNode;
}) {
  return (
    <>
      {!first && <MenuSeparator />}
      <MenuGroup>
        {label ? <MenuLabel>{label}</MenuLabel> : null}
        {children}
      </MenuGroup>
    </>
  );
}

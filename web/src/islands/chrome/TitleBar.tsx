// Window chrome (03/11/22/29): 40px bar, traffic-light inset, sidebar + chat toggles, Files tab, document tab,
// new file, search and the design/code mode switch. The bar drags the window; controls opt out (no-drag).
import {
  useEffect,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { Braces, File, LayoutGrid, MessageSquare, Palette, Search, X } from "lucide-react";
import { PanelLeftIcon, PlusIcon } from "@/components/icons";
import { legacy, legacySet, useBodyClass, useDesign } from "@/lib/bridge";
import { can } from "@/lib/platform";
import { cn } from "@/lib/utils";
import { Menu, MenuContent, MenuItem, MenuSeparator } from "../context-menu/parts";
import {
  closeFileTab,
  closeOtherFileTabs,
  moveFileTab,
  openFileTab,
  useFileTabs,
} from "./file-tabs";
import { openFileSwitcher } from "./FileSwitcher";
import { run } from "./legacy";
import { PreviewTabs } from "./preview-tab/PreviewTabs";
import {
  activate as showPreviewTab,
  close as closePreviewTab,
  usePreviewTabs,
  VIEW_CLASS,
} from "./preview-tab/store";
import { Tip } from "./tip";

const iconButton =
  "flex size-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground outline-none hover:bg-muted hover:text-foreground-2 focus-visible:ring-1 focus-visible:ring-ring [&_svg]:size-4";
const tab =
  "flex h-7 min-w-0 shrink-0 items-center gap-1.5 rounded-lg border border-transparent pr-2.5 pl-2 text-xs whitespace-nowrap text-muted-foreground outline-none hover:text-foreground-2 focus-visible:ring-1 focus-visible:ring-ring [&_svg]:size-4 [&_svg]:shrink-0";
const tabActive = "border-tab-edge bg-input text-foreground hover:text-foreground";

export function TitleBar() {
  const doc = useDesign();
  const filesView = useBodyClass("files-view");
  // An expanded preview tab (preview-tab/) is the visible tab instead of the design file.
  const previewTabView = useBodyClass(VIEW_CLASS);
  const documentActive = !filesView && !previewTabView;
  const chatOpen = useBodyClass("agent-chat-open");
  // The sidebar toggle shows the repositories / chats list (code island, `body.chat-sidebar-open`), not the layers.
  const chatSidebarOpen = useBodyClass("chat-sidebar-open");
  // Code mode (web/src/islands/code): the bar turns transparent over the code workspace and hosts its breadcrumb.
  const codeMode = useBodyClass("code-mode");
  const codeSidebarCollapsed = useBodyClass("code-sidebar-collapsed");
  const nameRef = useRef<HTMLInputElement>(null);
  // The tab is a plain tab (arrow cursor, click to show the file); double-click renames the file in place.
  const [renaming, setRenaming] = useState(false);
  useEffect(() => {
    if (!renaming) return;
    nameRef.current?.focus();
    nameRef.current?.select();
  }, [renaming]);
  const { tabs: previewTabs } = usePreviewTabs();
  const { tabs: fileTabs, currentId, hidden: currentHidden, pendingId } = useFileTabs();
  // The repositories / chats sidebar lists local repositories: desktop only.
  const repositories = can("projects");

  const commitName = () => {
    setRenaming(false);
    const input = nameRef.current;
    const original = legacy<HTMLInputElement>("document-name");
    if (!input || !original) return;
    const value = input.value.trim() || "Untitled";
    if (value === doc?.name) {
      input.value = value;
      return;
    }
    legacySet(original, value);
  };
  // "Other tabs" are the other open files and the expanded preview tabs.
  const closeOthers = (id: string) => {
    for (const tab of previewTabs) closePreviewTab(tab.frameId);
    showPreviewTab(null);
    closeOtherFileTabs(id);
  };
  // Drag a tab to reorder the strip: the strip reorders live while the tab passes over its neighbours' midpoints.
  const [dragging, setDragging] = useState<string | null>(null);
  const dragProps = (id: string) => ({
    draggable: !renaming,
    "data-dragging": dragging === id ? "" : undefined,
    onDragStart: (event: DragEvent<HTMLDivElement>) => {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("application/x-verynize-file-tab", id);
      setDragging(id);
    },
    onDragOver: (event: DragEvent<HTMLDivElement>) => {
      if (!dragging) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      if (dragging === id) return;
      const rect = event.currentTarget.getBoundingClientRect();
      const after = event.clientX > rect.left + rect.width / 2;
      const rest = fileTabs.map((file) => file.id).filter((tab) => tab !== dragging);
      moveFileTab(dragging, rest.indexOf(id) + (after ? 1 : 0));
    },
    onDrop: (event: DragEvent<HTMLDivElement>) => {
      if (dragging) event.preventDefault();
      setDragging(null);
    },
    onDragEnd: () => setDragging(null),
  });
  const showFile = (id: string) => {
    showPreviewTab(null);
    openFileTab(id);
  };
  // Right-click menu of a file tab (New Tab opens the file switcher, like the + button).
  const tabMenu = (id: string, children: ReactNode) => (
    <Menu.Root key={id} modal={false}>
      <Menu.Trigger asChild>{children}</Menu.Trigger>
      <MenuContent data-file-tab-menu={id}>
        <MenuItem label="New Tab" onSelect={openFileSwitcher} />
        <MenuSeparator />
        <MenuItem label="Close Tab" onSelect={() => closeFileTab(id)} />
        <MenuItem
          label="Close Other Tabs"
          disabled={fileTabs.length < 2 && !previewTabs.length}
          onSelect={() => closeOthers(id)}
        />
        <MenuSeparator />
        <MenuItem label="Reload" onSelect={() => window.location.reload()} />
      </MenuContent>
    </Menu.Root>
  );
  const closeButton = (id: string, name: string, group: string) => (
    <button
      type="button"
      data-file-tab-close={id}
      aria-label={`Close ${name}`}
      className={cn(
        "invisible ml-1 flex size-4 shrink-0 items-center justify-center rounded-sm text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:visible focus-visible:ring-1 focus-visible:ring-ring [&_svg]:size-3",
        group,
      )}
      onClick={(event) => {
        event.stopPropagation();
        closeFileTab(id);
      }}
    >
      <X />
    </button>
  );

  const onNameKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (!renaming) {
      if (event.key === "Enter" || event.key === "F2") setRenaming(true);
      return;
    }
    if (event.key === "Enter") event.currentTarget.blur();
    if (event.key === "Escape") {
      event.currentTarget.value = doc?.name ?? "";
      event.currentTarget.blur();
    }
    event.stopPropagation();
  };

  // The shown design file's tab owns `#document-name` (legacy render() writes it), so it always renders; it is hidden
  // while the file has no tab (its tab was closed and Files took over).
  const documentTab = (
    <div
      data-document-tab=""
      data-file-tab={currentId ?? undefined}
      {...(currentId && !currentHidden ? dragProps(currentId) : {})}
      aria-current={documentActive ? "page" : undefined}
      className={cn(
        tab,
        "group/document-tab min-w-0 shrink gap-0 pr-1 data-dragging:opacity-50",
        documentActive && !pendingId && tabActive,
        currentHidden && "hidden",
      )}
      onClick={() => {
        showPreviewTab(null);
        if (filesView)
          (window.fileLibrary as { showEditor?: () => void } | undefined)?.showEditor?.();
      }}
      onDoubleClick={() => setRenaming(true)}
    >
      <File className="mr-1.5" />
      <input
        ref={nameRef}
        id="document-name"
        aria-label="Document name"
        defaultValue={doc?.name ?? "Untitled"}
        readOnly={!renaming}
        spellCheck={false}
        onBlur={() => renaming && commitName()}
        onKeyDown={onNameKey}
        className={cn(
          "field-sizing-content h-5 max-w-tab-name min-w-6 truncate rounded-sm bg-transparent text-xs text-inherit outline-none",
          renaming
            ? "cursor-text bg-background text-foreground ring-1 ring-ring"
            : "pointer-events-none cursor-default select-none focus-visible:ring-1 focus-visible:ring-ring",
        )}
      />
      {currentId
        ? closeButton(currentId, doc?.name ?? "Untitled", "group-hover/document-tab:visible")
        : null}
    </div>
  );

  return (
    <div
      role="banner"
      data-chrome-bar=""
      className={cn(
        "relative z-40 flex h-chrome shrink-0 items-center border-b pr-2 text-xs select-none",
        codeMode
          ? "border-transparent bg-transparent pl-0"
          : chatOpen
            ? "border-divider bg-background pl-chat-dock"
            : chatSidebarOpen
              ? "border-divider bg-background pl-2"
              : "border-divider bg-background pl-traffic",
      )}
    >
      {codeMode && (
        <>
          <div
            className={cn(
              "flex h-full shrink-0 items-center pl-traffic",
              !codeSidebarCollapsed && "w-code-sidebar",
            )}
          >
            <Tip
              label={codeSidebarCollapsed ? "Show sidebar" : "Hide sidebar"}
              shortcut="⌘B"
              side="bottom"
            >
              <button
                type="button"
                id="code-sidebar-toggle"
                aria-label="Toggle sidebar"
                aria-pressed={!codeSidebarCollapsed}
                className={cn(iconButton, "ml-0.5")}
                onClick={() => document.body.classList.toggle("code-sidebar-collapsed")}
              >
                <PanelLeftIcon />
              </button>
            </Tip>
          </div>
          <div id="bd-code-titlebar" className="flex h-full min-w-0 flex-1 items-center pl-3" />
        </>
      )}
      {!chatOpen && (
        <span className={cn("contents", codeMode && "hidden")}>
          {!chatSidebarOpen && repositories && (
            <Tip label="Show sidebar" side="bottom">
              <button
                type="button"
                id="chrome-sidebar"
                aria-label="Show sidebar"
                aria-pressed={false}
                className={cn(iconButton, "ml-0.5")}
                onClick={() => document.body.classList.add("chat-sidebar-open")}
              >
                <PanelLeftIcon />
              </button>
            </Tip>
          )}
          <Tip label="Chat" shortcut="⌘L" side="bottom">
            <button
              type="button"
              id="shell-chat"
              aria-label="Open agent chat"
              aria-pressed={chatOpen}
              className={cn(iconButton, "ml-0.5", chatOpen && "bg-accent text-foreground")}
              onClick={() => {
                const workspace = window.agentWorkspace as
                  | { openChat?: () => void; closeChat?: () => void }
                  | undefined;
                if (document.body.classList.contains("agent-chat-open")) workspace?.closeChat?.();
                else workspace?.openChat?.();
              }}
            >
              <MessageSquare />
            </button>
          </Tip>
          <span aria-hidden="true" className="ml-1.5 h-4 w-px shrink-0 bg-divider" />
        </span>
      )}

      <nav
        aria-label="Open files"
        className={cn("flex min-w-0 items-center gap-1.5", codeMode && "hidden")}
      >
        <button
          type="button"
          id="files-home"
          aria-current={filesView ? "page" : undefined}
          className={cn(tab, "ml-2.5", filesView && tabActive)}
          onClick={() => run("files-home")}
        >
          <LayoutGrid />
          Files
        </button>

        {fileTabs.map((file) =>
          file.id === currentId
            ? tabMenu(file.id, documentTab)
            : tabMenu(
                file.id,
                <div
                  data-file-tab={file.id}
                  {...dragProps(file.id)}
                  data-switch-pending={file.id === pendingId ? "" : undefined}
                  className={cn(
                    tab,
                    "group/file-tab min-w-0 shrink gap-0 pr-1 data-dragging:opacity-50",
                    file.id === pendingId && tabActive,
                  )}
                  onClick={() => showFile(file.id)}
                >
                  <File className="mr-1.5" />
                  <span className="max-w-tab-name min-w-0 truncate">{file.name}</span>
                  {closeButton(file.id, file.name, "group-hover/file-tab:visible")}
                </div>,
              ),
        )}
        {currentHidden ? documentTab : null}

        <PreviewTabs tabClass={tab} activeClass={tabActive} />

        <Tip label="New tab" side="bottom">
          <button
            type="button"
            id="shell-new-file"
            aria-label="New tab"
            aria-haspopup="dialog"
            className={cn(iconButton, "[&_svg]:size-3.5")}
            onClick={openFileSwitcher}
          >
            <PlusIcon />
          </button>
        </Tip>
      </nav>

      <div className={cn("min-w-4 self-stretch", codeMode ? "shrink-0" : "flex-1")} />

      <Tip label="Search files" side="bottom">
        <button
          type="button"
          id="shell-search"
          aria-label="Search files"
          className={iconButton}
          onClick={() => run("shell-search")}
        >
          <Search />
        </button>
      </Tip>
      <div
        role="radiogroup"
        aria-label="Mode"
        className="ml-1 flex h-7 shrink-0 items-center rounded-full bg-muted p-0.5"
      >
        <Tip label="Design" side="bottom">
          <button
            type="button"
            role="radio"
            aria-checked={!codeMode}
            aria-label="Design"
            className={cn(
              "flex size-6 items-center justify-center rounded-full text-foreground-3 outline-none hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring [&_svg]:size-3.5",
              !codeMode && "bg-accent text-foreground",
            )}
            onClick={() =>
              (
                window.agentWorkspace as unknown as
                  | { setCodeMode?: (on: boolean) => void }
                  | undefined
              )?.setCodeMode?.(false)
            }
          >
            <Palette />
          </button>
        </Tip>
        <Tip label="Code" side="bottom">
          <button
            type="button"
            role="radio"
            aria-checked={codeMode}
            aria-label="Code"
            className={cn(
              "flex size-6 items-center justify-center rounded-full text-foreground-3 outline-none hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring [&_svg]:size-3.5",
              codeMode && "bg-accent text-foreground",
            )}
            onClick={() =>
              (
                window.agentWorkspace as unknown as
                  | { setCodeMode?: (on: boolean) => void }
                  | undefined
              )?.setCodeMode?.(true)
            }
          >
            <Braces />
          </button>
        </Tip>
      </div>
    </div>
  );
}

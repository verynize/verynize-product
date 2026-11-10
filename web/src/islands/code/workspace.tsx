// Code workspace layout (Wonder code mode): sidebar | chat column (toolbar, transcript + composer or file editor)
// | files + terminal panel. The window title bar stays on top (chrome island) and hosts the breadcrumb.
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import { createPortal } from "react-dom";
import { useBodyClass } from "@/lib/bridge";
import { cn } from "@/lib/utils";
import { ChangesButton } from "../chat/changes-panel";
import type { ChatState } from "../chat/store";
import { workspace } from "./api";
import { ChatTabs } from "./chat-tabs";
import { refresh, repositoryByKey, QUICK } from "./controller";
import { FileEditor } from "./editor";
import { rootChanged, useOpenFile } from "./editor-state";
import { FileTree } from "./file-tree";
import { CodeSidebar } from "./sidebar";
import { TerminalPanel } from "./terminal-panel";
import { Breadcrumb, Toolbar } from "./topbar";

const PANEL_KEY = "verynize-code-panel";
const SPLIT_KEY = "verynize-code-split";

/** localStorage may be unavailable (blocked site data); fall back to the defaults. */
function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function useTitlebarSlot(active: boolean) {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  useEffect(() => {
    if (!active) return;
    let frame = 0;
    const find = () => {
      const el = document.getElementById("bd-code-titlebar");
      if (el) setSlot(el);
      else frame = requestAnimationFrame(find);
    };
    find();
    return () => cancelAnimationFrame(frame);
  }, [active]);
  return active ? slot : null;
}

/** Files / terminal split: the tree height in px, stored; dragged or moved with the arrow keys. */
function useSplit(panelOpen: boolean) {
  const panel = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(() => Number(readStored(SPLIT_KEY)) || 0);
  useEffect(() => {
    const el = panel.current;
    if (!el) return;
    // Preserve the preferred split, but always reserve room for the terminal and divider after a resize.
    el.style.setProperty(
      "--code-tree-height",
      height ? `clamp(96px, ${height}px, calc(100% - 100px))` : "37%",
    );
  }, [height, panelOpen]);
  const clamp = (value: number) => {
    const total = panel.current?.getBoundingClientRect().height ?? 600;
    return Math.round(Math.max(96, Math.min(value, total - 100)));
  };
  const commit = (value: number) => {
    const next = clamp(value);
    setHeight(next);
    try {
      localStorage.setItem(SPLIT_KEY, String(next));
    } catch {
      /* ignore */
    }
  };
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    const el = panel.current;
    if (!el) return;
    event.preventDefault();
    const top = el.getBoundingClientRect().top;
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    const move = (e: globalThis.PointerEvent) => commit(e.clientY - top);
    const up = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const current =
      panel.current?.querySelector<HTMLElement>("#code-files")?.getBoundingClientRect().height ??
      300;
    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      commit(current + (event.key === "ArrowUp" ? -24 : 24));
    }
  };
  return { panel, height, onPointerDown, onKeyDown };
}

/** `routed`: rendered by Start's Code route (web), which means Code mode is on; else it follows `body.code-mode`. */
export function CodeWorkspace({ state, routed = false }: { state: ChatState; routed?: boolean }) {
  const bodyCodeMode = useBodyClass("code-mode");
  const codeMode = routed || bodyCodeMode;
  const sidebarCollapsed = useBodyClass("code-sidebar-collapsed");
  const [panelOpen, setPanelOpen] = useState(() => readStored(PANEL_KEY) !== "0");
  const slot = useTitlebarSlot(codeMode);
  const file = useOpenFile();
  const split = useSplit(panelOpen);
  const root = state.activeRoot ?? null;

  // The chat section (transcript + composer) lives in the center column while Code mode is on.
  const chatHost = useCallback((el: HTMLDivElement | null) => {
    workspace()?.attachCodeHost?.(el);
  }, []);

  useEffect(() => rootChanged(root), [root]);
  // A project opened outside the list (legacy openProject) appears once the registry knows it.
  useEffect(() => {
    if (state.projectKey !== QUICK && !repositoryByKey(state.projectKey))
      void refresh().catch(() => {});
  }, [state.projectKey]);

  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (
        !document.body.classList.contains("code-mode") ||
        !(event.metaKey || event.ctrlKey) ||
        event.altKey
      )
        return;
      const key = event.key.toLowerCase();
      if (key === "b") {
        event.preventDefault();
        document.body.classList.toggle("code-sidebar-collapsed");
      } else if (key === "l") {
        event.preventDefault();
        document.getElementById("project-prompt")?.focus();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(PANEL_KEY, panelOpen ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [panelOpen]);
  const togglePanel = () => setPanelOpen((open) => !open);

  return (
    <div
      id="code-workspace"
      aria-label="Code workspace"
      data-route-owner={routed ? "start" : undefined}
      className={cn("fixed inset-0 z-30 flex bg-settings text-foreground-2", !codeMode && "hidden")}
    >
      {slot && createPortal(<Breadcrumb state={state} />, slot)}
      {codeMode && !sidebarCollapsed && <CodeSidebar state={state} />}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {/* Row under the window title bar (breadcrumb, search and the Design/Code switch are drawn there). */}
        <div className="h-chrome shrink-0 border-b border-border" />
        <div className="flex min-h-0 flex-1">
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            {codeMode && (
              <Toolbar state={state} panelOpen={panelOpen} onTogglePanel={togglePanel} />
            )}
            {!file && <ChatTabs state={state} />}
            {file && <FileEditor file={file} />}
            <div
              ref={chatHost}
              id="code-chat-host"
              className={cn("flex min-h-0 flex-1 flex-col", file && "hidden")}
            />
          </div>
          {panelOpen && (
            <aside
              id="code-panel"
              aria-label="Files and terminal"
              className="m-0 flex min-h-0 w-code-panel shrink-0 flex-col overflow-hidden border-l border-border bg-background p-0"
            >
              <div className="flex h-10 shrink-0 items-center justify-end gap-2 border-b border-border px-2">
                {codeMode && <ChangesButton state={state} />}
              </div>
              <div ref={split.panel} className="flex min-h-0 flex-1 flex-col overflow-y-auto">
                <div className="flex h-(--code-tree-height) min-h-code-tree-min shrink-0 flex-col">
                  <FileTree root={root} />
                </div>
                <div
                  role="separator"
                  tabIndex={0}
                  aria-orientation="horizontal"
                  aria-label="Resize files and terminal"
                  aria-valuenow={split.height || undefined}
                  onPointerDown={split.onPointerDown}
                  onKeyDown={split.onKeyDown}
                  className="h-1 shrink-0 cursor-row-resize border-t border-border outline-none hover:border-primary focus-visible:border-primary"
                />
                <div id="code-terminal" className="flex min-h-code-tree-min flex-1 flex-col">
                  <TerminalPanel cwd={root} />
                </div>
              </div>
            </aside>
          )}
        </div>
      </div>
    </div>
  );
}

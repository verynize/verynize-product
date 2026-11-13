// Island entry: chrome. Owned by the "chrome" workstream (see web/src/islands/README.md).
// Window chrome (replaces header.app-chrome), main grid + panel collapse CSS, canvas overlays in #workspace
// (toolbar, page pill, help, zoom) and the main app menu.
import { useCallback, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { SwitchLoading } from "./chrome/SwitchLoading";
import { mountIsland, ensureContainer } from "@/lib/mount";
import { useBodyClass, useWindowEvent } from "@/lib/bridge";
import { TitleBar } from "./chrome/TitleBar";
import { AppMenu } from "./chrome/AppMenu";
import { CanvasOverlays } from "./chrome/CanvasOverlays";
import { CanvasContextMenu } from "./context-menu/CanvasContextMenu";
import { CommandPalette } from "./chrome/CommandPalette";
import { FileSwitcher } from "./chrome/FileSwitcher";
import { ShortcutsDrawer } from "./chrome/ShortcutsDrawer";
import { applyLayout, toggleBodyClass, type LayoutName } from "./chrome/hooks";
import { initLegacy } from "./chrome/legacy";
import { PreviewTabView } from "./chrome/preview-tab/PreviewTabView";
import { installPreviewTabs } from "./chrome/preview-tab/store";
import { initPanelWidths, PanelResizeHandles } from "./chrome/panel-resize";
import "./chrome/chrome.css";

function useLayoutShortcuts() {
  const onKey = useCallback((event: Event) => {
    const e = event as KeyboardEvent;
    if (!e.altKey || e.metaKey || e.ctrlKey || e.defaultPrevented) return;
    const target = e.target as HTMLElement | null;
    if (target?.closest("input, textarea, select, [contenteditable=true]")) return;
    const name = (
      { Digit1: "details", Digit2: "design", Digit0: "canvas" } as Record<string, LayoutName>
    )[e.code];
    if (!name) return;
    e.preventDefault();
    applyLayout(name);
  }, []);
  useWindowEvent("keydown", onKey);
}

/** Opening the chat dock hides the layers panel (Wonder 29) and closing it restores the panel; while the dock is
 * open the user can still show the layers beside it (page pill) or hide them again (file header). */
function useChatLayers() {
  const chatOpen = useBodyClass("agent-chat-open");
  const restore = useRef(false);
  useEffect(() => {
    const body = document.body.classList;
    if (chatOpen) {
      restore.current = !body.contains("left-collapsed");
      if (restore.current) toggleBodyClass("left-collapsed", true);
    } else if (restore.current) {
      restore.current = false;
      toggleBodyClass("left-collapsed", false);
    }
  }, [chatOpen]);
}

function Island({ overlayHost }: { overlayHost: HTMLElement | null }) {
  useLayoutShortcuts();
  useChatLayers();
  return (
    <>
      <TitleBar />
      <AppMenu />
      <CanvasContextMenu />
      <CommandPalette />
      <FileSwitcher />
      <ShortcutsDrawer />
      <PreviewTabView />
      <PanelResizeHandles />
      {overlayHost ? createPortal(<CanvasOverlays />, overlayHost) : null}
    </>
  );
}

function container() {
  initLegacy();
  installPreviewTabs();
  initPanelWidths();
  document.body.classList.add("bd-chrome");
  let root = document.getElementById("bd-chrome-root");
  if (!root) {
    root = document.createElement("div");
    root.id = "bd-chrome-root";
    // Sits where header.app-chrome was, so the body flow (bar, then main) is unchanged.
    const header = document.querySelector("header.app-chrome");
    const main = document.querySelector("body > main");
    if (header) header.before(root);
    else if (main) main.before(root);
    else document.body.prepend(root);
  }
  return root;
}

function overlayHost() {
  const workspace = document.getElementById("workspace");
  if (!workspace) return null;
  let host = document.getElementById("bd-chrome-canvas");
  if (!host) {
    host = document.createElement("div");
    host.id = "bd-chrome-canvas";
    host.setAttribute("data-bd", "");
    workspace.append(host);
  }
  return host;
}

mountIsland("chrome", container, () => <Island overlayHost={overlayHost()} />);

mountIsland(
  "switch-loading",
  // In <main>, so the file-switch cover can hide the sidebar and inspector too (tabs stay usable).
  () => ensureContainer("bd-switch-loading-root", document.querySelector("main")!),
  () => <SwitchLoading />,
);

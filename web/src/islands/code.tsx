// Island entry: code. The Code workspace (Wonder code mode): repositories with per-chat worktrees, the chat column,
// the file tree / editor and the terminal panel. Full window while `body.code-mode` is set (Design/Code switch in the
// title bar); the canvas stays mounted underneath. Chat state stays in web/desktop-panel.js (window.agentWorkspace).
import { useEffect } from "react";
import { mountIsland } from "@/lib/mount";
import { hosted } from "@/lib/router/host";
import { useChatState } from "./chat/store";
import { workspace } from "./code/api";
import {
  addRepository,
  newChat,
  newQuickChat,
  openChat,
  openRepository,
  refresh,
  repositoryByKey,
  start,
} from "./code/controller";
import { openFile, openMemory } from "./code/editor-state";
import { CodeWorkspace } from "./code/workspace";
import { DesignChatSidebar } from "./code/design-sidebar";
import "./code/code.css";

window.codeWorkspace = {
  addRepository,
  newChat: () => newChat(),
  newQuickChat,
  openChat,
  openMemory: () => void openMemory(),
  refresh,
  // Global search results (settings island) open here: switch to the project, then load the file.
  openFile: async (root: string, path: string) => {
    workspace()?.setCodeMode?.(true);
    const repo = repositoryByKey(root);
    window.appSettings?.close?.();
    if (repo && workspace()?.getState().projectKey !== repo.root) await openRepository(repo);
    // Files are read from the active root: wait until the main process confirmed the chat's folder.
    for (let i = 0; i < 100; i++) {
      const s = workspace()?.getState();
      if (s?.activeRoot && (!s.chatRoot || s.activeRoot === s.chatRoot)) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    await openFile(path);
  },
};

function Island() {
  const state = useChatState();
  useEffect(() => {
    void start();
  }, []);
  if (!state) return null;
  return (
    <>
      {/* On the web, Start's Code route renders the workspace (code/route-area.tsx). */}
      {!hosted && <CodeWorkspace state={state} />}
      <DesignChatSidebar state={state} />
    </>
  );
}

mountIsland(
  "code",
  () => {
    const root = document.createElement("div");
    root.id = "bd-code-root";
    document.body.append(root);
    return root;
  },
  () => <Island />,
);

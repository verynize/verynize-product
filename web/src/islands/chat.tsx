// Island entry: chat. Owned by the "chat" workstream (see web/src/islands/README.md).
// Renders inside `.project-agent` (desktop-panel.js moves that section between #agent-chat-dock and the Code workspace column)
// and portals the dock header into #agent-chat-dock. Chat state stays in desktop-panel.js (window.agentWorkspace).
import { useEffect } from "react";
import { createPortal } from "react-dom";
import { installAgentTransport, useAgentTransport } from "@/lib/agent-transport";
import { hideLegacy } from "@/lib/bridge";
import { mountIsland } from "@/lib/mount";
import { WebChatGate } from "./chat/web-gate";
import { PreviewSetup } from "./chat/preview-setup";
import { Composer } from "./chat/composer";
import { DockHeader } from "./chat/header";
import { QueueList } from "./chat/queue";
import { useChatState } from "./chat/store";
import { Transcript } from "./chat/transcript";
import "./chat/chat.css";

const agentSection = () =>
  document.querySelector<HTMLElement>("#desktop-panel .project-agent, .project-agent");

function headerContainer(): HTMLElement | null {
  const dock = document.getElementById("agent-chat-dock");
  if (!dock) return null;
  let el = document.getElementById("bd-chat-header");
  if (!el) {
    el = document.createElement("div");
    el.id = "bd-chat-header";
    el.setAttribute("data-bd", "");
    dock.prepend(el);
  }
  hideLegacy(dock.querySelector(".chat-dock-bar"));
  return el;
}

// The chat runs turns through the platform's AgentService (IPC on the desktop, the model API on the web).
installAgentTransport();

function Island() {
  const state = useChatState();
  const transport = useAgentTransport();
  const header = headerContainer();

  // ⌘L / Ctrl+L focuses the composer while the chat dock is open.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (
        (event.metaKey || event.ctrlKey) &&
        event.key.toLowerCase() === "l" &&
        document.body.classList.contains("agent-chat-open")
      ) {
        event.preventDefault();
        document.getElementById("project-prompt")?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!state) return null;
  // Web: until the model API can run a turn (signed in, enabled on this server, a cloud room open) the composer is
  // replaced by what is missing. A running turn keeps the composer so it can still be stopped.
  const gated = transport.runtime === "web" && transport.state !== "ready" && !state.busy;
  return (
    <>
      {header && createPortal(<DockHeader state={state} />, header)}
      <Transcript state={gated ? { ...state, suggestions: [] } : state} />
      <QueueList state={state} />
      <PreviewSetup state={state} />
      {gated ? <WebChatGate transport={transport} /> : <Composer state={state} />}
    </>
  );
}

mountIsland(
  "chat",
  () => {
    const section = agentSection();
    const root = document.createElement("div");
    root.id = "bd-chat-root";
    // `order-none flex-nowrap gap-0`: legacy `.project-agent>div:has(#project-run)` rules match this root.
    root.className = "order-none flex min-h-0 flex-1 flex-col flex-nowrap gap-0";
    if (!section) {
      root.hidden = true;
      document.body.append(root);
      return root;
    }
    // The legacy section stays in the DOM (ids and handlers), hidden; adopted controls are moved into the island.
    for (const child of section.children) hideLegacy(child);
    const config = section.querySelector(".agent-config");
    config?.classList.replace("agent-config", "legacy-agent-config");
    section.classList.add("bd-chat-section");
    section.append(root);
    return root;
  },
  () => <Island />,
);

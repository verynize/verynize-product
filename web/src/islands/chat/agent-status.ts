// Live agent facts behind the composer indicators: MCP server status per chat (streamed `mcp-status` agent events and
// desktop/agent-live-status.cjs), the context breakdown of an open run, and the account usage of Settings › Usage
// (desktop/agent-usage.cjs). Provider checks run only when a popover opens, never on mount.
import { useSyncExternalStore } from "react";
import { platform } from "@/lib/platform";

export type McpStatus =
  | "connected"
  | "starting"
  | "failed"
  | "needs-auth"
  | "disabled"
  | "not-started";
export type McpServer = { name: string; status: McpStatus; error?: string; builtIn?: boolean };
export type McpSnapshot = {
  agent: string;
  live: boolean;
  servers: McpServer[];
  error?: string;
  at: number;
};
export type ContextBreakdown = {
  totalTokens: number;
  maxTokens?: number;
  percentage?: number;
  model?: string;
  categories: { id?: string; name: string; tokens: number; kind: "used" | "free" | "buffer" }[];
};
export type AccountLimit = { id: string; label: string; usedPercent: number; resetsAt?: number };
export type AccountUsage = {
  agent: "claude" | "codex";
  status: "ready" | "signed-out" | "unavailable" | "missing" | "error";
  message?: string;
  email?: string | null;
  plan?: string | null;
  limits: AccountLimit[];
  updatedAt?: number;
};
export type LayerUsage = {
  thisWeek: number;
  lastWeek: number;
  total: number;
  weekStart: number;
  resetsAt: number;
};

export const desktopApi = () => platform.desktop;

/* ---------- MCP status per chat ---------- */
const mcp = new Map<string, McpSnapshot>();
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((fn) => fn());
let attached = false;

const STATUSES: McpStatus[] = [
  "connected",
  "starting",
  "failed",
  "needs-auth",
  "disabled",
  "not-started",
];
function cleanServers(value: unknown): McpServer[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((s): s is McpServer => !!s && typeof s.name === "string")
    .map((s) => ({
      name: s.name,
      status: STATUSES.includes(s.status) ? s.status : "not-started",
      ...(s.error ? { error: String(s.error) } : {}),
      ...(s.builtIn || s.name === "verynize" ? { builtIn: true } : {}),
    }));
}
const ordered = (servers: McpServer[]) => [
  ...servers.filter((s) => s.builtIn),
  ...servers.filter((s) => !s.builtIn),
];

function attach() {
  if (attached) return;
  // Run events come from the platform's AgentService; only the desktop runtime streams `mcp-status`.
  const service = platform.agents.service();
  if (!service) return;
  attached = true;
  service.subscribe((event) => {
    if (event?.type !== "mcp-status" || typeof event.chatId !== "string") return;
    const servers = cleanServers(event.servers);
    const previous = mcp.get(event.chatId);
    let next = servers;
    if (event.partial && previous) {
      // Codex reports one server at a time: keep the known rows, update the one that changed.
      const byName = new Map(previous.servers.map((s) => [s.name, s]));
      for (const s of servers) byName.set(s.name, s);
      next = [...byName.values()];
    }
    mcp.set(event.chatId, {
      agent: (typeof event.agent === "string" && event.agent) || previous?.agent || "",
      live: true,
      servers: ordered(next),
      at: Date.now(),
    });
    notify();
  });
}

const subscribe = (fn: () => void) => {
  attach();
  listeners.add(fn);
  return () => listeners.delete(fn);
};

/** Latest MCP status of a chat (streamed by its runs or queried); undefined before anything is known. */
export function useMcpStatus(chatId: string | null | undefined): McpSnapshot | undefined {
  return useSyncExternalStore(subscribe, () => (chatId ? mcp.get(chatId) : undefined));
}

/** Ask the desktop for the chat's MCP servers (the live run, else the configured list) and store the answer. */
export async function refreshMcpStatus(
  chatId: string | null | undefined,
  agent: string,
): Promise<void> {
  const ask = desktopApi()?.agentLiveStatus?.mcp;
  if (!ask) return;
  const result = await ask({ agent, chatId: chatId ?? null });
  const key = chatId || "";
  const previous = mcp.get(key);
  // A configured list never replaces what a run reported for the same agent.
  if (!result.live && previous?.live && previous.agent === result.agent) return;
  mcp.set(key, {
    agent: result.agent,
    live: !!result.live,
    servers: ordered(cleanServers(result.servers)),
    ...(result.error ? { error: result.error } : {}),
    at: Date.now(),
  });
  notify();
}

/* ---------- account usage (Settings › Usage data), cached for the ring between popover opens ---------- */
const accounts = new Map<string, AccountUsage>();
let layers: LayerUsage | null = null;
const usageListeners = new Set<() => void>();
const usageVersion = { value: 0 };
const bump = () => {
  usageVersion.value++;
  usageListeners.forEach((fn) => fn());
};
const subscribeUsage = (fn: () => void) => {
  usageListeners.add(fn);
  return () => usageListeners.delete(fn);
};

export function useAccountUsage(agent: string): {
  account?: AccountUsage;
  layers: LayerUsage | null;
} {
  useSyncExternalStore(subscribeUsage, () => usageVersion.value);
  return { account: accounts.get(agent), layers };
}

export async function refreshAccountUsage(
  agent: "claude" | "codex",
  refresh = false,
): Promise<void> {
  const api = desktopApi()?.agentUsage;
  if (!api) return;
  const [account, layerUsage] = await Promise.all([
    api.read({ agent, refresh }).catch(() => null),
    api.layers().catch(() => null),
  ]);
  if (account) accounts.set(agent, account);
  if (layerUsage) layers = layerUsage;
  bump();
}

export async function readContext(
  chatId: string | null | undefined,
): Promise<ContextBreakdown | null> {
  const ask = desktopApi()?.agentLiveStatus?.context;
  if (!ask || !chatId) return null;
  return ask({ chatId }).catch(() => null);
}

// Which chat agent transport this runtime has, and whether it can run a turn now. `installAgentTransport()` registers
// the AgentService (./agent-service.ts) on `platform.agents` (web/platform.js) once per page:
//
// - Desktop (the `agents` capability): Claude/Codex over IPC. The model API is not offered there: the backend
//   refuses browser requests from another origin (app://verynize), see docs/ai-runtime.md "Clients".
// - Web: the model API (`openrouter`) of the server the page came from. It can run a turn when the cloud account is
//   signed in on this server, `GET /api/ai/config` (shared query cache, keyed by server + account) says enabled with
//   an OpenRouter credential for the account (./ai-credentials.ts), and the editor has a cloud room of this server
//   open.
//
// `useAgentTransport()` is the React view of the same facts, for the chat island's gate and model picker.
import { queryOptions, useQuery } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";
import { useCloudAccount, type CloudAccountState } from "@/lib/cloud-account";
import { platform } from "@/lib/platform";
import { queryClient } from "@/lib/query/client";
import { queryKeys, SIGNED_OUT, sameScope, type AccountScope } from "@/lib/query/keys";
import {
  createDesktopAgentService,
  createWebAgentService,
  WEB_AGENT_MESSAGES,
  canRun,
  type AiConfig,
} from "./agent-service";
import { aiSelection, aiDefaultModel } from "./ai-preferences";
import { completeOpenRouterReturn, credentialsChanged } from "./ai-credentials";

type CloudRoom = { server: string; id: string };
declare global {
  interface Window {
    cloudWorkspace?: { room(): CloudRoom | null };
  }
}

const origin = () => globalThis.location?.origin ?? "";

/**
 * Who the model API config belongs to: the signed-in account, when it is signed in on the server this page came from
 * (the backend only answers same-origin browser requests). Any session kind counts (the backend reads the
 * X-Verynize-Session header for both).
 */
export function webAgentScope(account: CloudAccountState | null | undefined): AccountScope | null {
  if (!account || account.server !== origin()) return null;
  return { server: account.server, accountId: account.account.id || account.account.email };
}
const currentWebScope = () => webAgentScope(window.cloudAccount?.get() ?? null);

/** `GET /api/ai/config` for one account on one server. */
export const aiConfigQuery = (scope: AccountScope) =>
  queryOptions({
    queryKey: queryKeys.aiConfig(scope),
    queryFn: async (): Promise<AiConfig> => {
      const api = window.cloudAccount;
      if (!api || !sameScope(currentWebScope(), scope)) throw Error("The cloud account changed");
      const response = await api.fetch("/api/ai/config");
      const data = await response.json().catch(() => null);
      if (!sameScope(currentWebScope(), scope)) throw Error("The cloud account changed");
      if (!response.ok) throw Error(data?.error || `Server returned ${response.status}`);
      return data as AiConfig;
    },
    staleTime: 5 * 60_000,
  });

/** The open cloud room when it lives on this page's server (the one the model API runs against). */
export function currentRoom(): CloudRoom | null {
  const room = window.cloudWorkspace?.room() ?? null;
  return room && room.server === origin() ? { server: room.server, id: room.id } : null;
}

let installed = false;

/** Registers this runtime's AgentService on `platform.agents` (idempotent). */
export function installAgentTransport() {
  if (installed) return;
  installed = true;
  if (platform.kind === "desktop") {
    if (platform.can("agents") && platform.desktop)
      platform.agents.provide(createDesktopAgentService(platform.desktop));
    return;
  }
  const configFor = (scope: AccountScope | null) =>
    scope ? queryClient.getQueryData<AiConfig>(aiConfigQuery(scope).queryKey) : undefined;
  const service = createWebAgentService({
    request(path, init) {
      const api = window.cloudAccount;
      return api && currentWebScope() ? api.fetch(path, init) : null;
    },
    async config() {
      const scope = currentWebScope();
      return scope ? queryClient.fetchQuery(aiConfigQuery(scope)) : null;
    },
    selection: (chatId) => aiSelection(currentWebScope(), chatId),
    defaultModel: (provider) => aiDefaultModel(currentWebScope(), provider),
    room: () => currentRoom()?.id ?? null,
    ready: () => canRun(configFor(currentWebScope())),
    credentialsRequired: () => void credentialsChanged(),
  });
  platform.agents.provide(service);
  completeOpenRouterReturn();
  // Readiness follows the account (sign in/out, another server) and its config.
  const refresh = () => {
    const scope = currentWebScope();
    platform.agents.changed();
    if (scope)
      void queryClient
        .fetchQuery(aiConfigQuery(scope))
        .catch(() => {})
        .finally(() => platform.agents.changed());
  };
  window.addEventListener("cloud-account-changed", refresh);
  refresh();
}

/* ---------- React view ---------- */

export type AgentTransportState =
  | "ready"
  | "signed-out"
  | "loading"
  | "error"
  | "not-configured"
  | "needs-credentials"
  | "no-room"
  | "unavailable";
export type AgentTransport = {
  runtime: "desktop" | "web";
  state: AgentTransportState;
  /** What to tell the user when `state` is not "ready". */
  message: string;
  config?: AiConfig;
};

const subscribeRoom = (fn: () => void) => {
  window.addEventListener("cloud-room-changed", fn);
  return () => window.removeEventListener("cloud-room-changed", fn);
};
const roomKey = () => currentRoom()?.id ?? "";

/** The open cloud room of this server (re-renders when the editor joins or leaves one). */
export function useCloudRoom(): string | null {
  return useSyncExternalStore(subscribeRoom, roomKey) || null;
}

/** Whether the chat can run a turn here, and why not. */
export function useAgentTransport(): AgentTransport {
  const account = useCloudAccount();
  const room = useCloudRoom();
  const web = platform.kind === "web";
  const scope = web ? webAgentScope(account) : null;
  const query = useQuery({ ...aiConfigQuery(scope ?? SIGNED_OUT), enabled: !!scope });
  if (!web)
    return platform.can("agents")
      ? { runtime: "desktop", state: "ready", message: "" }
      : {
          runtime: "desktop",
          state: "unavailable",
          message: "This build has no local agent runtime.",
        };
  if (!scope) return { runtime: "web", state: "signed-out", message: WEB_AGENT_MESSAGES.signedOut };
  if (query.isPending)
    return { runtime: "web", state: "loading", message: "Checking the model API…" };
  if (query.error) return { runtime: "web", state: "error", message: query.error.message };
  const config = query.data;
  if (!config?.enabled)
    return {
      runtime: "web",
      state: "not-configured",
      message: WEB_AGENT_MESSAGES.notConfigured,
      config,
    };
  if (!canRun(config))
    return {
      runtime: "web",
      state: "needs-credentials",
      message: WEB_AGENT_MESSAGES.needsCredentials,
      config,
    };
  if (!room)
    return { runtime: "web", state: "no-room", message: WEB_AGENT_MESSAGES.noRoom, config };
  return { runtime: "web", state: "ready", message: "", config };
}

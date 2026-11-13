// The signed-in account's own OpenRouter credential for the web model API (docs/ai-runtime.md "Credentials"). The
// backend stores the key encrypted and never sends it back; this module only connects, reports and disconnects it:
//
// - `connectOpenRouter(returnTo)`: POST …/oauth/start (the response sets the HttpOnly browser-binding cookie), then
//   navigates this tab to OpenRouter's sign-in page. OpenRouter sends the browser back to the backend's callback,
//   which stores the key and redirects to `returnTo` (pathname + search) with `?openrouter=connected|error`. The
//   URL fragment (`#room=…`, possibly an invite secret) never goes to the server: it is kept in sessionStorage and
//   restored by `completeOpenRouterReturn()` when the page comes back.
// - `saveOpenRouterKey(apiKey)`: the pasted-key fallback (PUT, checked with OpenRouter by the backend).
// - `disconnectOpenRouter()`: DELETE.
//
// Every change refreshes the `ai-config` and `ai-credentials` queries and notifies `platform.agents`, so the chat
// gate and the composer follow at once. Web only: the desktop does not offer the model API.
import { queryOptions } from "@tanstack/react-query";
import { platform } from "@/lib/platform";
import { queryClient } from "@/lib/query/client";
import { queryKeys, sameScope, type AccountScope } from "@/lib/query/keys";

export type OpenRouterCredential = {
  connected: boolean;
  source?: "oauth" | "manual";
  last4?: string;
  label?: string | null;
  createdAt?: number;
  updatedAt?: number;
  /** Live check with OpenRouter: ok, rejected (revoked / invalid), unreadable (server secret changed), unknown. */
  state?: "ok" | "rejected" | "unreadable" | "unknown";
  limit?: number | null;
  usage?: number;
  limitRemaining?: number | null;
  freeTier?: boolean;
  /** No key of its own, but the server's opted-in shared key covers runs. */
  serverFallback?: boolean;
};
export type AiCredentials = Record<string, OpenRouterCredential>;
export class AiCredentialError extends Error {
  constructor(
    message: string,
    readonly field?: string,
  ) {
    super(message);
  }
}

const OAUTH_START = "/api/ai/credentials/openrouter/oauth/start";
const RETURN_HASH = "verynize.openrouter.return-hash";
const origin = () => globalThis.location?.origin ?? "";

/** The web model API scope of the signed-in account (same rule as agent-transport's webAgentScope). */
function scopeNow(): AccountScope | null {
  const account = window.cloudAccount?.get() ?? null;
  if (!account || account.server !== origin()) return null;
  return { server: account.server, accountId: account.account.id || account.account.email };
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const api = window.cloudAccount;
  if (!api || !scopeNow()) throw Error("Sign in to connect an AI provider");
  const response = await api.fetch(path, init);
  const data = await response.json().catch(() => null);
  if (!response.ok)
    throw new AiCredentialError(data?.error || `Server returned ${response.status}`, data?.field);
  return data as T;
}

/** `GET /api/ai/credentials` for one account (never the key itself). */
export const aiCredentialsQuery = (scope: AccountScope) =>
  queryOptions({
    queryKey: [...queryKeys.account(scope), "ai-credentials"] as const,
    queryFn: async (): Promise<AiCredentials> => {
      if (!sameScope(scopeNow(), scope)) throw Error("The cloud account changed");
      const data = await call<AiCredentials>("/api/ai/credentials");
      if (!sameScope(scopeNow(), scope)) throw Error("The cloud account changed");
      return data;
    },
    staleTime: 60_000,
  });

/** Refetch what depends on the credential and tell the chat transport. */
export async function credentialsChanged() {
  const scope = scopeNow();
  if (scope)
    await Promise.all([
      // Inactive too: the transport's ready() reads the cached config even when no chat is open.
      queryClient.invalidateQueries({ queryKey: queryKeys.aiConfig(scope), refetchType: "all" }),
      queryClient.invalidateQueries({ queryKey: aiCredentialsQuery(scope).queryKey }),
    ]).catch(() => {});
  platform.agents.changed();
}

/** Start OpenRouter's OAuth PKCE sign-in in this tab; the page comes back to `returnTo` afterwards. */
export async function connectOpenRouter(returnTo?: string) {
  const here = globalThis.location;
  const back = returnTo ?? `${here.pathname}${here.search}`;
  const { authorizeUrl } = await call<{ authorizeUrl: string }>(OAUTH_START, {
    method: "POST",
    body: JSON.stringify({ returnTo: back }),
  });
  try {
    if (here.hash) sessionStorage.setItem(RETURN_HASH, here.hash);
    else sessionStorage.removeItem(RETURN_HASH);
  } catch {}
  here.assign(authorizeUrl);
}

/** The pasted-key fallback: the backend checks the key with OpenRouter before it stores it. */
export async function saveOpenRouterKey(apiKey: string) {
  return saveAiCredential("openrouter", { apiKey });
}

export async function saveAiCredential(provider: string, fields: Record<string, string>) {
  const result = await call<AiCredentials>(`/api/ai/credentials/${encodeURIComponent(provider)}`, {
    method: "PUT",
    body: JSON.stringify(fields),
  });
  await credentialsChanged();
  return result;
}

export async function disconnectOpenRouter() {
  return disconnectAiProvider("openrouter");
}

export async function disconnectAiProvider(provider: string) {
  await call<{ ok: boolean }>(`/api/ai/credentials/${encodeURIComponent(provider)}`, {
    method: "DELETE",
  });
  await credentialsChanged();
}

export type OpenRouterReturn = { status: "connected" | "error"; reason?: string } | null;
let returned: OpenRouterReturn = null;

/** How the last OAuth round-trip ended on this page load (null when the page was not opened by one). */
export const openRouterReturn = () => returned;

const REASONS: Record<string, string> = {
  invalid_state: "The OpenRouter sign-in link was already used or is not valid. Try again.",
  expired: "The OpenRouter sign-in took too long. Try again.",
  wrong_browser: "Finish the OpenRouter sign-in in the browser that started it.",
  exchange_failed: "OpenRouter did not issue a key. Try again.",
  denied: "The OpenRouter sign-in was cancelled.",
};
/** A sentence for a failed OAuth round-trip. */
export const openRouterReturnMessage = (reason?: string) =>
  (reason && REASONS[reason]) || "Connecting OpenRouter failed. Try again.";

/**
 * Called once per page load (installAgentTransport): when the backend's OAuth callback sent the browser here, drop
 * the `openrouter` query parameters, remember the outcome and put back the fragment the page had when the sign-in
 * started (loading the page once more, so the legacy scripts that read `#room=` at load see it).
 */
export function completeOpenRouterReturn() {
  const location = globalThis.location;
  if (!location) return;
  const url = new URL(location.href);
  const status = url.searchParams.get("openrouter");
  if (status !== "connected" && status !== "error") return;
  const reason = url.searchParams.get("openrouter_error") || undefined;
  returned = { status, ...(reason ? { reason } : {}) };
  url.searchParams.delete("openrouter");
  url.searchParams.delete("openrouter_error");
  let hash = "";
  try {
    hash = sessionStorage.getItem(RETURN_HASH) || "";
    sessionStorage.removeItem(RETURN_HASH);
  } catch {}
  const restore = hash && !url.hash;
  if (restore) url.hash = hash;
  const next = `${url.pathname}${url.search}${url.hash}`;
  // The search changes, so replace() loads the page again: legacy scripts read `#room=` at load.
  if (restore) location.replace(next);
  else history.replaceState(history.state, "", next);
}

// Query keys for server state. Every cloud key starts with the account scope
// (["cloud", server, accountId]), so data cached for one server or identity is never read by
// another, and signing out or switching drops one scope with a single prefix removal.
import type { CloudAccountState } from "@/lib/cloud-account";

/** Who the cached data belongs to: the account's server origin and its account id. */
export type AccountScope = { server: string; accountId: string };

/** The scope of an email (Better Auth) account; null when signed out or on a passkey session. */
export function accountScope(account: CloudAccountState | null | undefined): AccountScope | null {
  if (!account?.emailAccount) return null;
  return { server: account.server, accountId: account.account.id || account.account.email };
}

/** Placeholder scope for queries that are disabled while signed out (they never fetch). */
export const SIGNED_OUT: AccountScope = { server: "", accountId: "" };

export const sameScope = (a: AccountScope | null, b: AccountScope | null) =>
  a === b || (!!a && !!b && a.server === b.server && a.accountId === b.accountId);

/** The scope of the account signed in right now (window.cloudAccount). */
export const currentScope = () => accountScope(window.cloudAccount?.get() ?? null);

export const queryKeys = {
  /** Everything cached for cloud accounts. */
  cloud: () => ["cloud"] as const,
  /** Everything cached for one account on one server. */
  account: (scope: AccountScope) => ["cloud", scope.server, scope.accountId] as const,
  /** The account's organizations; prefix of every per-organization key below. */
  organizations: (scope: AccountScope) => [...queryKeys.account(scope), "organizations"] as const,
  /** One organization with its members and invitations. */
  organization: (scope: AccountScope, organizationId: string) =>
    [...queryKeys.organizations(scope), organizationId] as const,
  /** Invitations addressed to the account, from any organization. */
  invitations: (scope: AccountScope) => [...queryKeys.account(scope), "invitations"] as const,
  /** All rooms accessible to the account, including organization memberships. */
  rooms: (scope: AccountScope) => [...queryKeys.account(scope), "rooms"] as const,
  /** The model API runtime configuration of the account's server (GET /api/ai/config). */
  aiConfig: (scope: AccountScope) => [...queryKeys.account(scope), "ai-config"] as const,
};

/**
 * An authenticated request for `scope`. Fails instead of returning data when the signed-in account
 * is (or becomes, while the request runs) a different one, so a late response for one identity is
 * never cached under — or shown to — another.
 */
export async function scopedRequest<T>(
  scope: AccountScope,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const api = window.cloudAccount;
  if (!api || !sameScope(currentScope(), scope)) throw Error("The cloud account changed");
  const result = await api.request<T>(path, init);
  if (!sameScope(currentScope(), scope)) throw Error("The cloud account changed");
  return result;
}

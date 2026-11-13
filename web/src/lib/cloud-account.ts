// Typed view of the cloud account kept by web/cloud-panel.js (window.cloudAccount): the one
// email + password session shared by onboarding, the workspace switcher and Settings › Members.
// Organizations are Better Auth's (cloud/auth.js); room access follows them (cloud/orgs.js).
import { useSyncExternalStore } from "react";
import { queryOptions, useQuery } from "@tanstack/react-query";
import { platform } from "@/lib/platform";
import { queryClient } from "@/lib/query/client";
import { textOf } from "@/lib/utils";
import {
  accountScope,
  queryKeys,
  scopedRequest,
  SIGNED_OUT,
  type AccountScope,
} from "@/lib/query/keys";

export type CloudProfile = {
  id: string;
  email: string;
  handle: string;
  displayName: string;
  avatarUrl: string;
};
export type CloudAccountState = {
  server: string;
  account: CloudProfile;
  /** True for email + password (Better Auth) sessions; false for legacy passkey sessions. */
  emailAccount: boolean;
  personalOrganizationId: string | null;
};
type CloudAccountApi = {
  defaultServer(): string;
  get(): CloudAccountState | null;
  signIn(o: { server: string; email: string; password: string }): Promise<CloudProfile>;
  signUp(o: { server: string; email: string; password: string; name?: string }): Promise<void>;
  forgotPassword(o: { server: string; email: string }): Promise<void>;
  signOut(everywhere?: boolean): Promise<void>;
  request<T = unknown>(path: string, options?: RequestInit): Promise<T>;
  /** Authenticated request to the account's server returning the raw Response (streamed bodies, status codes). */
  fetch(path: string, options?: RequestInit): Promise<Response>;
  activeOrganization(): string | null;
  setActiveOrganization(id: string): void;
};

declare global {
  interface Window {
    cloudAccount?: CloudAccountApi;
  }
}

export const cloudAccount = () => window.cloudAccount ?? null;

const subscribe = (fn: () => void) => {
  const events = ["cloud-account-changed", "cloud-organization-changed"];
  for (const name of events) window.addEventListener(name, fn);
  return () => {
    for (const name of events) window.removeEventListener(name, fn);
  };
};
let cached: { key: string; value: CloudAccountState | null } = { key: "", value: null };
const snapshot = () => {
  const value = cloudAccount()?.get() ?? null;
  const key = value ? `${value.server}|${value.account.email}|${value.account.displayName}` : "";
  if (key !== cached.key) cached = { key, value };
  return cached.value;
};
/** The signed-in cloud account, re-rendering on sign in, sign out and profile changes. */
export function useCloudAccount(): CloudAccountState | null {
  return useSyncExternalStore(subscribe, snapshot);
}
/** The active workspace (organization id) of the file browser. */
export function useActiveOrganization(): string | null {
  return useSyncExternalStore(subscribe, () => cloudAccount()?.activeOrganization() ?? null);
}

export type Organization = {
  id: string;
  name: string;
  slug: string;
  metadata?: unknown;
  createdAt?: string;
};
export type OrganizationMember = {
  id: string;
  userId: string;
  role: string;
  createdAt: string;
  user: { id: string; name: string; email: string; image?: string | null };
};
export type OrganizationInvitation = {
  id: string;
  email: string;
  role: string | null;
  status: string;
  expiresAt: string;
  createdAt?: string;
  organizationId: string;
  organizationName?: string;
};
export type FullOrganization = Organization & {
  members: OrganizationMember[];
  invitations: OrganizationInvitation[];
};

const metadataOf = (org: Pick<Organization, "metadata">): Record<string, unknown> => {
  if (org.metadata && typeof org.metadata === "object")
    return org.metadata as Record<string, unknown>;
  try {
    return JSON.parse(textOf(org.metadata || "null")) || {};
  } catch {
    return {};
  }
};
export const isPersonal = (org: Pick<Organization, "metadata">) =>
  metadataOf(org).personal === true;
export const MEMBER_ROOM_ROLES = ["viewer", "commenter", "editor"] as const;
export type MemberRoomRole = (typeof MEMBER_ROOM_ROLES)[number];
export const memberRoomRole = (org: Pick<Organization, "metadata">): MemberRoomRole => {
  const role = metadataOf(org).roomRole;
  return MEMBER_ROOM_ROLES.includes(role as MemberRoomRole) ? (role as MemberRoomRole) : "editor";
};
export const roleNames = (role: string | null | undefined) =>
  String(role || "member")
    .split(",")
    .map((value) => value.trim());
export const canManage = (role: string | null | undefined) =>
  roleNames(role).some((value) => value === "owner" || value === "admin");

/** Better Auth endpoint under /api/auth on the account's server. */
export function authRequest<T = unknown>(path: string, body?: unknown): Promise<T> {
  const api = cloudAccount();
  if (!api) return Promise.reject(Error("Cloud accounts are not available"));
  return api.request<T>(
    "/api/auth" + path,
    body === undefined ? {} : { method: "POST", body: JSON.stringify(body) },
  );
}

// One shared organization list for every island (the shared query cache), so a workspace that was
// just created or joined is listed before it becomes the active one.
const byPersonalThenName = (a: Organization, b: Organization) =>
  Number(isPersonal(b)) - Number(isPersonal(a)) || a.name.localeCompare(b.name);
/** The organizations of an email account, personal first. */
export const organizationsQuery = (scope: AccountScope) =>
  queryOptions({
    queryKey: queryKeys.organizations(scope),
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    queryFn: async () =>
      (await scopedRequest<Organization[]>(scope, "/api/auth/organization/list")).sort(
        byPersonalThenName,
      ),
  });
/** One organization with its members and invitations. */
export const fullOrganizationQuery = (scope: AccountScope, organizationId: string) =>
  queryOptions({
    queryKey: queryKeys.organization(scope, organizationId),
    queryFn: () =>
      scopedRequest<FullOrganization>(
        scope,
        `/api/auth/organization/get-full-organization?organizationId=${encodeURIComponent(organizationId)}`,
      ),
  });
/** Pending invitations addressed to the account. */
export const userInvitationsQuery = (scope: AccountScope) =>
  queryOptions({
    queryKey: queryKeys.invitations(scope),
    queryFn: async () =>
      (
        await scopedRequest<OrganizationInvitation[]>(
          scope,
          "/api/auth/organization/list-user-invitations",
        )
      ).filter((invitation) => invitation.status === "pending"),
  });

/** Refetch the organization list of the signed-in account. */
export function reloadOrganizations(): Promise<void> {
  const scope = accountScope(cloudAccount()?.get());
  if (!scope) return Promise.resolve();
  // refetchType "all": also refresh the list when no island shows it right now, so a reader that
  // mounts next (e.g. after switching to a just-created workspace) finds it current.
  return Promise.all([
    queryClient.invalidateQueries({
      queryKey: queryKeys.organizations(scope),
      exact: true,
      refetchType: "all",
    }),
    // Joining/leaving a workspace or changing its member roles also changes room access.
    queryClient.invalidateQueries({ queryKey: queryKeys.rooms(scope) }),
  ]).then(() => {});
}
const NO_ORGANIZATIONS: Organization[] = [];
/** The organizations of the signed-in email account, personal first; refreshes on changes. */
export function useOrganizations() {
  const account = useCloudAccount();
  const scope = accountScope(account);
  const query = useQuery({ ...organizationsQuery(scope ?? SIGNED_OUT), enabled: !!scope });
  const organizations = (scope && query.data) || NO_ORGANIZATIONS;
  const error = scope && query.error ? query.error.message : "";
  return { account, organizations, error, reload: reloadOrganizations };
}
/** Reload the shared list (after create, leave, accept…); resolves once it is current. */
export const organizationsChanged = () => reloadOrganizations();

/** Sign-in entry: the desktop onboarding, or the "Shared design" dialog's account section on the web. */
export function openSignIn() {
  if (platform.kind === "desktop") window.dispatchEvent(new Event("bd:open-onboarding"));
  else {
    (
      window as unknown as { cloudWorkspace?: { openDialog?(): void } }
    ).cloudWorkspace?.openDialog?.();
    const section = document.getElementById("cloud-account-section") as HTMLDetailsElement | null;
    if (section) section.open = true;
  }
}

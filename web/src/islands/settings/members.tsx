// Settings › Members (design/wonder/77, share-audit SI4/SI5): the active workspace's members with
// their Viewer / Editor / Admin roles, pending invitations (Resend / Cancel invitation), the
// default room access of plain members, invitations addressed to you, and leaving or deleting a
// team. Data comes from the Better Auth organization plugin (cloud/auth.js) through
// window.cloudAccount; room access follows these roles on the server (cloud/orgs.js): owner and
// admin manage every file, editor edits, viewer views, and a plain member gets the default.
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowUpIcon,
  EllipsisIcon,
  MailIcon,
  PlusIcon,
  SearchIcon,
  Trash2Icon,
  UsersIcon,
} from "lucide-react";
import { toast } from "sonner";
import {
  authRequest,
  canManage,
  cloudAccount,
  fullOrganizationQuery,
  isPersonal,
  memberRoomRole,
  openSignIn,
  organizationsChanged,
  organizationsQuery,
  roleNames,
  useActiveOrganization,
  useOrganizations,
  userInvitationsQuery,
  type MemberRoomRole,
  type OrganizationInvitation,
} from "@/lib/cloud-account";
import { accountScope, queryKeys, SIGNED_OUT, type AccountScope } from "@/lib/query/keys";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Card,
  NativeSelect,
  PageHeader,
  Row,
  Section,
  SettingsButton,
  TextField,
} from "./controls";

const ROLE_LABEL: Record<string, string> = {
  owner: "Owner",
  admin: "Admin",
  editor: "Editor",
  viewer: "Viewer",
  member: "Member",
};
/** Roles offered when inviting or changing a member (owners also see Owner). */
const MEMBER_ROLES = ["viewer", "editor", "admin"] as const;
const ROOM_ROLE_LABEL: Record<MemberRoomRole, string> = {
  viewer: "Can view",
  commenter: "Can comment",
  editor: "Can edit",
};
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));
const roleLabel = (role: string) =>
  roleNames(role)
    .map((r) => ROLE_LABEL[r] ?? r)
    .join(", ");

function ago(value: string) {
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return "";
  const minutes = Math.round((Date.now() - time) / 60000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)}h ago`;
  return `${Math.round(minutes / 60 / 24)}d ago`;
}

function Initial({ name }: { name: string }) {
  return (
    <span
      aria-hidden
      className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary-tint text-2xs font-medium text-primary-text"
    >
      {name.trim().charAt(0).toUpperCase() || "?"}
    </span>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex flex-1 flex-col gap-2 px-4 py-4">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-lg text-foreground">{value}</span>
    </div>
  );
}

/** Invitations sent to the signed-in email, from any organization. */
function IncomingInvitations({
  scope,
  onAccepted,
}: {
  scope: AccountScope;
  onAccepted: (id: string) => void;
}) {
  const client = useQueryClient();
  // A failed load lists nothing, as before.
  const { data: invitations = [] } = useQuery(userInvitationsQuery(scope));
  const answer = useMutation({
    mutationFn: ({ invitation, accept }: { invitation: OrganizationInvitation; accept: boolean }) =>
      authRequest(`/organization/${accept ? "accept" : "reject"}-invitation`, {
        invitationId: invitation.id,
      }),
    onSuccess: async (_result, { invitation, accept }) => {
      // The joined workspace must be listed before it becomes the active one.
      await organizationsChanged();
      if (accept) onAccepted(invitation.organizationId);
      toast(accept ? `Joined ${invitation.organizationName}` : "Invitation declined");
    },
    onError: (error) => toast(errorText(error)),
    onSettled: () => client.invalidateQueries({ queryKey: queryKeys.invitations(scope) }),
  });
  if (!invitations.length) return null;
  return (
    <Section id="members-incoming" title="Invitations for you">
      <Card>
        {invitations.map((invitation) => (
          <Row
            key={invitation.id}
            title={invitation.organizationName || "A workspace"}
            description={`Join as ${roleLabel(invitation.role || "member")}`}
            icon={<MailIcon className="mt-0.5 size-4 text-muted-foreground" />}
          >
            <SettingsButton
              variant="ghost"
              onClick={() => answer.mutate({ invitation, accept: false })}
            >
              Decline
            </SettingsButton>
            <SettingsButton
              variant="primary"
              data-accept-invitation={invitation.id}
              onClick={() => answer.mutate({ invitation, accept: true })}
            >
              Accept
            </SettingsButton>
          </Row>
        ))}
      </Card>
    </Section>
  );
}

/** Wonder's confirmation before a destructive member action. */
type Confirmation = {
  id: string;
  title: string;
  description: string;
  cancel: string;
  confirm: string;
  /** A destructive action: Wonder's red confirm button (as in the Share visibility dialog). */
  danger?: boolean;
  run: () => void;
};

function ConfirmDialog({
  confirmation,
  onClose,
}: {
  confirmation: Confirmation | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={!!confirmation} onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="max-w-md" showCloseButton={false} data-members-confirm>
        <DialogHeader>
          <DialogTitle>{confirmation?.title}</DialogTitle>
          <DialogDescription>{confirmation?.description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <SettingsButton onClick={onClose}>{confirmation?.cancel}</SettingsButton>
          <SettingsButton
            id={confirmation?.id}
            variant="primary"
            className={cn(confirmation?.danger && "bg-share-danger hover:bg-share-danger-hover")}
            onClick={() => {
              confirmation?.run();
              onClose();
            }}
          >
            {confirmation?.confirm}
          </SettingsButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** The ellipsis menu at the end of a member or invitation row. */
function RowMenu({ label, children }: { label: string; children: ReactNode }) {
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <SettingsButton variant="ghost" aria-label={label} data-row-menu={label}>
          <EllipsisIcon />
        </SettingsButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" onEscapeKeyDown={(event) => event.stopPropagation()}>
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

type MembersAction = {
  run: () => Promise<unknown>;
  /** Toast shown on success. */
  done?: string;
  /** Refresh what the action changed. */
  refresh: () => Promise<unknown>;
};

export function MembersPage() {
  const { account, organizations } = useOrganizations();
  const scope = accountScope(account);
  const activeId = useActiveOrganization();
  const active = organizations.find((org) => org.id === activeId) ?? organizations[0] ?? null;
  // Keyed by workspace: never shows the previous workspace's members while the active one loads.
  const organizationQuery = useQuery({
    ...fullOrganizationQuery(scope ?? SIGNED_OUT, active?.id ?? ""),
    enabled: !!scope && !!active,
  });
  const full = scope && active ? (organizationQuery.data ?? null) : null;
  const [query, setQuery] = useState("");
  const [inviting, setInviting] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("viewer");
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const client = useQueryClient();
  const loadError = organizationQuery.error;
  useEffect(() => {
    if (loadError) toast(errorText(loadError));
  }, [loadError]);

  const me = full?.members.find((m) => m.user.email === account?.account.email) ?? null;
  const manager = canManage(me?.role);
  const owner = roleNames(me?.role).includes("owner");
  const personal = active ? isPersonal(active) : false;
  const members = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (full?.members ?? []).filter(
      (m) => !q || m.user.name.toLowerCase().includes(q) || m.user.email.toLowerCase().includes(q),
    );
  }, [full, query]);
  const pending = (full?.invitations ?? []).filter((i) => i.status === "pending");
  const pendingShown = pending.filter(
    (i) => !query.trim() || i.email.toLowerCase().includes(query.trim().toLowerCase()),
  );

  const action = useMutation({
    mutationFn: ({ run }: MembersAction) => run(),
    onSuccess: (_result, { done }) => {
      if (done) toast(done);
    },
    onError: (error) => toast(errorText(error)),
    // Success or not, show the server's current state.
    onSettled: (_result, _error, { refresh }) => refresh(),
  });
  const refreshMembers = () =>
    scope && active
      ? client.invalidateQueries({ queryKey: queryKeys.organization(scope, active.id) })
      : Promise.resolve();
  /** Run an action on the active workspace; by default its members are refreshed afterwards. */
  const act = (
    run: () => Promise<unknown>,
    done?: string,
    refresh: () => Promise<unknown> = refreshMembers,
  ) => action.mutate({ run, done, refresh });
  /** After leaving or deleting `id`: refresh the list; once it is gone, forget its members. */
  const forget = (id: string) => async () => {
    await organizationsChanged();
    if (!scope) return;
    const listed = client.getQueryData(organizationsQuery(scope).queryKey);
    if (listed && !listed.some((org) => org.id === id))
      client.removeQueries({ queryKey: queryKeys.organization(scope, id) });
  };
  const invite = (event: FormEvent) => {
    event.preventDefault();
    if (!active || !email.trim()) return;
    act(async () => {
      await authRequest("/organization/invite-member", {
        email: email.trim(),
        role,
        organizationId: active.id,
      });
      setEmail("");
      setInviting(false);
    }, `Invitation sent to ${email.trim()}`);
  };

  if (!account?.emailAccount)
    return (
      <>
        <PageHeader
          title="Members"
          description="Invite people into a workspace to design together."
        />
        <Card>
          <Row
            title="Sign in to manage members"
            description={
              account
                ? "Your passkey session cannot manage workspaces. Sign in with your email and password."
                : "Workspaces, members and shared rooms need a Verynize account."
            }
            icon={<UsersIcon className="mt-0.5 size-4 text-muted-foreground" />}
          >
            <SettingsButton id="members-sign-in" variant="primary" onClick={openSignIn}>
              Sign in
            </SettingsButton>
          </Row>
        </Card>
      </>
    );

  return (
    <div className="flex flex-col gap-10" id="members-page" data-organization={active?.id ?? ""}>
      <PageHeader
        title="Members"
        description={
          active
            ? personal
              ? "Your personal workspace. Rooms you share land here unless you pick a team."
              : `People in ${active.name} reach every room shared in it.`
            : "Loading workspaces…"
        }
      />
      {scope ? (
        <IncomingInvitations
          scope={scope}
          onAccepted={(id) => cloudAccount()?.setActiveOrganization(id)}
        />
      ) : null}
      <Section id="members-overview" title="Members overview">
        <div className="flex divide-x divide-card-border rounded-2xl border border-card-border bg-card">
          <Stat label="Total members" value={full?.members.length ?? "–"} />
          <Stat label="Pending invitations" value={pending.length} />
          <Stat label="Workspace" value={personal ? "Personal" : "Team"} />
        </div>
      </Section>

      <Section
        id="members-manage"
        title="Manage members"
        description="Manage workspace members, roles, and invitations."
      >
        <div className="mb-3 flex items-center justify-between gap-4 px-4">
          <label className="m-0 flex h-7 w-72 items-center gap-2 rounded-md border border-input px-2 text-subtle-foreground focus-within:border-primary">
            <SearchIcon className="size-3.5 shrink-0" aria-hidden />
            <input
              id="members-search"
              type="search"
              aria-label="Search members and invitations"
              placeholder="Search members..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="m-0 h-full min-w-0 flex-1 border-0 bg-transparent p-0 text-sm text-foreground outline-none placeholder:text-subtle-foreground"
            />
          </label>
          {manager ? (
            <SettingsButton
              id="members-invite"
              variant="primary"
              onClick={() => setInviting((v) => !v)}
            >
              <PlusIcon />
              Invite member
            </SettingsButton>
          ) : null}
        </div>
        {inviting ? (
          <form
            id="members-invite-form"
            onSubmit={invite}
            className="mb-3 flex items-center gap-2 px-4"
          >
            <TextField
              id="members-invite-email"
              type="email"
              required
              placeholder="teammate@studio.com"
              aria-label="Email to invite"
              className="min-w-0 flex-1"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <NativeSelect
              id="members-invite-role"
              aria-label="Role"
              value={role}
              onChange={(e) => setRole(e.target.value)}
            >
              {MEMBER_ROLES.map((value) => (
                <option key={value} value={value}>
                  {ROLE_LABEL[value]}
                </option>
              ))}
            </NativeSelect>
            <SettingsButton id="members-invite-send" type="submit" variant="primary">
              Send invite
            </SettingsButton>
          </form>
        ) : null}
        <div className="overflow-hidden rounded-2xl border border-card-border bg-card" role="table">
          <div
            role="row"
            className="grid grid-cols-12 gap-3 border-b border-divider px-4 py-2.5 text-sm text-muted-foreground"
          >
            <span role="columnheader" className="col-span-4">
              Member
            </span>
            <span role="columnheader" className="col-span-4">
              Email
            </span>
            <span role="columnheader" className="col-span-2">
              Role
            </span>
            <span role="columnheader" className="col-span-2">
              Added
            </span>
          </div>
          {members.map((member) => {
            const self = member.id === me?.id;
            const memberOwner = roleNames(member.role).includes("owner");
            const editable = manager && !self && (owner || !memberOwner);
            return (
              <div
                key={member.id}
                role="row"
                data-org-member={member.user.email}
                className="group grid grid-cols-12 items-center gap-3 border-t border-divider px-4 py-2.5 first:border-t-0"
              >
                <span
                  role="cell"
                  className="col-span-4 flex min-w-0 items-center gap-2.5 text-foreground"
                >
                  <Initial name={member.user.name || member.user.email} />
                  <span className="truncate">{member.user.name || member.user.email}</span>
                  {self ? <span className="text-muted-foreground">You</span> : null}
                </span>
                <span role="cell" className="col-span-4 truncate text-muted-foreground">
                  {member.user.email}
                </span>
                <span role="cell" className="col-span-2">
                  {editable ? (
                    <NativeSelect
                      aria-label={`Role of ${member.user.email}`}
                      data-org-member-role={member.user.email}
                      value={roleNames(member.role)[0]}
                      onChange={(e) => {
                        // Read now: the mutation runs after React has reset this controlled select.
                        const next = e.target.value;
                        act(
                          () =>
                            authRequest("/organization/update-member-role", {
                              organizationId: active!.id,
                              memberId: member.id,
                              role: next,
                            }),
                          "Role updated",
                        );
                      }}
                    >
                      {owner ? <option value="owner">Owner</option> : null}
                      {[...MEMBER_ROLES].reverse().map((value) => (
                        <option key={value} value={value}>
                          {ROLE_LABEL[value]}
                        </option>
                      ))}
                      {roleNames(member.role)[0] === "member" ? (
                        // Plain members follow the workspace default (Room access below).
                        <option value="member">
                          Member ({ROOM_ROLE_LABEL[memberRoomRole(active!)].toLowerCase()})
                        </option>
                      ) : null}
                    </NativeSelect>
                  ) : (
                    <span className="text-foreground">{roleLabel(member.role)}</span>
                  )}
                </span>
                <span
                  role="cell"
                  className="col-span-2 flex items-center justify-between gap-2 text-muted-foreground"
                >
                  <span className="truncate whitespace-nowrap">{ago(member.createdAt)}</span>
                  {editable ? (
                    <RowMenu label={`Actions for ${member.user.email}`}>
                      <DropdownMenuItem
                        variant="destructive"
                        data-org-remove-member={member.user.email}
                        onSelect={() =>
                          setConfirmation({
                            id: "members-remove-confirm",
                            title: "Remove member",
                            danger: true,
                            description: `Remove ${member.user.name || member.user.email} from this organization? They’ll lose access to its files immediately.`,
                            cancel: "Cancel",
                            confirm: "Remove",
                            run: () =>
                              act(
                                () =>
                                  authRequest("/organization/remove-member", {
                                    organizationId: active!.id,
                                    memberIdOrEmail: member.id,
                                  }),
                                "Member removed",
                              ),
                          })
                        }
                      >
                        <Trash2Icon />
                        Remove from workspace
                      </DropdownMenuItem>
                    </RowMenu>
                  ) : null}
                </span>
              </div>
            );
          })}
          {manager
            ? pendingShown.map((invitation) => (
                <div
                  key={invitation.id}
                  role="row"
                  data-pending-invitation={invitation.email}
                  className="grid grid-cols-12 items-center gap-3 border-t border-divider px-4 py-2.5"
                >
                  <span
                    role="cell"
                    className="col-span-4 flex min-w-0 items-center gap-2.5 text-muted-foreground"
                  >
                    <Initial name={invitation.email} />
                    <span className="truncate">Invitation pending</span>
                  </span>
                  <span role="cell" className="col-span-4 truncate text-muted-foreground">
                    {invitation.email}
                  </span>
                  <span role="cell" className="col-span-2 text-foreground">
                    {roleLabel(invitation.role || "member")}
                  </span>
                  <span
                    role="cell"
                    className="col-span-2 flex items-center justify-between gap-2 text-muted-foreground"
                  >
                    <span className="truncate whitespace-nowrap">
                      {invitation.createdAt ? ago(invitation.createdAt) : ""}
                    </span>
                    <RowMenu label={`Actions for the invitation to ${invitation.email}`}>
                      <DropdownMenuItem
                        data-resend-invitation={invitation.email}
                        onSelect={() =>
                          act(
                            () =>
                              authRequest("/organization/invite-member", {
                                email: invitation.email,
                                role: invitation.role || "viewer",
                                organizationId: active!.id,
                                resend: true,
                              }),
                            `Invitation resent to ${invitation.email}`,
                          )
                        }
                      >
                        <ArrowUpIcon />
                        Resend invitation
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        variant="destructive"
                        data-cancel-invitation={invitation.email}
                        onSelect={() =>
                          setConfirmation({
                            id: "members-cancel-invitation-confirm",
                            title: "Cancel invitation",
                            danger: true,
                            description: `Cancel the invitation to ${invitation.email}? Their invite link will stop working immediately.`,
                            cancel: "Keep invitation",
                            confirm: "Cancel invitation",
                            run: () =>
                              act(
                                () =>
                                  authRequest("/organization/cancel-invitation", {
                                    invitationId: invitation.id,
                                  }),
                                "Invitation canceled",
                              ),
                          })
                        }
                      >
                        <Trash2Icon />
                        Cancel invitation
                      </DropdownMenuItem>
                    </RowMenu>
                  </span>
                </div>
              ))
            : null}
          {members.length === 0 && !(manager && pendingShown.length) ? (
            <p className="px-4 py-3 text-sm text-muted-foreground">
              {full ? "No members match your search." : "Loading members…"}
            </p>
          ) : null}
        </div>
        <ConfirmDialog confirmation={confirmation} onClose={() => setConfirmation(null)} />
      </Section>

      {active ? (
        <Section id="members-access" title="Room access">
          <Card>
            <Row
              title="Default access for members"
              description="What members (not admins) can do in rooms shared in this workspace. Owners and admins can always manage them."
              htmlFor="members-room-role"
            >
              <NativeSelect
                id="members-room-role"
                disabled={!manager}
                value={memberRoomRole(active)}
                onChange={(e) => {
                  const roomRole = e.target.value;
                  act(
                    () =>
                      authRequest("/organization/update", {
                        organizationId: active.id,
                        data: { metadata: { roomRole } },
                      }),
                    "Default access updated",
                    // The room role lives in the listed workspace's metadata.
                    () => Promise.all([organizationsChanged(), refreshMembers()]),
                  );
                }}
              >
                {(Object.keys(ROOM_ROLE_LABEL) as MemberRoomRole[]).map((value) => (
                  <option key={value} value={value}>
                    {ROOM_ROLE_LABEL[value]}
                  </option>
                ))}
              </NativeSelect>
            </Row>
          </Card>
        </Section>
      ) : null}

      {active && !personal && me ? (
        <Section id="members-danger" title="Leave or delete">
          <Card>
            <Row
              title={`Leave ${active.name}`}
              description="You lose access to its rooms unless someone shares them with you directly."
            >
              <SettingsButton
                id="members-leave"
                onClick={() => {
                  if (!window.confirm(`Leave ${active.name}?`)) return;
                  act(
                    () => authRequest("/organization/leave", { organizationId: active.id }),
                    `You left ${active.name}`,
                    forget(active.id),
                  );
                }}
              >
                Leave
              </SettingsButton>
            </Row>
            {owner ? (
              <Row
                title="Delete organization"
                description="Only possible once its rooms have moved to another workspace."
              >
                <SettingsButton
                  id="members-delete"
                  className={cn("text-destructive")}
                  onClick={() => {
                    if (!window.confirm(`Delete ${active.name}? This cannot be undone.`)) return;
                    act(
                      () => authRequest("/organization/delete", { organizationId: active.id }),
                      `${active.name} deleted`,
                      forget(active.id),
                    );
                  }}
                >
                  Delete
                </SettingsButton>
              </Row>
            ) : null}
          </Card>
        </Section>
      ) : null}
    </div>
  );
}

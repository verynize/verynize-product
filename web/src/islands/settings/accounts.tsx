// Settings › Accounts: several Claude Code and Codex accounts side by side. "This Mac" is the computer's own
// Claude CLI login; Codex uses a separate SIWC connection. Every named account keeps its own private config folder (desktop/agent-profiles.cjs), signs in
// through its browser flow, and can be the default or picked per chat in the chat's Autonomy panel.
import { useCallback, useEffect, useState } from "react";
import {
  CheckIcon,
  LoaderCircleIcon,
  LogInIcon,
  LogOutIcon,
  PencilIcon,
  PlusIcon,
  RotateCwIcon,
  Trash2Icon,
} from "lucide-react";
import { toast } from "sonner";
import { ClaudeMark, CodexMark } from "@/components/icons";
import { Card, IconTile, PageHeader, Row, Section, SettingsButton, TextField } from "./controls";
import {
  AGENT_NAMES,
  desktopApi,
  errorText,
  type Agent,
  type ProfileList,
  type ProfileStatus,
} from "./workspace-ipc";

const AGENTS: Agent[] = ["claude", "codex"];

function AccountRow({
  agent,
  id,
  name,
  system,
  isDefault,
  status,
  pending,
  onChanged,
}: {
  agent: Agent;
  id: string;
  name: string;
  system: boolean;
  isDefault: boolean;
  status: ProfileStatus | null | undefined;
  pending: boolean;
  onChanged(): void;
}) {
  const api = desktopApi();
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(name);
  const profile = system ? undefined : id;
  const run = async (task: () => Promise<unknown> | undefined, done?: string) => {
    try {
      const result = await task();
      if (
        result &&
        typeof result === "object" &&
        "message" in result &&
        typeof result.message === "string"
      )
        toast(result.message);
      else if (done) toast(done);
      window.dispatchEvent(new Event("bd:agent-accounts-changed"));
      onChanged();
    } catch (error) {
      toast(errorText(error));
    }
  };
  const detail =
    status === undefined
      ? "Checking…"
      : status === null
        ? "Status unavailable"
        : !status.installed
          ? `${AGENT_NAMES[agent]} is not installed`
          : status.loggedIn
            ? [status.email, status.plan || status.method].filter(Boolean).join(" · ") ||
              "Signed in"
            : "Signed out";
  return (
    <div data-account={id} data-agent={agent} data-signed-in={status?.loggedIn ? "true" : "false"}>
      <Row
        title={
          renaming ? (
            <span className="flex items-center gap-2">
              <TextField
                aria-label="Account name"
                autoFocus
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    setRenaming(false);
                    void run(() => api?.agentProfiles?.rename({ id, name: draft }));
                  }
                  if (event.key === "Escape") setRenaming(false);
                }}
              />
            </span>
          ) : (
            <span className="flex items-center gap-2">
              <span data-role="account-name">{name}</span>
              {isDefault && (
                <span className="rounded-sm bg-primary-tint px-1.5 text-2xs leading-4.5 text-primary-text">
                  Default
                </span>
              )}
            </span>
          )
        }
        description={
          <span data-role="account-status">
            {detail}
            {!system && status?.configDir && (
              <span className="block truncate text-xs text-subtle-foreground">
                {status.configDir}
              </span>
            )}
          </span>
        }
        icon={
          <IconTile>
            {agent === "claude" ? (
              <ClaudeMark className="size-4" />
            ) : (
              <CodexMark className="size-4" />
            )}
          </IconTile>
        }
      >
        {pending ? (
          <SettingsButton data-action="cancel-signin" variant="ghost" disabled>
            <LoaderCircleIcon className="animate-spin" />
            Waiting for browser…
          </SettingsButton>
        ) : status?.loggedIn ? (
          <SettingsButton
            data-action="signout"
            variant="ghost"
            onClick={() =>
              void run(() => api?.agentLogout?.({ agent, profile }), `Signed out of ${name}`)
            }
          >
            <LogOutIcon />
            Sign out
          </SettingsButton>
        ) : (
          <SettingsButton
            data-action="signin"
            data-oai-siwc-button={agent === "codex" ? "" : undefined}
            variant="tint"
            disabled={status?.installed === false}
            onClick={() => void run(() => api?.startAgentLogin?.({ agent, profile }))}
          >
            <LogInIcon />
            {agent === "codex" ? "Continue with ChatGPT" : "Sign in"}
          </SettingsButton>
        )}
        {!isDefault && (
          <SettingsButton
            data-action="make-default"
            variant="ghost"
            onClick={() => void run(() => api?.agentProfiles?.setDefault({ agent, id }))}
          >
            <CheckIcon />
            Make default
          </SettingsButton>
        )}
        {!system && (
          <>
            <SettingsButton
              data-action="rename"
              variant="ghost"
              aria-label={`Rename ${name}`}
              onClick={() => {
                setDraft(name);
                setRenaming(true);
              }}
            >
              <PencilIcon />
            </SettingsButton>
            <SettingsButton
              data-action="remove"
              variant="ghost"
              aria-label={`Remove ${name}`}
              onClick={() => {
                if (
                  window.confirm(
                    `Remove ${name}? Its sign-in and settings folder are deleted from this Mac.`,
                  )
                )
                  void run(() => api?.agentProfiles?.remove({ id }), `Removed ${name}`);
              }}
            >
              <Trash2Icon />
            </SettingsButton>
          </>
        )}
      </Row>
    </div>
  );
}

export function AccountsPage() {
  const api = desktopApi();
  const [list, setList] = useState<ProfileList | null>(null);
  const [statuses, setStatuses] = useState<Record<string, ProfileStatus | null>>({});
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const [names, setNames] = useState<Record<Agent, string>>({ claude: "", codex: "" });

  const reload = useCallback(() => {
    if (!api?.agentProfiles) return;
    api.agentProfiles.list().then(
      (value) => {
        setList(value);
        for (const p of value.profiles) {
          const key = `${p.agent}:${p.id}`;
          Promise.resolve(
            api.agentAccountStatus?.({ agent: p.agent, ...(p.system ? {} : { profile: p.id }) }),
          )
            .then((status) => setStatuses((s) => ({ ...s, [key]: status ?? null })))
            .catch(() => setStatuses((s) => ({ ...s, [key]: null })));
        }
      },
      (error: unknown) => toast(errorText(error)),
    );
  }, [api]);
  useEffect(reload, [reload]);
  useEffect(
    () =>
      api?.onAuthEvent?.((event) => {
        const key = `${event.agent}:${event.profile ?? "system"}`;
        if (event.type === "started" || event.type === "waiting")
          setPending((p) => ({ ...p, [key]: true }));
        else {
          setPending((p) => ({ ...p, [key]: false }));
          if (event.type !== "complete") toast(event.message);
          reload();
        }
      }),
    [api, reload],
  );

  if (!api?.agentProfiles)
    return (
      <>
        <PageHeader title="Accounts" />
        <Card>
          <Row
            title="Available in the desktop app"
            description="Accounts are the Claude Code and Codex logins on this Mac."
          />
        </Card>
      </>
    );

  const add = async (agent: Agent) => {
    try {
      const profile = await api.agentProfiles!.add({ agent, name: names[agent] });
      setNames((n) => ({ ...n, [agent]: "" }));
      toast(`Added ${profile.name}. Sign in to use it.`);
      reload();
    } catch (error) {
      toast(errorText(error));
    }
  };

  return (
    <>
      <PageHeader
        title="Accounts"
        description="Connect ChatGPT to Verynize or use Claude Code. Each account stays private on this Mac; pick one per chat from the Autonomy panel. Codex terminal sign-ins are separate."
        action={
          <SettingsButton id="accounts-refresh" onClick={reload}>
            <RotateCwIcon />
            Check again
          </SettingsButton>
        }
      />
      <div className="flex flex-col gap-12.5">
        {AGENTS.map((agent) => (
          <Section key={agent} id={`accounts-${agent}`} title={`${AGENT_NAMES[agent]} accounts`}>
            <Card id={`accounts-list-${agent}`}>
              {(list?.profiles ?? [])
                .filter((p) => p.agent === agent)
                .map((p) => (
                  <AccountRow
                    key={p.id}
                    agent={agent}
                    id={p.id}
                    name={p.name}
                    system={p.system}
                    isDefault={list?.defaults[agent] === p.id}
                    status={statuses[`${agent}:${p.id}`]}
                    pending={!!pending[`${agent}:${p.id}`]}
                    onChanged={reload}
                  />
                ))}
              <form
                className="flex items-center gap-2 py-3.5"
                onSubmit={(event) => {
                  event.preventDefault();
                  void add(agent);
                }}
              >
                <TextField
                  id={`accounts-add-name-${agent}`}
                  aria-label={`New ${AGENT_NAMES[agent]} account name`}
                  placeholder="Account name, e.g. Work"
                  className="flex-1"
                  value={names[agent]}
                  onChange={(event) => setNames((n) => ({ ...n, [agent]: event.target.value }))}
                />
                <SettingsButton
                  id={`accounts-add-${agent}`}
                  type="submit"
                  disabled={!names[agent].trim()}
                >
                  <PlusIcon />
                  Add account
                </SettingsButton>
              </form>
            </Card>
          </Section>
        ))}
      </div>
    </>
  );
}

import { useCodexConnection } from "./codex-connection";
// Settings › Agents, top half (ref 71 + Wonder Tools / Access): provider accounts with the signed-in account,
// the agents' own MCP servers ("Tools") and the Access switches. Backed by desktop/agent-tools.cjs through
// window.desktop.agentTools; everything is feature-detected so the plain web build renders a note instead.
import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  AlertCircleIcon,
  BoxIcon,
  CheckIcon,
  CircleUserIcon,
  InfoIcon,
  LoaderCircleIcon,
  LockIcon,
  MoreHorizontalIcon,
  PlusIcon,
  RotateCwIcon,
  TerminalIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import { toast } from "sonner";
import { ClaudeMark, CodexMark } from "@/components/icons";
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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { AgentInfo, AuthKind, SettingsApi } from "./api";
import { Card, IconTile, Row, Section, SettingsButton, TextField, Toggle } from "./controls";
import { platform } from "@/lib/platform";

/* ---------- desktop contract (desktop/agent-tools.cjs) ---------- */
export type ProviderAccount = {
  email: string;
  organization: string;
  plan: string;
  method: string;
  default?: boolean;
};
export type Provider = {
  id: string;
  name: string;
  installed: boolean;
  loggedIn: boolean;
  comingSoon?: boolean;
  hint?: string;
  accounts: ProviderAccount[];
};
export type McpServer = {
  name: string;
  transport: "stdio" | "http" | "sse";
  target: string;
  command: string;
  status: "connected" | "needs-auth" | "error" | "disabled" | "pending" | "unknown";
  detail?: string;
  removable?: boolean;
  source?: string;
};
export type ServerList = {
  agent: string;
  installed: boolean;
  servers: McpServer[];
  checked: boolean;
  error?: string;
};
export type AccessSettings = {
  createFiles: boolean;
  shareMemory: boolean;
  askAgents: boolean;
  claudeConnectors: boolean;
  claudeArtifacts: boolean;
  claudeChrome: boolean;
  codexApps: boolean;
  codexComputerUse: boolean;
};
export type AddServer = {
  agent: string;
  name: string;
  transport: "stdio" | "http";
  command?: string;
  args?: string[];
  url?: string;
};
export type AgentToolsIpc = {
  accounts(): Promise<Provider[]>;
  listServers(options: { agent: string; check?: boolean }): Promise<ServerList>;
  addServer(options: AddServer): Promise<unknown>;
  removeServer(options: { agent: string; name: string }): Promise<unknown>;
  loginServer(options: { agent: string; name: string }): Promise<unknown>;
  getAccess(): Promise<AccessSettings>;
  setAccess(
    changes: Partial<AccessSettings>,
  ): Promise<{ settings: AccessSettings; stopped: number }>;
};
const desktop = () => platform.desktop;
const toolsIpc = () => desktop()?.agentTools ?? null;
const message = (error: unknown) =>
  (error instanceof Error ? error.message : String(error)).replace(
    /^Error invoking remote method '[^']+': (Error: )?/,
    "",
  );

const MCP_AGENTS = [
  { id: "claude", name: "Claude Code" },
  { id: "codex", name: "Codex" },
];

function ProviderMark({ id }: { id: string }) {
  if (id === "claude") return <ClaudeMark className="size-5" />;
  if (id === "codex") return <CodexMark className="size-5" />;
  if (id === "cursor") return <BoxIcon className="size-4" />;
  return <TerminalIcon className="size-4" />;
}

function Badge({ kind }: { kind: "ok" | "off" | "locked" }) {
  return (
    <span
      className={cn(
        "flex size-3.5 items-center justify-center rounded-full ring-2 ring-card",
        kind === "ok" ? "bg-success text-primary-foreground" : "bg-accent text-muted-foreground",
      )}
    >
      {kind === "ok" && <CheckIcon data-icon-weight="bold" className="size-2.5" />}
      {kind === "off" && <XIcon data-icon-weight="bold" className="size-2.5" />}
      {kind === "locked" && <LockIcon className="size-2.5" />}
    </span>
  );
}

/* ---------- Provider accounts ---------- */
function AccountMenu({
  name,
  run,
  signedIn,
}: {
  name: string;
  run: (kind: AuthKind) => void;
  signedIn: boolean;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <SettingsButton variant="ghost" className="w-7 px-0" aria-label={`${name} account actions`}>
          <MoreHorizontalIcon />
        </SettingsButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" onEscapeKeyDown={(event) => event.stopPropagation()}>
        <DropdownMenuItem onSelect={() => run("check")}>Check account</DropdownMenuItem>
        <DropdownMenuItem
          data-oai-siwc-button={name === "Codex" ? "" : undefined}
          onSelect={() => run("login")}
        >
          {name === "Codex" ? "Continue with ChatGPT" : signedIn ? "Switch account…" : "Sign in…"}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => run("cancel")}>Cancel sign-in</DropdownMenuItem>
        {signedIn && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={() => run("logout")}>
              Sign out…
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ProviderCard({
  provider,
  api,
  legacyStatus,
}: {
  provider: Provider;
  api: SettingsApi;
  legacyStatus?: string;
}) {
  const run = (kind: AuthKind) => void api.actions.auth(kind, provider.id);
  const count = provider.accounts.length;
  if (provider.comingSoon)
    return (
      <Card data-provider={provider.id}>
        <Row
          icon={
            <IconTile badge={<Badge kind="locked" />}>
              <ProviderMark id={provider.id} />
            </IconTile>
          }
          title={provider.name}
          description={
            provider.installed ? "Installed on this computer · coming soon" : "Coming soon"
          }
        />
      </Card>
    );
  return (
    <Card data-provider={provider.id}>
      <Row
        icon={
          <IconTile badge={<Badge kind={provider.installed && provider.loggedIn ? "ok" : "off"} />}>
            <ProviderMark id={provider.id} />
          </IconTile>
        }
        title={provider.name}
        description={
          !provider.installed
            ? "Not found on this computer"
            : count
              ? `${count} account${count === 1 ? "" : "s"} connected`
              : "No account signed in"
        }
      />
      {provider.installed &&
        (count ? (
          provider.accounts.map((account, index) => (
            <Row
              key={account.email || index}
              icon={
                <span className="flex size-8 shrink-0 items-center justify-center text-muted-foreground">
                  <CircleUserIcon className="size-5" />
                </span>
              }
              title={
                <span className="inline-flex items-center gap-2">
                  <span id={index === 0 ? `account-status-${provider.id}` : undefined}>
                    {account.email || account.method || "CLI account"}
                  </span>
                  {provider.hint && (
                    <span
                      role="img"
                      aria-label={provider.hint}
                      title={provider.hint}
                      className="inline-flex text-muted-foreground"
                    >
                      <InfoIcon className="size-3.5" />
                    </span>
                  )}
                  {account.default && (
                    <span className="rounded-sm border border-card-border bg-input px-1.5 text-xs text-foreground-3">
                      Default
                    </span>
                  )}
                </span>
              }
              description={[account.organization, account.plan].filter(Boolean).join(" · ")}
            >
              <AccountMenu name={provider.name} run={run} signedIn />
            </Row>
          ))
        ) : (
          <Row
            icon={
              <span className="flex size-8 shrink-0 items-center justify-center text-muted-foreground">
                <CircleUserIcon className="size-5" />
              </span>
            }
            title={<span id={`account-status-${provider.id}`}>{legacyStatus ?? "Signed out"}</span>}
            description={
              provider.id === "codex"
                ? "Connect ChatGPT to Verynize. Eligible requests use your ChatGPT plan; tokens stay on this Mac."
                : `Sign in with the ${provider.name} CLI to use it in chats.`
            }
          >
            <SettingsButton
              data-oai-siwc-button={provider.id === "codex" ? "" : undefined}
              onClick={() => run("login")}
            >
              {provider.id === "codex" ? "Continue with ChatGPT" : "Sign in"}
            </SettingsButton>
            <AccountMenu name={provider.name} run={run} signedIn={false} />
          </Row>
        ))}
    </Card>
  );
}

/**
 * The provider list inside "Provider accounts". Uses the desktop account details when available and falls back
 * to plain discovery (`agents`) otherwise.
 */
export function ProviderAccountList({
  api,
  agents,
  error,
  accounts,
}: {
  api: SettingsApi;
  agents: AgentInfo[] | null | undefined;
  error: string;
  accounts: Record<string, string>;
}) {
  const ipc = toolsIpc();
  const [providers, setProviders] = useState<Provider[] | null>(null);
  const reload = useCallback(() => {
    if (!ipc) return;
    ipc.accounts().then(setProviders, (e: unknown) => toast(message(e)));
  }, [ipc]);
  useEffect(reload, [reload]);
  // Re-read the accounts after a sign-in finishes or the legacy auth actions report a change.
  useEffect(
    () => desktop()?.onAuthEvent?.((event) => event.type === "complete" && reload()),
    [reload],
  );
  const statusKey = JSON.stringify(accounts);
  useEffect(() => {
    if (statusKey !== "{}") reload();
  }, [statusKey, reload]);

  let body: ReactNode;
  if (ipc && providers)
    body = providers.map((provider) => (
      <ProviderCard
        key={provider.id}
        provider={provider}
        api={api}
        legacyStatus={accounts[provider.id]}
      />
    ));
  else if (agents === undefined || (ipc && !providers))
    body = (
      <Card>
        <Row title="Checking installed agents…" />
      </Card>
    );
  else if (agents === null)
    body = (
      <Card>
        <Row
          title="Desktop app required"
          description="Open Verynize as a desktop app to use local agents."
        />
      </Card>
    );
  else if (!agents.length)
    body = (
      <Card>
        <Row
          title="No agents found"
          description={error || "Install Claude Code or Codex, then reopen settings."}
        />
      </Card>
    );
  else
    body = agents.map((agent) => (
      <ProviderCard
        key={agent.id}
        api={api}
        legacyStatus={accounts[agent.id]}
        provider={{
          id: agent.id,
          name: agent.id === "claude" ? "Claude Code" : "Codex",
          installed: agent.available,
          loggedIn: false,
          accounts: [],
        }}
      />
    ));
  return (
    <div id="settings-agent-list" className="flex flex-col gap-4">
      {body}
    </div>
  );
}

/* ---------- Tools (MCP servers) ---------- */
/** Split a command line into argv, honouring single and double quotes. */
export function splitCommandLine(text: string) {
  const out: string[] = [];
  let current = "",
    quote = "",
    started = false;
  for (const char of text.trim()) {
    if (quote) {
      if (char === quote) quote = "";
      else current += char;
    } else if (char === '"' || char === "'") {
      quote = char;
      started = true;
    } else if (/\s/.test(char)) {
      if (started || current) out.push(current);
      current = "";
      started = false;
    } else current += char;
  }
  if (started || current) out.push(current);
  return out;
}

// Servers the user turned off, or that the ChatGPT / Codex apps install and manage themselves (Computer Use and its
// REPLs; those follow the "Computer Use in Codex chats" switch below).
const MANAGED_BY_APP = ["/Applications/ChatGPT.app/", "/Applications/Codex.app/"];
const hidden = (server: McpServer) =>
  server.status === "disabled" ||
  MANAGED_BY_APP.some((prefix) => (server.command || "").startsWith(prefix));

function ServerStatus({
  server,
  checking,
  onSignIn,
  signingIn,
}: {
  server: McpServer;
  checking: boolean;
  onSignIn: () => void;
  signingIn: boolean;
}) {
  if (server.status === "needs-auth")
    return (
      <SettingsButton className="h-6" disabled={signingIn} onClick={onSignIn}>
        {signingIn ? "Signing in…" : "Sign in"}
      </SettingsButton>
    );
  if (server.status === "connected")
    return (
      <span
        role="img"
        aria-label="Connected"
        title={server.detail || "Connected"}
        className="flex size-6 items-center justify-center text-success"
      >
        <CheckIcon className="size-4" />
      </span>
    );
  if (server.status === "error" || server.status === "pending")
    return (
      <span
        role="img"
        aria-label={server.detail || "Could not connect"}
        title={server.detail || "Could not connect"}
        className={cn(
          "flex size-6 items-center justify-center",
          server.status === "error" ? "text-destructive" : "text-muted-foreground",
        )}
      >
        <AlertCircleIcon className="size-4" />
      </span>
    );
  return checking ? (
    <span
      role="img"
      aria-label="Checking"
      className="flex size-6 items-center justify-center text-muted-foreground"
    >
      <LoaderCircleIcon className="size-3.5 animate-spin" />
    </span>
  ) : null;
}

function AgentServers({ agent, name }: { agent: string; name: string }) {
  const ipc = toolsIpc()!;
  const [list, setList] = useState<ServerList | null>(null);
  const [checking, setChecking] = useState(false);
  const [busy, setBusy] = useState<string>("");
  const [adding, setAdding] = useState(false);
  const refresh = useCallback(async () => {
    try {
      setList(await ipc.listServers({ agent }));
      setChecking(true);
      const checked = await ipc.listServers({ agent, check: true });
      setList(checked);
      if (checked.error) toast(`${name}: ${checked.error}`);
    } catch (error) {
      toast(message(error));
    } finally {
      setChecking(false);
    }
  }, [ipc, agent, name]);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const act = async (key: string, fn: () => Promise<unknown>, done?: string) => {
    setBusy(key);
    try {
      await fn();
      if (done) toast(done);
      await refresh();
    } catch (error) {
      toast(message(error));
    } finally {
      setBusy("");
    }
  };
  const visible = list?.servers.filter((server) => !hidden(server)) ?? [];
  const hiddenCount = (list?.servers.length ?? 0) - visible.length;

  return (
    <div className="flex flex-col py-2" data-agent-tools={agent}>
      <div className="flex h-10 items-center gap-2">
        <span className="flex size-4 items-center justify-center [&_svg]:size-3.5">
          {agent === "claude" ? <ClaudeMark /> : <CodexMark />}
        </span>
        <span className="flex-1 text-sm text-foreground">{name}</span>
        <SettingsButton
          variant="ghost"
          className="w-7 px-0"
          aria-label={`Refresh ${name} tools`}
          disabled={checking}
          onClick={() => void refresh()}
        >
          <RotateCwIcon className={cn(checking && "animate-spin")} />
        </SettingsButton>
        <SettingsButton disabled={list?.installed === false} onClick={() => setAdding(true)}>
          <PlusIcon />
          Add tool
        </SettingsButton>
      </div>
      {list?.installed === false && (
        <p className="py-2 text-sm text-muted-foreground">
          {name} is not installed on this computer.
        </p>
      )}
      {list?.installed !== false && list && !visible.length && (
        <p className="py-2 text-sm text-muted-foreground">
          No MCP servers in {name}’s settings yet.
        </p>
      )}
      {visible.map((server) => (
        <div key={server.name} data-server={server.name} className="flex h-8.5 items-center gap-3">
          <span aria-hidden className="w-3 text-center text-xs text-foreground-3 uppercase">
            {server.name.charAt(0)}
          </span>
          <span className="min-w-0 flex-1 truncate text-sm text-foreground" title={server.target}>
            {server.name}
          </span>
          <ServerStatus
            server={server}
            checking={checking}
            signingIn={busy === `login:${server.name}`}
            onSignIn={() =>
              void act(
                `login:${server.name}`,
                () => {
                  toast(`Finish signing in to ${server.name} in your browser.`);
                  return ipc.loginServer({ agent, name: server.name });
                },
                `Signed in to ${server.name}`,
              )
            }
          />
          {server.removable !== false && (
            <SettingsButton
              variant="ghost"
              className="size-6 px-0"
              aria-label={`Remove ${server.name} from ${name}`}
              disabled={busy === `remove:${server.name}`}
              onClick={() => {
                if (
                  !window.confirm(
                    `Remove ${server.name} from ${name}? This changes ${name}’s own settings on this computer.`,
                  )
                )
                  return;
                void act(
                  `remove:${server.name}`,
                  () => ipc.removeServer({ agent, name: server.name }),
                  `Removed ${server.name}`,
                );
              }}
            >
              <Trash2Icon />
            </SettingsButton>
          )}
        </div>
      ))}
      {hiddenCount > 0 && (
        <p className="pt-1 text-xs text-muted-foreground">
          {hiddenCount} more {hiddenCount === 1 ? "server is" : "servers are"} turned off or managed
          by another app.
        </p>
      )}
      <AddToolDialog
        open={adding}
        agentName={name}
        onOpenChange={setAdding}
        onSubmit={async (server) => {
          await ipc.addServer({ agent, ...server });
          toast(`Added ${server.name} to ${name}`);
          setAdding(false);
          await refresh();
        }}
      />
    </div>
  );
}

function AddToolDialog({
  open,
  agentName,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  agentName: string;
  onOpenChange: (open: boolean) => void;
  onSubmit: (server: Omit<AddServer, "agent">) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [transport, setTransport] = useState<"stdio" | "http">("http");
  const [target, setTarget] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) {
      setName("");
      setTarget("");
      setTransport("http");
    }
  }, [open]);
  const submit = async () => {
    const argv = splitCommandLine(target);
    setBusy(true);
    try {
      await onSubmit(
        transport === "http"
          ? { name: name.trim(), transport, url: target.trim() }
          : { name: name.trim(), transport, command: argv[0] ?? "", args: argv.slice(1) },
      );
    } catch (error) {
      toast(message(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add a tool to {agentName}</DialogTitle>
          <DialogDescription>
            Saved in {agentName}’s own settings, so its CLI and other apps can use it too.
          </DialogDescription>
        </DialogHeader>
        <form
          id="settings-add-tool-form"
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <label className="flex flex-col gap-1.5 text-sm text-foreground">
            Name
            <TextField
              id="settings-add-tool-name"
              required
              autoFocus
              pattern="[a-zA-Z0-9][a-zA-Z0-9_.\-]{0,63}"
              placeholder="my-server"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <div
            role="radiogroup"
            aria-label="Connection"
            className="flex gap-1 rounded-md bg-input p-0.5"
          >
            {(
              [
                ["http", "Server URL"],
                ["stdio", "Command"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={transport === value}
                data-transport={value}
                onClick={() => setTransport(value)}
                className={cn(
                  "h-6 flex-1 rounded-sm text-sm text-muted-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring",
                  transport === value && "bg-accent text-foreground",
                )}
              >
                {label}
              </button>
            ))}
          </div>
          <label className="flex flex-col gap-1.5 text-sm text-foreground">
            {transport === "http" ? "URL" : "Command"}
            <TextField
              id="settings-add-tool-target"
              required
              type={transport === "http" ? "url" : "text"}
              placeholder={
                transport === "http" ? "https://example.com/mcp" : "npx -y @scope/mcp-server --flag"
              }
              value={target}
              onChange={(event) => setTarget(event.target.value)}
            />
            <span className="text-xs text-muted-foreground">
              {transport === "http"
                ? "Streamable HTTP server. If it needs OAuth, use Sign in after adding it."
                : "Started on this computer over stdio. Quote arguments that contain spaces."}
            </span>
          </label>
        </form>
        <DialogFooter>
          <SettingsButton onClick={() => onOpenChange(false)}>Cancel</SettingsButton>
          <SettingsButton
            id="settings-add-tool-save"
            type="submit"
            form="settings-add-tool-form"
            variant="primary"
            disabled={busy}
          >
            {busy ? "Adding…" : "Add tool"}
          </SettingsButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function AgentToolsSection() {
  const { connected: codexConnected } = useCodexConnection();
  const ipc = toolsIpc();
  return (
    <Section
      id="settings-agent-tools"
      title="Tools"
      description="MCP servers from your agents’ own settings on this computer."
    >
      <Card>
        {ipc ? (
          MCP_AGENTS.filter((agent) => agent.id !== "codex" || codexConnected).map((agent) => (
            <AgentServers key={agent.id} agent={agent.id} name={agent.name} />
          ))
        ) : (
          <Row
            title="Available in the desktop app"
            description="Tools come from Claude Code and Codex settings on this computer."
          />
        )}
      </Card>
    </Section>
  );
}

/* ---------- Access ---------- */
const CHROME_EXTENSION_URL = "https://claude.ai/chrome";
const ACCESS_ROWS: { key: keyof AccessSettings; title: string; description: ReactNode }[] = [
  {
    key: "createFiles",
    title: "Let agents create files, folders and pages",
    description: "Agents create what a task or Preview needs, instead of asking.",
  },
  {
    key: "shareMemory",
    title: "Share memory between your agents",
    description: "Each chat sees what your other agents remember.",
  },
  {
    key: "askAgents",
    title: "Let agents ask other agents",
    description: "Read-only second opinions from other models.",
  },
  {
    key: "claudeConnectors",
    title: "Claude connectors",
    description: "Use your claude.ai connectors in Claude chats.",
  },
  {
    key: "claudeArtifacts",
    title: "Claude artifacts",
    description: "Read, publish and update artifacts through your Claude account.",
  },
  {
    key: "claudeChrome",
    title: "Use Chrome in Claude chats",
    description: (
      <span className="flex flex-col gap-2">
        <span>Needs the extension and a Claude plan sign-in.</span>
        <button
          type="button"
          className="self-start text-sm text-foreground underline decoration-edge underline-offset-4 hover:decoration-foreground"
          onClick={() => {
            const open = desktop()?.openExternal;
            if (open) void open(CHROME_EXTENSION_URL);
            else window.open(CHROME_EXTENSION_URL, "_blank", "noopener");
          }}
        >
          Get the Claude in Chrome extension
        </button>
      </span>
    ),
  },
  {
    key: "codexApps",
    title: "ChatGPT apps in Codex chats",
    description: "Use your ChatGPT apps in Codex chats.",
  },
  {
    key: "codexComputerUse",
    title: "Computer Use in Codex chats",
    description:
      "Control desktop apps with Computer Use set up in Codex or ChatGPT. Verynize designs use the canvas tools. Turning this off stops chats that have access.",
  },
];

export function AgentAccessSection() {
  const { connected: codexConnected } = useCodexConnection();
  const ipc = toolsIpc();
  const [settings, setSettings] = useState<AccessSettings | null>(null);
  useEffect(() => {
    ipc?.getAccess().then(setSettings, (e: unknown) => toast(message(e)));
  }, [ipc]);
  const change = async (key: keyof AccessSettings, value: boolean) => {
    if (!ipc || !settings) return;
    setSettings({ ...settings, [key]: value });
    try {
      const result = await ipc.setAccess({ [key]: value });
      setSettings(result.settings);
      if (result.stopped)
        toast(
          `Stopped ${result.stopped} chat${result.stopped === 1 ? "" : "s"} using Computer Use`,
        );
    } catch (error) {
      setSettings(settings);
      toast(message(error));
    }
  };
  return (
    <Section
      id="settings-agent-access"
      title="Access"
      description="Changes apply when a chat’s agent next starts."
    >
      <Card>
        {ipc ? (
          ACCESS_ROWS.filter((row) => !row.key.startsWith("codex") || codexConnected).map((row) => (
            <Row
              key={row.key}
              title={row.title}
              description={
                row.key === "codexApps" || row.key === "codexComputerUse"
                  ? "Unavailable with Sign in with ChatGPT. Local canvas and MCP tools remain available."
                  : row.description
              }
            >
              <Toggle
                aria-label={row.title}
                data-access={row.key}
                disabled={!settings || row.key === "codexApps" || row.key === "codexComputerUse"}
                checked={Boolean(settings?.[row.key])}
                onCheckedChange={(checked) => void change(row.key, checked)}
              />
            </Row>
          ))
        ) : (
          <Row
            title="Available in the desktop app"
            description="Access settings apply to the agents installed on this computer."
          />
        )}
      </Card>
    </Section>
  );
}

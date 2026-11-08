import { useCodexConnection } from "./codex-connection";
// Settings › Tools: MCP servers Verynize passes to every chat (global or per project, to Claude, Codex or both)
// and default permissions per tool (desktop/agent-tool-config.cjs). Environment values are write-only: the
// page only ever sees variable names.
import { useCallback, useEffect, useState } from "react";
import { PlusIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";
import {
  Card,
  NativeSelect,
  PageHeader,
  Row,
  Section,
  SettingsButton,
  TextField,
  Toggle,
} from "./controls";
import {
  desktopApi,
  errorText,
  type Agent,
  type PermissionRule,
  type Repository,
  type ToolServer,
} from "./workspace-ipc";

/** Split a command line into argv, honouring quotes. */
function argv(text: string) {
  const out: string[] = [];
  const re = /"((?:[^"\\]|\\.)*)"|'([^']*)'|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)))
    out.push(m[1] !== undefined ? m[1].replace(/\\(.)/g, "$1") : (m[2] ?? m[3]));
  return out;
}
/** `KEY=value` lines → object; a bare `KEY` keeps the stored value (null). */
function envLines(text: string) {
  const env: Record<string, string | null> = {};
  for (const line of text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)) {
    const i = line.indexOf("=");
    if (i < 0) env[line] = null;
    else env[line.slice(0, i).trim()] = line.slice(i + 1);
  }
  return env;
}

type Draft = {
  id?: string;
  name: string;
  transport: "stdio" | "http";
  command: string;
  env: string;
  url: string;
  tokenEnv: string;
  scope: string;
  agents: "both" | Agent;
};
const EMPTY: Draft = {
  name: "",
  transport: "stdio",
  command: "",
  env: "",
  url: "",
  tokenEnv: "",
  scope: "global",
  agents: "both",
};

function ServerForm({
  repos,
  initial,
  onDone,
}: {
  repos: Repository[];
  initial: Draft;
  onDone(): void;
}) {
  const api = desktopApi();
  const { connected: codexConnected } = useCodexConnection();
  const [d, setD] = useState<Draft>(initial);
  useEffect(
    () => setD(initial.id || codexConnected ? initial : { ...initial, agents: "claude" }),
    [initial, codexConnected],
  );
  const set = (patch: Partial<Draft>) => setD((v) => ({ ...v, ...patch }));
  const save = async () => {
    const [command, ...args] = argv(d.command);
    try {
      await api?.agentToolConfig?.saveServer({
        ...(d.id ? { id: d.id } : {}),
        name: d.name.trim(),
        transport: d.transport,
        ...(d.transport === "http"
          ? { url: d.url.trim(), tokenEnv: d.tokenEnv.trim() }
          : { command: command ?? "", args, env: envLines(d.env) }),
        scope: d.scope === "global" ? "global" : "project",
        project: d.scope === "global" ? null : d.scope,
        agents: d.agents === "both" ? ["claude", "codex"] : [d.agents],
      });
      toast(d.id ? `Updated ${d.name}` : `Added ${d.name}`);
      setD(EMPTY);
      onDone();
    } catch (error) {
      toast(errorText(error));
    }
  };
  return (
    <form
      id="tools-server-form"
      className="flex flex-col gap-2.5 py-3.5"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <div className="flex gap-2">
        <TextField
          name="toolName"
          aria-label="Server name"
          placeholder="Name, e.g. github"
          className="flex-1"
          value={d.name}
          onChange={(e) => set({ name: e.target.value })}
        />
        <NativeSelect
          name="toolTransport"
          aria-label="Transport"
          value={d.transport}
          onChange={(e) => set({ transport: e.target.value as Draft["transport"] })}
        >
          <option value="stdio">Command (stdio)</option>
          <option value="http">URL (HTTP)</option>
        </NativeSelect>
      </div>
      {d.transport === "stdio" ? (
        <>
          <TextField
            name="toolCommand"
            aria-label="Command"
            placeholder="npx -y @scope/server --flag"
            value={d.command}
            onChange={(e) => set({ command: e.target.value })}
          />
          <textarea
            name="toolEnv"
            aria-label="Environment variables"
            placeholder={"API_KEY=… (one per line; leave just the name to keep a saved value)"}
            rows={2}
            className="rounded-md border border-input bg-background px-3 py-1.5 font-mono text-xs text-foreground outline-none placeholder:text-subtle-foreground focus:border-primary"
            value={d.env}
            onChange={(e) => set({ env: e.target.value })}
          />
        </>
      ) : (
        <div className="flex gap-2">
          <TextField
            name="toolUrl"
            aria-label="Server URL"
            placeholder="https://example.com/mcp"
            className="flex-1"
            value={d.url}
            onChange={(e) => set({ url: e.target.value })}
          />
          <TextField
            name="toolTokenEnv"
            aria-label="Token variable"
            placeholder="Token variable (optional)"
            value={d.tokenEnv}
            onChange={(e) => set({ tokenEnv: e.target.value })}
          />
        </div>
      )}
      <div className="flex items-center gap-2">
        <NativeSelect
          name="toolScope"
          aria-label="Scope"
          value={d.scope}
          onChange={(e) => set({ scope: e.target.value })}
        >
          <option value="global">All projects</option>
          {repos.map((r) => (
            <option key={r.id} value={r.root}>
              Only {r.name}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect
          name="toolAgents"
          aria-label="Agents"
          value={d.agents}
          onChange={(e) => set({ agents: e.target.value as Draft["agents"] })}
        >
          {(codexConnected || d.agents === "both") && (
            <option value="both">{codexConnected ? "Claude Code and Codex" : "Claude Code"}</option>
          )}
          <option value="claude">Claude Code only</option>
          {codexConnected && <option value="codex">Codex only</option>}
        </NativeSelect>
        <span className="flex-1" />
        {d.id && (
          <SettingsButton variant="ghost" onClick={() => setD(EMPTY)}>
            Cancel
          </SettingsButton>
        )}
        <SettingsButton
          id="tools-server-save"
          type="submit"
          variant="primary"
          disabled={!d.name.trim()}
        >
          {d.id ? "Save server" : "Add server"}
        </SettingsButton>
      </div>
    </form>
  );
}

export function ToolsPage() {
  const { connected: codexConnected } = useCodexConnection();
  const api = desktopApi();
  const [servers, setServers] = useState<ToolServer[]>([]);
  const [rules, setRules] = useState<PermissionRule[]>([]);
  const [repos, setRepos] = useState<Repository[]>([]);
  const [editing, setEditing] = useState<Draft>(EMPTY);
  const [rule, setRule] = useState<{
    tool: string;
    decision: PermissionRule["decision"];
    scope: string;
  }>({ tool: "", decision: "ask", scope: "global" });
  const reload = useCallback(() => {
    api?.agentToolConfig?.list().then(
      (v) => {
        setServers(v.servers);
        setRules(v.permissions);
      },
      (e: unknown) => toast(errorText(e)),
    );
  }, [api]);
  useEffect(() => {
    reload();
    api?.repositories?.list().then(
      (v) => setRepos(v.repositories),
      () => setRepos([]),
    );
  }, [api, reload]);
  const repoName = (root: string | null) => repos.find((r) => r.root === root)?.name ?? root ?? "";

  if (!api?.agentToolConfig)
    return (
      <>
        <PageHeader title="Tools" />
        <Card>
          <Row title="Available in the desktop app" />
        </Card>
      </>
    );
  const saveRule = async (
    input: { tool: string; decision: string; scope: string },
    remove = false,
  ) => {
    try {
      await api.agentToolConfig!.setPermission({
        tool: input.tool.trim(),
        decision: input.decision,
        scope: input.scope === "global" ? "global" : "project",
        project: input.scope === "global" ? null : input.scope,
        remove,
      });
      reload();
    } catch (error) {
      toast(errorText(error));
    }
  };

  return (
    <>
      <PageHeader
        title="Tools"
        description="MCP servers and permission defaults Verynize passes to every chat it starts. They are added to whatever each agent already has configured for itself."
      />
      <div className="flex flex-col gap-12.5">
        <Section
          id="tools-servers"
          title="MCP servers"
          description="Disabled servers stay saved but are not passed to chats."
        >
          <Card id="tools-server-list">
            {servers
              .filter((s) => codexConnected || s.agents.includes("claude"))
              .map((s) => (
                <div key={s.id} data-tool-server={s.name}>
                  <Row
                    title={s.name}
                    description={
                      <>
                        <span className="block truncate font-mono text-xs">
                          {s.transport === "http"
                            ? s.url
                            : [s.command, ...(s.args ?? [])].join(" ")}
                        </span>
                        <span>
                          {s.scope === "global" ? "All projects" : `Only ${repoName(s.project)}`} ·{" "}
                          {s.agents.length === 2 && codexConnected
                            ? "Claude Code and Codex"
                            : s.agents.includes("claude")
                              ? "Claude Code"
                              : "Codex"}
                          {s.envKeys?.length ? ` · env: ${s.envKeys.join(", ")}` : ""}
                        </span>
                      </>
                    }
                  >
                    <Toggle
                      aria-label={`Use ${s.name}`}
                      checked={s.enabled}
                      onCheckedChange={(enabled) =>
                        void api
                          .agentToolConfig!.setEnabled({ id: s.id, enabled })
                          .then(reload, (e: unknown) => toast(errorText(e)))
                      }
                    />
                    <SettingsButton
                      variant="ghost"
                      data-action="edit"
                      onClick={() =>
                        setEditing({
                          id: s.id,
                          name: s.name,
                          transport: s.transport,
                          command: [s.command ?? "", ...(s.args ?? [])]
                            .map((a) => (/\s/.test(a) ? JSON.stringify(a) : a))
                            .join(" "),
                          env: (s.envKeys ?? []).join("\n"),
                          url: s.url ?? "",
                          tokenEnv: s.tokenEnv ?? "",
                          scope: s.scope === "global" ? "global" : (s.project ?? "global"),
                          agents: s.agents.length === 2 ? "both" : s.agents[0],
                        })
                      }
                    >
                      Edit
                    </SettingsButton>
                    <SettingsButton
                      variant="ghost"
                      data-action="remove"
                      aria-label={`Remove ${s.name}`}
                      onClick={() =>
                        void api
                          .agentToolConfig!.removeServer({ id: s.id })
                          .then(reload, (e: unknown) => toast(errorText(e)))
                      }
                    >
                      <Trash2Icon />
                    </SettingsButton>
                  </Row>
                </div>
              ))}
            <ServerForm
              repos={repos}
              initial={editing}
              onDone={() => {
                setEditing(EMPTY);
                reload();
              }}
            />
          </Card>
        </Section>
        <Section
          id="tools-permissions"
          title="Permission defaults"
          description="Allow or deny a tool without asking, in every chat. Use a trailing * for a prefix (mcp__github__*). A chat's Autonomy panel can still override these."
        >
          <Card id="tools-permission-list">
            {rules.map((r) => (
              <div key={`${r.tool}|${r.scope}|${r.project ?? ""}`} data-permission={r.tool}>
                <Row
                  title={<code className="font-mono text-xs">{r.tool}</code>}
                  description={
                    r.scope === "global" ? "All projects" : `Only ${repoName(r.project)}`
                  }
                >
                  <NativeSelect
                    aria-label={`Decision for ${r.tool}`}
                    value={r.decision}
                    onChange={(e) =>
                      void saveRule({
                        tool: r.tool,
                        decision: e.target.value,
                        scope: r.scope === "global" ? "global" : (r.project ?? "global"),
                      })
                    }
                  >
                    <option value="allow">Allow</option>
                    <option value="ask">Ask</option>
                    <option value="deny">Deny</option>
                  </NativeSelect>
                  <SettingsButton
                    variant="ghost"
                    aria-label={`Remove rule for ${r.tool}`}
                    onClick={() =>
                      void saveRule(
                        {
                          tool: r.tool,
                          decision: r.decision,
                          scope: r.scope === "global" ? "global" : (r.project ?? "global"),
                        },
                        true,
                      )
                    }
                  >
                    <Trash2Icon />
                  </SettingsButton>
                </Row>
              </div>
            ))}
            <form
              className="flex items-center gap-2 py-3.5"
              onSubmit={(event) => {
                event.preventDefault();
                void saveRule(rule).then(() => setRule((v) => ({ ...v, tool: "" })));
              }}
            >
              <TextField
                name="permissionTool"
                aria-label="Tool"
                placeholder="Bash, shell, edit, mcp__github__*"
                className="flex-1"
                value={rule.tool}
                onChange={(e) => setRule((v) => ({ ...v, tool: e.target.value }))}
              />
              <NativeSelect
                name="permissionDecision"
                aria-label="Decision"
                value={rule.decision}
                onChange={(e) =>
                  setRule((v) => ({ ...v, decision: e.target.value as PermissionRule["decision"] }))
                }
              >
                <option value="allow">Allow</option>
                <option value="ask">Ask</option>
                <option value="deny">Deny</option>
              </NativeSelect>
              <NativeSelect
                name="permissionScope"
                aria-label="Scope"
                value={rule.scope}
                onChange={(e) => setRule((v) => ({ ...v, scope: e.target.value }))}
              >
                <option value="global">All projects</option>
                {repos.map((r) => (
                  <option key={r.id} value={r.root}>
                    Only {r.name}
                  </option>
                ))}
              </NativeSelect>
              <SettingsButton id="tools-permission-add" type="submit" disabled={!rule.tool.trim()}>
                <PlusIcon />
                Add rule
              </SettingsButton>
            </form>
          </Card>
        </Section>
      </div>
    </>
  );
}

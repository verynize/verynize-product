// Settings › Tools: MCP servers and tool permission defaults that Verynize itself passes to every chat.
//
// Unlike desktop/agent-tools.cjs (which edits the agents' own ~/.claude.json and ~/.codex/config.toml), these
// servers live in `userData/agent-tool-config.json` and are injected per run by desktop/agent-runtime.cjs:
//   Claude Agent SDK  options.mcpServers[name] = {type:'stdio', command, args, env} | {type:'http', url}
//   Codex app-server  -c mcp_servers.<name>.command / args / env_vars / url / bearer_token_env_var
// A server is global or scoped to one project (a registered repository root; its chat worktrees match too),
// and can target both agents or one. Disabled servers are kept but not passed.
//
// Secrets: stdio environment values are stored with mode 0600 and never returned to the renderer (only the
// variable names are). Codex receives them through `env_vars` (names in argv, values in the child environment),
// Claude through the SDK option object; neither puts a value in argv.
//
// Permission defaults: {tool, decision: allow|ask|deny, scope, project}. `tool` is an exact tool name or a
// trailing-`*` prefix (`mcp__github__*`). Claude gets allow → allowedTools, deny → disallowedTools; for both
// agents the runtime also applies them to approval requests (desktop/agent-runtime.cjs askPermission).
const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");

const AGENTS = ["claude", "codex"];
const SERVER_NAME = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,47}$/;
const RESERVED = new Set(["verynize"]);
const ENV_KEY = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
const TOOL = /^[A-Za-z0-9_.:-]{1,120}\*?$/;
const DECISIONS = ["allow", "ask", "deny"];
const MAX_SERVERS = 64;
const MAX_RULES = 200;

function checkProject(scope, project) {
  if (scope === "global") return null;
  if (scope !== "project") throw Error("Choose global or project scope");
  if (typeof project !== "string" || !path.isAbsolute(project) || project.includes("\0"))
    throw Error("Choose a project");
  return path.resolve(project);
}

function normalizeServer(input, previous = null) {
  const o = input && typeof input === "object" ? input : {};
  const name = typeof o.name === "string" ? o.name.trim() : "";
  if (!SERVER_NAME.test(name))
    throw Error("Use a server name with letters, numbers, dashes or underscores");
  if (RESERVED.has(name.toLowerCase()))
    throw Error("That name is reserved for the Verynize canvas tools");
  const scope = o.scope === "project" ? "project" : "global";
  const project = checkProject(scope, o.project);
  const agents = Array.isArray(o.agents) ? AGENTS.filter((a) => o.agents.includes(a)) : [...AGENTS];
  if (!agents.length) throw Error("Pass the server to at least one agent");
  const server = {
    id: previous?.id || crypto.randomBytes(8).toString("hex"),
    name,
    scope,
    project,
    agents,
    enabled: o.enabled !== false,
    transport: o.transport === "http" ? "http" : "stdio",
    createdAt: previous?.createdAt || Date.now(),
  };
  if (server.transport === "http") {
    let url;
    try {
      url = new URL(o.url);
    } catch {
      throw Error("Enter a valid server URL");
    }
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password)
      throw Error("Use an HTTP or HTTPS URL without credentials");
    server.url = url.href;
    const tokenEnv = typeof o.tokenEnv === "string" ? o.tokenEnv.trim() : "";
    if (tokenEnv && !ENV_KEY.test(tokenEnv)) throw Error("The token variable name is invalid");
    if (tokenEnv) server.tokenEnv = tokenEnv;
    return server;
  }
  const command = typeof o.command === "string" ? o.command.trim() : "";
  if (!command || command.length > 1000 || command.includes("\0"))
    throw Error("Enter the command that starts the server");
  const args = Array.isArray(o.args) ? o.args : [];
  if (
    args.length > 64 ||
    args.some((a) => typeof a !== "string" || a.length > 2000 || a.includes("\0"))
  )
    throw Error("Too many or too long arguments");
  server.command = command;
  server.args = args.slice();
  // env: {KEY: value}; a value of null keeps the stored one (the renderer never sees values).
  const env = {};
  const given = o.env && typeof o.env === "object" ? o.env : null;
  const source = given || previous?.env || {};
  for (const [key, value] of Object.entries(source)) {
    if (!ENV_KEY.test(key)) throw Error("Invalid environment variable name");
    const actual =
      value === null && previous?.env && Object.hasOwn(previous.env, key)
        ? previous.env[key]
        : value;
    if (typeof actual !== "string" || actual.length > 4000)
      throw Error("Invalid environment variable value");
    env[key] = actual;
  }
  if (Object.keys(env).length > 32) throw Error("Too many environment variables");
  server.env = env;
  return server;
}

function normalizeRule(input) {
  const o = input && typeof input === "object" ? input : {};
  const tool = typeof o.tool === "string" ? o.tool.trim() : "";
  if (!TOOL.test(tool)) throw Error("Enter a tool name such as Bash, shell or mcp__github__*");
  if (!DECISIONS.includes(o.decision)) throw Error("Choose allow, ask or deny");
  const scope = o.scope === "project" ? "project" : "global";
  return { tool, decision: o.decision, scope, project: checkProject(scope, o.project) };
}

/** `pattern` matches `name` exactly or, with a trailing `*`, by prefix. */
function toolMatches(pattern, name) {
  if (typeof pattern !== "string" || typeof name !== "string") return false;
  return pattern.endsWith("*") ? name.startsWith(pattern.slice(0, -1)) : pattern === name;
}

const inProject = (entry, projects) =>
  entry.scope === "global" || projects.some((p) => p && entry.project === path.resolve(p));

class AgentToolConfig {
  constructor({ userData } = {}) {
    if (!userData) throw Error("userData directory required");
    this.file = path.join(userData, "agent-tool-config.json");
    this.data = null;
    this.queue = Promise.resolve();
  }
  serial(fn) {
    const next = this.queue.then(fn, fn);
    this.queue = next.catch(() => {});
    return next;
  }
  async load() {
    if (this.data) return this.data;
    let data = { version: 1, servers: [], permissions: [] };
    try {
      const parsed = JSON.parse(await fs.readFile(this.file, "utf8"));
      if (Array.isArray(parsed?.servers))
        for (const s of parsed.servers.slice(0, MAX_SERVERS)) {
          try {
            data.servers.push(normalizeServer(s, s));
          } catch {}
        }
      if (Array.isArray(parsed?.permissions))
        for (const r of parsed.permissions.slice(0, MAX_RULES)) {
          try {
            data.permissions.push(normalizeRule(r));
          } catch {}
        }
    } catch {}
    this.data = data;
    return data;
  }
  async save() {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    const temp = `${this.file}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`;
    await fs.writeFile(temp, JSON.stringify(this.data, null, 2) + "\n", { mode: 0o600 });
    await fs.rename(temp, this.file);
  }
  /** Renderer view: environment variable names only. */
  view(server) {
    const { env, ...rest } = server;
    return { ...rest, ...(env ? { envKeys: Object.keys(env) } : {}) };
  }
  async list() {
    const data = await this.load();
    return {
      servers: data.servers.map((s) => this.view(s)),
      permissions: data.permissions.map((r) => ({ ...r })),
    };
  }
  saveServer(input = {}) {
    return this.serial(async () => {
      const data = await this.load();
      const previous = input.id ? data.servers.find((s) => s.id === input.id) : null;
      if (input.id && !previous) throw Error("That server no longer exists");
      const server = normalizeServer(input, previous);
      if (
        data.servers.some(
          (s) =>
            s !== previous &&
            s.name.toLowerCase() === server.name.toLowerCase() &&
            s.scope === server.scope &&
            s.project === server.project,
        )
      )
        throw Error(`A server named ${server.name} already exists here`);
      if (previous) data.servers[data.servers.indexOf(previous)] = server;
      else {
        if (data.servers.length >= MAX_SERVERS)
          throw Error("Remove a server before adding another");
        data.servers.push(server);
      }
      await this.save();
      return this.view(server);
    });
  }
  setServerEnabled({ id, enabled } = {}) {
    return this.serial(async () => {
      const data = await this.load();
      const server = data.servers.find((s) => s.id === id);
      if (!server) throw Error("That server no longer exists");
      server.enabled = enabled === true;
      await this.save();
      return this.view(server);
    });
  }
  removeServer({ id } = {}) {
    return this.serial(async () => {
      const data = await this.load();
      const before = data.servers.length;
      data.servers = data.servers.filter((s) => s.id !== id);
      if (data.servers.length === before) throw Error("That server no longer exists");
      await this.save();
      return { removed: true };
    });
  }
  /** Replace the rule for (tool, scope, project); decision `ask` with `remove:true` deletes it. */
  setPermission(input = {}) {
    return this.serial(async () => {
      const rule = normalizeRule(input);
      const data = await this.load();
      data.permissions = data.permissions.filter(
        (r) => !(r.tool === rule.tool && r.scope === rule.scope && r.project === rule.project),
      );
      if (input.remove !== true) {
        if (data.permissions.length >= MAX_RULES) throw Error("Too many rules");
        data.permissions.push(rule);
      }
      await this.save();
      return { permissions: data.permissions.map((r) => ({ ...r })) };
    });
  }

  /**
   * Everything one run needs: enabled servers for this agent and project, and the effective permission rules
   * (project rules override global ones for the same tool).
   */
  async forRun(agent, { projects = [] } = {}) {
    const data = await this.load();
    const list = projects.filter(Boolean);
    const servers = data.servers.filter(
      (s) => s.enabled && s.agents.includes(agent) && inProject(s, list),
    );
    // A project server shadows a global one with the same name.
    const byName = new Map();
    for (const s of servers)
      if (!byName.has(s.name) || s.scope === "project") byName.set(s.name, s);
    const rules = new Map();
    for (const r of data.permissions.filter((r) => inProject(r, list)))
      if (!rules.has(r.tool) || r.scope === "project") rules.set(r.tool, r);
    return {
      servers: [...byName.values()].map((s) => ({ ...s, env: { ...s.env } })),
      permissions: [...rules.values()],
    };
  }
}

/** Claude Agent SDK mcpServers entries. */
function claudeServers(servers) {
  const out = {};
  for (const s of servers) {
    out[s.name] =
      s.transport === "http"
        ? {
            type: "http",
            url: s.url,
            ...(s.tokenEnv && process.env[s.tokenEnv]
              ? { headers: { Authorization: `Bearer ${process.env[s.tokenEnv]}` } }
              : {}),
          }
        : { type: "stdio", command: s.command, args: s.args || [], env: { ...s.env } };
  }
  return out;
}

const tomlString = (value) => JSON.stringify(String(value));
/**
 * Codex `-c` overrides and the extra child environment. Values of stdio env vars travel in the environment,
 * their names in `env_vars`. Two servers using the same variable name with different values cannot both run;
 * the later one is skipped and reported in `skipped`.
 */
function codexServerArgs(servers) {
  const args = [],
    env = {},
    skipped = [];
  for (const s of servers) {
    const key = `mcp_servers.${s.name}`;
    if (s.transport === "http") {
      args.push("-c", `${key}.url=${tomlString(s.url)}`);
      if (s.tokenEnv) args.push("-c", `${key}.bearer_token_env_var=${tomlString(s.tokenEnv)}`);
      continue;
    }
    const names = Object.keys(s.env || {});
    if (names.some((n) => Object.hasOwn(env, n) && env[n] !== s.env[n])) {
      skipped.push(s.name);
      continue;
    }
    for (const n of names) env[n] = s.env[n];
    args.push(
      "-c",
      `${key}.command=${tomlString(s.command)}`,
      "-c",
      `${key}.args=[${(s.args || []).map(tomlString).join(",")}]`,
    );
    if (names.length) args.push("-c", `${key}.env_vars=[${names.map(tomlString).join(",")}]`);
  }
  return { args, env, skipped };
}

/** allowedTools / disallowedTools for Claude from the effective rules. */
function claudePermissionLists(rules) {
  return {
    allowed: rules.filter((r) => r.decision === "allow").map((r) => r.tool),
    denied: rules.filter((r) => r.decision === "deny").map((r) => r.tool),
  };
}

/** First matching rule decision for a tool, preferring exact names over prefixes; null when none. */
function decisionFor(rules, toolName) {
  const hits = rules.filter((r) => toolMatches(r.tool, toolName));
  if (!hits.length) return null;
  hits.sort(
    (a, b) =>
      (a.tool.endsWith("*") ? 1 : 0) - (b.tool.endsWith("*") ? 1 : 0) ||
      b.tool.length - a.tool.length,
  );
  return hits[0].decision;
}

function registerAgentToolConfig(handle, { userData, store = null } = {}) {
  const config = store || new AgentToolConfig({ userData });
  handle("agentToolConfigList", () => config.list());
  handle("agentToolConfigSaveServer", (options) => config.saveServer(options || {}));
  handle("agentToolConfigSetEnabled", (options) => config.setServerEnabled(options || {}));
  handle("agentToolConfigRemoveServer", (options) => config.removeServer(options || {}));
  handle("agentToolConfigSetPermission", (options) => config.setPermission(options || {}));
  return config;
}

module.exports = {
  AgentToolConfig,
  registerAgentToolConfig,
  normalizeServer,
  normalizeRule,
  toolMatches,
  claudeServers,
  codexServerArgs,
  claudePermissionLists,
  decisionFor,
};

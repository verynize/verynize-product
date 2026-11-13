// Settings › Agents: provider account details, the agents' own MCP servers ("Tools") and the Access switches.
//
// Accounts: `claude auth status --json` (+ ~/.claude.json oauthAccount) and ~/.codex/auth.json id_token claims.
//   Only display claims (email, organization, plan) are read; tokens are never returned or logged.
// Tools: Claude Code user-scope servers (~/.claude.json mcpServers, ~/.claude/settings.json mcpServers) and Codex
//   `[mcp_servers.*]` tables in ~/.codex/config.toml. Status comes from `claude mcp list` / `codex mcp list --json`.
//   Add / remove / sign-in go through `claude mcp …` / `codex mcp …`; without the CLI the config file is edited in place.
// Access: desktop/agent-access.cjs (userData/agent-access.json), read by agent-runtime.cjs when a chat's agent starts.
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { spawn } = require("node:child_process");
const agentAccess = require("./agent-access.cjs");

const MCP_AGENTS = ["claude", "codex"];
const NAME = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$/;

// --- process helpers ----------------------------------------------------------------------------
function searchDirs(home = os.homedir()) {
  return [
    ...(process.env.PATH || "").split(path.delimiter),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    path.join(home, ".local/bin"),
    path.join(home, ".opencode/bin"),
    path.join(home, "bin"),
  ].filter((dir) => dir && path.isAbsolute(dir));
}
async function findExecutable(name, home) {
  for (const dir of searchDirs(home)) {
    const candidate = path.join(dir, name);
    try {
      await fs.access(candidate, 1);
      return candidate;
    } catch {}
  }
  return null;
}
function childEnv(home) {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  if (home) env.HOME = home;
  return env;
}
function kill(child, signal) {
  try {
    if (process.platform === "win32") child.kill(signal);
    else process.kill(-child.pid, signal);
  } catch {}
}
/** Run a CLI with a timeout and an output cap. Resolves {code, stdout, stderr}; never rejects. */
function runCli(
  executable,
  args,
  { timeout = 30000, limit = 512 * 1024, home, cwd, spawnProcess = spawn } = {},
) {
  return new Promise((resolve) => {
    let stdout = "",
      stderr = "",
      done = false,
      child;
    const finish = (result) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(result);
    };
    try {
      child = spawnProcess(executable, args, {
        cwd: cwd || os.tmpdir(),
        env: childEnv(home),
        stdio: ["ignore", "pipe", "pipe"],
        detached: process.platform !== "win32",
      });
    } catch (error) {
      resolve({ code: -1, stdout: "", stderr: error.message });
      return;
    }
    const timer = setTimeout(() => {
      kill(child, "SIGTERM");
      setTimeout(() => kill(child, "SIGKILL"), 1500).unref?.();
      finish({ code: -1, stdout, stderr: stderr + "\nTimed out", timedOut: true });
    }, timeout);
    child.stdout?.on("data", (d) => {
      if (stdout.length < limit) stdout += d;
    });
    child.stderr?.on("data", (d) => {
      if (stderr.length < 64 * 1024) stderr += d;
    });
    child.on("error", (error) => finish({ code: -1, stdout, stderr: error.message }));
    child.on("close", (code) => finish({ code, stdout, stderr }));
  });
}
const firstLine = (text) =>
  String(text || "")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(-1)[0]
    ?.slice(0, 300) || "";
// Credentials in CLI output (bearer tokens, keys in URLs) never reach the renderer.
const redact = (text) =>
  String(text || "")
    .replace(/(bearer\s+)[^\s"']+/gi, "$1…")
    .replace(/([?&](?:key|token|api_key|access_token)=)[^&\s]+/gi, "$1…");

async function readJson(file) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    return null;
  }
}
async function writeFileAtomic(file, text) {
  const temp = `${file}.verynize-${process.pid}.tmp`;
  let mode = 0o600;
  try {
    mode = (await fs.stat(file)).mode & 0o777;
  } catch {}
  await fs.writeFile(temp, text, { mode });
  await fs.rename(temp, file);
}

// --- accounts -----------------------------------------------------------------------------------
const titleCase = (value) =>
  String(value || "")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
function claudePlan({ subscriptionType, authMethod } = {}) {
  if (authMethod === "api_key" || authMethod === "api_key_helper") return "API key";
  if (authMethod === "third_party") return "Cloud provider";
  if (subscriptionType) return `Claude ${titleCase(subscriptionType)} subscription`;
  return "Claude subscription";
}
const CHATGPT_PLANS = {
  free: "ChatGPT Free",
  plus: "ChatGPT Plus",
  pro: "ChatGPT Pro",
  team: "ChatGPT Business",
  business: "ChatGPT Business",
  enterprise: "ChatGPT Enterprise",
  edu: "ChatGPT Edu",
  go: "ChatGPT Go",
};
const chatgptPlan = (plan) =>
  plan ? CHATGPT_PLANS[String(plan).toLowerCase()] || `ChatGPT ${titleCase(plan)}` : "ChatGPT";

/** Decode a JWT payload without verifying it (display claims only). */
function jwtClaims(token) {
  if (typeof token !== "string") return null;
  const part = token.split(".")[1];
  if (!part || part.length > 64 * 1024) return null;
  try {
    return JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

/** Codex account from ~/.codex/auth.json: {email, plan, method} or null. Tokens never leave this function. */
function codexAccountFromAuth(auth) {
  if (!auth || typeof auth !== "object") return null;
  const claims = jwtClaims(auth.tokens?.id_token);
  if (claims) {
    const info = claims["https://api.openai.com/auth"] || {};
    const org = Array.isArray(info.organizations)
      ? info.organizations.find((o) => o?.is_default) || info.organizations[0]
      : null;
    return {
      email: typeof claims.email === "string" ? claims.email : "",
      organization:
        typeof org?.title === "string" && !/^personal$/i.test(org.title) ? org.title : "",
      plan: chatgptPlan(info.chatgpt_plan_type),
      method: "ChatGPT",
    };
  }
  if (auth.OPENAI_API_KEY || auth.auth_mode === "apikey")
    return { email: "", organization: "", plan: "API key", method: "API key" };
  return null;
}

/** Codex account from app-server `account/read`: {email, organization, plan, method}, or null when signed out. */
function codexAccountFromRead(result) {
  const account = result?.account;
  if (!account || typeof account !== "object") return null;
  if (account.type === "chatgpt") {
    const workspace =
      typeof account.workspaceName === "string" && !/^personal$/i.test(account.workspaceName)
        ? account.workspaceName
        : "";
    return {
      email: typeof account.email === "string" ? account.email : "",
      organization: workspace,
      plan: chatgptPlan(account.planType === "unknown" ? "" : account.planType),
      method: "ChatGPT",
    };
  }
  if (account.type === "apiKey")
    return { email: "", organization: "", plan: "API key", method: "API key" };
  return {
    email: "",
    organization: "",
    plan: typeof account.type === "string" ? titleCase(account.type) : "CLI account",
    method: "CLI account",
  };
}

/**
 * Display account of a Codex home: `account/read` first (works with keyring credential storage and future formats),
 * then the auth.json id_token claims as a fallback for CLIs without app-server.
 */
async function codexAccount({
  executable,
  codexHome,
  spawnProcess,
  readAccount = (options) => require("./agent-usage.cjs").readCodexAccount(options),
} = {}) {
  if (executable) {
    try {
      const account = codexAccountFromRead(
        await readAccount({
          executable,
          env: codexHome ? { CODEX_HOME: codexHome } : {},
          ...(spawnProcess ? { spawnProcess } : {}),
        }),
      );
      if (account) return account;
    } catch {}
  }
  return codexHome ? codexAccountFromAuth(await readJson(path.join(codexHome, "auth.json"))) : null;
}

/** Claude account from `claude auth status --json` output and/or ~/.claude.json. */
function claudeAccountFrom(status, config) {
  const oauth = config?.oauthAccount || {};
  const email =
    (typeof status?.email === "string" && status.email) ||
    (typeof oauth.emailAddress === "string" ? oauth.emailAddress : "");
  const organization =
    (typeof status?.orgName === "string" && status.orgName) ||
    (typeof oauth.organizationName === "string" ? oauth.organizationName : "");
  if (!email && !organization && !status?.loggedIn) return null;
  const method = status?.authMethod || (email ? "claude.ai" : "");
  return {
    email,
    organization: organization.endsWith("'s Organization") ? "" : organization,
    plan: claudePlan({ subscriptionType: status?.subscriptionType, authMethod: method }),
    method,
  };
}

async function providerAccounts({
  home = os.homedir(),
  discover,
  lookup = findExecutable,
  spawnProcess,
  siwc = null,
} = {}) {
  const exec = {
    claude: await lookup("claude", home),
    codex: await lookup("codex", home),
    opencode: await lookup("opencode", home),
    cursor: await lookup("cursor-agent", home),
  };
  if (discover)
    for (const item of await discover().catch(() => []))
      if (item?.available && item.path && Object.hasOwn(exec, item.id)) exec[item.id] = item.path;
  const claude = (async () => {
    const entry = {
      id: "claude",
      name: "Claude Code",
      installed: !!exec.claude,
      loggedIn: false,
      accounts: [],
      hint: "This computer's Claude login. Your terminal and other Claude apps use it too.",
    };
    if (!exec.claude) return entry;
    let status = null;
    const result = await runCli(exec.claude, ["auth", "status", "--json"], {
      timeout: 15000,
      home,
      spawnProcess,
    });
    try {
      status = JSON.parse(result.stdout);
    } catch {}
    entry.loggedIn = status ? status.loggedIn === true : result.code === 0;
    if (entry.loggedIn) {
      const account = claudeAccountFrom(status, await readJson(path.join(home, ".claude.json")));
      if (account) entry.accounts.push({ ...account, default: true });
    }
    return entry;
  })();
  const codex = (async () => {
    const entry = {
      id: "codex",
      name: "Codex",
      installed: !!exec.codex,
      loggedIn: false,
      accounts: [],
      hint: "This computer's Codex login. Your terminal and the Codex app use it too.",
    };
    if (!exec.codex) return entry;
    if (siwc) {
      const status = await siwc.status();
      entry.loggedIn = status.loggedIn;
      entry.hint =
        "Your ChatGPT connection for Verynize. Tokens stay on this Mac; your terminal login is separate.";
      if (status.loggedIn)
        entry.accounts.push({
          email: status.email,
          plan: status.plan,
          method: status.method,
          default: true,
        });
      return entry;
    }
    const result = await runCli(exec.codex, ["login", "status"], {
      timeout: 15000,
      home,
      spawnProcess,
    });
    entry.loggedIn = result.code === 0 && !/not logged in/i.test(result.stdout + result.stderr);
    if (entry.loggedIn) {
      const account = await codexAccount({
        executable: exec.codex,
        codexHome: process.env.CODEX_HOME || path.join(home, ".codex"),
        spawnProcess,
      });
      entry.accounts.push({
        ...(account || {
          email: "",
          organization: "",
          plan: /API key/i.test(result.stdout + result.stderr) ? "API key" : "ChatGPT",
          method: "CLI account",
        }),
        default: true,
      });
    }
    return entry;
  })();
  return [
    await claude,
    await codex,
    {
      id: "cursor",
      name: "Cursor",
      installed: !!exec.cursor,
      comingSoon: true,
      loggedIn: false,
      accounts: [],
    },
    {
      id: "opencode",
      name: "OpenCode",
      installed: !!exec.opencode,
      comingSoon: true,
      loggedIn: false,
      accounts: [],
    },
  ];
}

// --- minimal TOML reader (enough for ~/.codex/config.toml mcp_servers tables) --------------------
function splitKey(text) {
  const parts = [];
  let i = 0;
  const s = text.trim();
  while (i < s.length) {
    while (s[i] === " " || s[i] === "\t") i++;
    if (s[i] === '"' || s[i] === "'") {
      const quote = s[i];
      let j = i + 1,
        out = "";
      while (j < s.length && s[j] !== quote) {
        if (quote === '"' && s[j] === "\\") {
          out += s[j + 1];
          j += 2;
          continue;
        }
        out += s[j++];
      }
      parts.push(out);
      i = j + 1;
    } else {
      let j = i;
      while (j < s.length && s[j] !== "." && s[j] !== " " && s[j] !== "\t") j++;
      parts.push(s.slice(i, j));
      i = j;
    }
    while (s[i] === " " || s[i] === "\t") i++;
    if (s[i] === ".") i++;
  }
  return parts;
}
/** Parse one TOML value starting at s[i]; returns [value, nextIndex]. Unknown forms become undefined. */
function parseValue(s, i) {
  const ws = () => {
    for (;;) {
      while (/\s/.test(s[i] || "")) i++;
      if (s[i] === "#") {
        while (i < s.length && s[i] !== "\n") i++;
        continue;
      }
      break;
    }
  };
  ws();
  const c = s[i];
  if (c === '"' && s.startsWith('"""', i)) {
    const end = s.indexOf('"""', i + 3);
    return [
      s.slice(i + 3, end < 0 ? s.length : end).replace(/^\n/, ""),
      end < 0 ? s.length : end + 3,
    ];
  }
  if (c === "'" && s.startsWith("'''", i)) {
    const end = s.indexOf("'''", i + 3);
    return [
      s.slice(i + 3, end < 0 ? s.length : end).replace(/^\n/, ""),
      end < 0 ? s.length : end + 3,
    ];
  }
  if (c === '"') {
    let j = i + 1;
    while (j < s.length && s[j] !== '"' && s[j] !== "\n") j += s[j] === "\\" ? 2 : 1;
    let value;
    try {
      value = JSON.parse(s.slice(i, j + 1));
    } catch {
      value = s.slice(i + 1, j);
    }
    return [value, j + 1];
  }
  if (c === "'") {
    const end = s.indexOf("'", i + 1);
    return [s.slice(i + 1, end), end + 1];
  }
  if (c === "[") {
    const out = [];
    i++;
    for (;;) {
      ws();
      if (s[i] === "]" || i >= s.length) return [out, i + 1];
      const [v, n] = parseValue(s, i);
      out.push(v);
      i = n;
      ws();
      if (s[i] === ",") i++;
    }
  }
  if (c === "{") {
    const out = {};
    i++;
    for (;;) {
      ws();
      if (s[i] === "}" || i >= s.length) return [out, i + 1];
      const eq = s.indexOf("=", i);
      if (eq < 0) return [out, s.length];
      const key = splitKey(s.slice(i, eq));
      const [v, n] = parseValue(s, eq + 1);
      let target = out;
      for (const k of key.slice(0, -1))
        target = target[k] = target[k] && typeof target[k] === "object" ? target[k] : {};
      target[key[key.length - 1]] = v;
      i = n;
      ws();
      if (s[i] === ",") i++;
    }
  }
  const m = /^[^,\]}\n#]+/.exec(s.slice(i));
  const raw = (m ? m[0] : "").trim();
  const value =
    raw === "true"
      ? true
      : raw === "false"
        ? false
        : /^[+-]?\d[\d_]*(\.\d+)?$/.test(raw)
          ? Number(raw.replace(/_/g, ""))
          : undefined;
  return [value, i + (m ? m[0].length : 0)];
}
/** Tables of a TOML document as {headerPath: {key: value}}; enough for config.toml, not a full TOML parser. */
function parseToml(text) {
  const tables = new Map();
  let current = [];
  let i = 0;
  const s = String(text || "");
  tables.set("", { path: [], values: {} });
  while (i < s.length) {
    const lineEnd = s.indexOf("\n", i) < 0 ? s.length : s.indexOf("\n", i);
    const line = s.slice(i, lineEnd).trim();
    if (!line || line.startsWith("#")) {
      i = lineEnd + 1;
      continue;
    }
    if (line.startsWith("[")) {
      const header = line
        .replace(/#.*$/, "")
        .trim()
        .replace(/^\[\[?|\]\]?$/g, "");
      current = splitKey(header);
      const key = JSON.stringify(current);
      if (!tables.has(key)) tables.set(key, { path: current, values: {} });
      i = lineEnd + 1;
      continue;
    }
    const eq = s.indexOf("=", i);
    if (eq < 0 || eq > lineEnd) {
      i = lineEnd + 1;
      continue;
    }
    const key = splitKey(s.slice(i, eq));
    const [value, next] = parseValue(s, eq + 1);
    const table = tables.get(JSON.stringify(current)) || tables.get("");
    let target = table.values;
    for (const k of key.slice(0, -1))
      target = target[k] = target[k] && typeof target[k] === "object" ? target[k] : {};
    target[key[key.length - 1]] = value;
    const after = s.indexOf("\n", next);
    i = after < 0 ? s.length : after + 1;
  }
  return [...tables.values()];
}

// --- MCP config readers --------------------------------------------------------------------------
function describeServer(name, config = {}, extra = {}) {
  const url = typeof config.url === "string" ? config.url : "";
  const type =
    config.type === "sse"
      ? "sse"
      : url || config.type === "http" || config.type === "streamable_http"
        ? "http"
        : "stdio";
  const command = typeof config.command === "string" ? config.command : "";
  const args = Array.isArray(config.args) ? config.args.filter((a) => typeof a === "string") : [];
  return {
    name,
    transport: type,
    url: redact(url),
    command,
    args: args.map(redact),
    target: redact(type === "stdio" ? [command, ...args].join(" ").trim() : url),
    enabled: config.enabled !== false && config.disabled !== true,
    status: config.enabled === false || config.disabled === true ? "disabled" : "unknown",
    ...extra,
  };
}

/** Claude Code servers configured for the user (not per-project): ~/.claude.json and ~/.claude/settings.json. */
async function claudeConfiguredServers(home = os.homedir()) {
  const out = new Map();
  const config = await readJson(path.join(home, ".claude.json"));
  for (const [name, server] of Object.entries(config?.mcpServers || {}))
    if (server && typeof server === "object")
      out.set(name, describeServer(name, server, { scope: "user", source: "~/.claude.json" }));
  const userSettings = await readJson(path.join(home, ".claude", "settings.json"));
  for (const [name, server] of Object.entries(userSettings?.mcpServers || {}))
    if (!out.has(name) && server && typeof server === "object")
      out.set(
        name,
        describeServer(name, server, {
          scope: "settings",
          source: "~/.claude/settings.json",
          removable: false,
        }),
      );
  return [...out.values()];
}

const codexHome = (home) =>
  process.env.CODEX_HOME && home === os.homedir()
    ? process.env.CODEX_HOME
    : path.join(home, ".codex");
async function codexConfiguredServers(home = os.homedir()) {
  let text = "";
  try {
    text = await fs.readFile(path.join(codexHome(home), "config.toml"), "utf8");
  } catch {
    return [];
  }
  return parseToml(text)
    .filter((t) => t.path.length === 2 && t.path[0] === "mcp_servers")
    .map((t) =>
      describeServer(t.path[1], t.values, { scope: "user", source: "~/.codex/config.toml" }),
    );
}

// --- CLI status parsers ---------------------------------------------------------------------------
/** `claude mcp list` lines → Map(name → {status, detail}). Skips claude.ai connectors (governed by Access). */
function parseClaudeMcpList(text) {
  const out = new Map();
  for (const line of String(text || "").split("\n")) {
    const m = /^(.+?): (.*) - ([✔✓!✗✘⏸])\s*(.*)$/u.exec(line.trim());
    if (!m || m[1].startsWith("claude.ai ")) continue;
    const [, name, , mark, detail] = m;
    const status =
      mark === "✔" || mark === "✓"
        ? "connected"
        : mark === "!" && /auth/i.test(detail)
          ? "needs-auth"
          : mark === "⏸"
            ? "pending"
            : /disabled/i.test(detail)
              ? "disabled"
              : "error";
    out.set(name, { status, detail: detail.trim() });
  }
  return out;
}
/** `codex mcp list --json` → Map(name → {status, detail, server}). */
function parseCodexMcpList(text) {
  const out = new Map();
  let list;
  try {
    list = JSON.parse(text);
  } catch {
    return out;
  }
  if (!Array.isArray(list)) return out;
  for (const item of list) {
    if (!item || typeof item.name !== "string") continue;
    const transport = item.transport || {};
    const status =
      item.enabled === false
        ? "disabled"
        : item.auth_status === "not_logged_in"
          ? "needs-auth"
          : "connected";
    out.set(item.name, {
      status,
      detail:
        item.enabled === false
          ? item.disabled_reason || "Disabled in config.toml"
          : item.auth_status === "o_auth"
            ? "Signed in"
            : "",
      server: describeServer(
        item.name,
        { ...transport, url: transport.url, type: transport.type, enabled: item.enabled },
        { scope: "user", source: "~/.codex/config.toml" },
      ),
    });
  }
  return out;
}

async function commandExists(command, home) {
  if (!command) return false;
  if (path.isAbsolute(command)) {
    try {
      await fs.access(command, 1);
      return true;
    } catch {
      return false;
    }
  }
  if (command.includes("/")) return true; // relative to the server's cwd; cannot check here
  return !!(await findExecutable(command, home));
}

class AgentTools {
  constructor({
    home = os.homedir(),
    discover = null,
    lookup = findExecutable,
    spawnProcess = spawn,
    userData,
    getRuntime = () => null,
    siwc = null,
  } = {}) {
    this.siwc = siwc;
    Object.assign(this, { home, discover, lookup, spawnProcess, userData, getRuntime });
    this.logins = new Map();
  }
  async executable(agent) {
    if (this.discover) {
      const found = (await this.discover().catch(() => [])).find(
        (a) => a.id === agent && a.available,
      );
      if (found?.path) return found.path;
    }
    return this.lookup(agent, this.home);
  }
  cli(agent, executable, args, options = {}) {
    return runCli(executable, args, {
      home: this.home === os.homedir() ? undefined : this.home,
      spawnProcess: this.spawnProcess,
      ...options,
    });
  }

  accounts() {
    return providerAccounts({
      home: this.home,
      discover: this.discover,
      lookup: this.lookup,
      spawnProcess: this.spawnProcess,
      siwc: this.siwc,
    });
  }

  /** {agent, installed, servers, checked, error?}. `check` asks the CLI for live status (slower). */
  async listServers({ agent, check = false } = {}) {
    if (!MCP_AGENTS.includes(agent)) throw Error("Choose Claude Code or Codex");
    const executable = await this.executable(agent);
    const servers =
      agent === "claude"
        ? await claudeConfiguredServers(this.home)
        : await codexConfiguredServers(this.home);
    const byName = new Map(servers.map((s) => [s.name, s]));
    let checked = false,
      error = "";
    if (check && executable) {
      const result =
        agent === "claude"
          ? await this.cli(agent, executable, ["mcp", "list"], { timeout: 90000 })
          : await this.cli(agent, executable, ["mcp", "list", "--json"], { timeout: 30000 });
      const statuses =
        agent === "claude" ? parseClaudeMcpList(result.stdout) : parseCodexMcpList(result.stdout);
      if (result.code === 0 || statuses.size) {
        checked = true;
        for (const [name, info] of statuses) {
          const server = byName.get(name) || (info.server ? { ...info.server } : null);
          if (!server) continue;
          if (!byName.has(name)) {
            byName.set(name, server);
            servers.push(server);
          }
          server.status = info.status;
          server.detail = info.detail;
        }
      } else
        error = redact(firstLine(result.stderr || result.stdout)) || "Could not check the servers";
      if (agent === "codex") {
        for (const server of servers)
          if (
            server.status === "connected" &&
            server.transport === "stdio" &&
            !(await commandExists(server.command, this.home))
          ) {
            server.status = "error";
            server.detail = `Command not found: ${server.command}`;
          }
      }
    }
    return {
      agent,
      installed: !!executable,
      servers: servers.map((s) => ({ removable: true, ...s })),
      checked,
      ...(error ? { error } : {}),
    };
  }

  validateServer(options) {
    const { agent, name, transport } = options || {};
    if (!MCP_AGENTS.includes(agent)) throw Error("Choose Claude Code or Codex");
    if (typeof name !== "string" || !NAME.test(name))
      throw Error("Use a tool name with letters, numbers, dots, dashes or underscores");
    if (transport === "http") {
      let url;
      try {
        url = new URL(options.url);
      } catch {
        throw Error("Enter a valid server URL");
      }
      if (!["http:", "https:"].includes(url.protocol) || url.username || url.password)
        throw Error("Use an HTTP or HTTPS URL without credentials");
      return { agent, name, transport, url: url.href };
    }
    if (transport !== "stdio") throw Error("Choose a command or a URL");
    const command = typeof options.command === "string" ? options.command.trim() : "";
    if (!command || command.length > 1000) throw Error("Enter the command that starts the server");
    const args = Array.isArray(options.args) ? options.args : [];
    if (args.length > 64 || args.some((a) => typeof a !== "string" || a.length > 2000))
      throw Error("Too many or too long arguments");
    const env = {};
    for (const [key, value] of Object.entries(
      options.env && typeof options.env === "object" ? options.env : {},
    )) {
      if (
        !/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(key) ||
        typeof value !== "string" ||
        value.length > 4000
      )
        throw Error("Invalid environment variable");
      env[key] = value;
    }
    return { agent, name, transport, command, args, env };
  }

  async addServer(options) {
    const server = this.validateServer(options);
    const existing = await this.listServers({ agent: server.agent });
    if (existing.servers.some((s) => s.name === server.name))
      throw Error(`A tool named ${server.name} already exists`);
    const executable = await this.executable(server.agent);
    if (executable) {
      let args;
      if (server.agent === "claude") {
        args =
          server.transport === "http"
            ? ["mcp", "add", "--scope", "user", "--transport", "http", server.name, server.url]
            : [
                "mcp",
                "add",
                "--scope",
                "user",
                ...Object.entries(server.env).flatMap(([k, v]) => ["-e", `${k}=${v}`]),
                server.name,
                "--",
                server.command,
                ...server.args,
              ];
      } else {
        args =
          server.transport === "http"
            ? ["mcp", "add", server.name, "--url", server.url]
            : [
                "mcp",
                "add",
                server.name,
                ...Object.entries(server.env).flatMap(([k, v]) => ["--env", `${k}=${v}`]),
                "--",
                server.command,
                ...server.args,
              ];
      }
      const result = await this.cli(server.agent, executable, args, { timeout: 60000 });
      if (result.code !== 0)
        throw Error(
          redact(firstLine(result.stderr || result.stdout)) ||
            "The agent CLI could not add the tool",
        );
      return { added: true, via: "cli" };
    }
    await (server.agent === "claude"
      ? this.editClaudeConfig((config) => {
          config.mcpServers = {
            ...config.mcpServers,
            [server.name]:
              server.transport === "http"
                ? { type: "http", url: server.url }
                : { type: "stdio", command: server.command, args: server.args, env: server.env },
          };
        })
      : this.appendCodexServer(server));
    return { added: true, via: "config" };
  }

  async removeServer({ agent, name } = {}) {
    if (!MCP_AGENTS.includes(agent)) throw Error("Choose Claude Code or Codex");
    if (typeof name !== "string" || name.length > 200) throw Error("Choose a tool");
    const { servers } = await this.listServers({ agent });
    const server = servers.find((s) => s.name === name);
    if (!server) throw Error(`${name} is not configured`);
    if (server.removable === false)
      throw Error(`${name} comes from ${server.source}; remove it there`);
    const executable = await this.executable(agent);
    if (executable) {
      const result = await this.cli(
        agent,
        executable,
        agent === "claude" ? ["mcp", "remove", "--scope", "user", name] : ["mcp", "remove", name],
        { timeout: 30000 },
      );
      if (result.code !== 0)
        throw Error(
          redact(firstLine(result.stderr || result.stdout)) ||
            "The agent CLI could not remove the tool",
        );
      return { removed: true, via: "cli" };
    }
    if (agent === "claude")
      await this.editClaudeConfig((config) => {
        if (config.mcpServers) delete config.mcpServers[name];
      });
    else await this.removeCodexServer(name);
    return { removed: true, via: "config" };
  }

  /** Start the agent's own OAuth flow for one server (opens the browser). Resolves when it finishes. */
  async loginServer({ agent, name } = {}) {
    if (!MCP_AGENTS.includes(agent)) throw Error("Choose Claude Code or Codex");
    if (typeof name !== "string" || !name || name.length > 200) throw Error("Choose a tool");
    const key = `${agent}:${name}`;
    if (this.logins.has(key)) return this.logins.get(key);
    const executable = await this.executable(agent);
    if (!executable)
      throw Error(`${agent === "claude" ? "Claude Code" : "Codex"} is not installed`);
    const promise = this.cli(agent, executable, ["mcp", "login", name], { timeout: 5 * 60 * 1000 })
      .then((result) => {
        if (result.code !== 0)
          throw Error(
            redact(firstLine(result.stderr || result.stdout)) || "Sign-in did not complete",
          );
        return { signedIn: true };
      })
      .finally(() => this.logins.delete(key));
    this.logins.set(key, promise);
    return promise;
  }

  // --- config-file fallbacks (used only without the CLI) ---------------------------------------
  async editClaudeConfig(change) {
    const file = path.join(this.home, ".claude.json");
    let config = {};
    try {
      config = JSON.parse(await fs.readFile(file, "utf8"));
    } catch (error) {
      if (error.code !== "ENOENT")
        throw Error("~/.claude.json could not be read; fix it with Claude Code first");
    }
    change(config);
    await writeFileAtomic(file, JSON.stringify(config, null, 2) + "\n");
  }
  async appendCodexServer(server) {
    const dir = codexHome(this.home),
      file = path.join(dir, "config.toml");
    let text = "";
    try {
      text = await fs.readFile(file, "utf8");
    } catch {}
    const q = (value) => JSON.stringify(value);
    const lines = [`[mcp_servers.${q(server.name)}]`];
    if (server.transport === "http") lines.push(`url = ${q(server.url)}`);
    else {
      lines.push(`command = ${q(server.command)}`, `args = [${server.args.map(q).join(", ")}]`);
      if (Object.keys(server.env).length)
        lines.push(
          `env = { ${Object.entries(server.env)
            .map(([k, v]) => `${k} = ${q(v)}`)
            .join(", ")} }`,
        );
    }
    await fs.mkdir(dir, { recursive: true });
    await writeFileAtomic(
      file,
      (text && !text.endsWith("\n") ? text + "\n" : text) +
        (text ? "\n" : "") +
        lines.join("\n") +
        "\n",
    );
  }
  async removeCodexServer(name) {
    const file = path.join(codexHome(this.home), "config.toml");
    const text = await fs.readFile(file, "utf8");
    const out = [];
    let skipping = false;
    for (const line of text.split("\n")) {
      const header = /^\s*\[\[?([^\]]+)\]\]?\s*(#.*)?$/.exec(line);
      if (header) {
        const key = splitKey(header[1]);
        skipping = key[0] === "mcp_servers" && key[1] === name;
      }
      if (!skipping) out.push(line);
    }
    await writeFileAtomic(file, out.join("\n").replace(/\n{3,}/g, "\n\n"));
  }

  // --- access -------------------------------------------------------------------------------------
  async getAccess() {
    const settings = await agentAccess.loadAccessSettings(this.userData);
    return this.siwc ? { ...settings, codexApps: false, codexComputerUse: false } : settings;
  }
  async setAccess(changes) {
    if (this.siwc) changes = { ...changes, codexApps: false, codexComputerUse: false };
    const { previous, settings } = await agentAccess.saveAccessSettings(this.userData, changes);
    let stopped = [];
    if (previous.codexComputerUse && !settings.codexComputerUse)
      stopped = this.getRuntime()?.stopComputerUse?.() || [];
    return { settings, stopped: stopped.length };
  }
}

function registerAgentTools(handle, win, { userData, getRuntime = () => null, siwc = null } = {}) {
  const tools = new AgentTools({ userData, getRuntime, siwc });
  handle("agentProviderAccounts", () => tools.accounts());
  handle("agentMcpList", (options) => tools.listServers(options || {}));
  handle("agentMcpAdd", (options) => tools.addServer(options || {}));
  handle("agentMcpRemove", (options) => tools.removeServer(options || {}));
  handle("agentMcpLogin", (options) => tools.loginServer(options || {}));
  handle("agentAccessGet", () => tools.getAccess());
  handle("agentAccessSet", (changes) => tools.setAccess(changes));
  return tools;
}

module.exports = {
  AgentTools,
  registerAgentTools,
  providerAccounts,
  codexAccountFromAuth,
  codexAccountFromRead,
  codexAccount,
  claudeAccountFrom,
  claudePlan,
  chatgptPlan,
  jwtClaims,
  parseToml,
  claudeConfiguredServers,
  codexConfiguredServers,
  parseClaudeMcpList,
  parseCodexMcpList,
  runCli,
  findExecutable,
  redact,
};

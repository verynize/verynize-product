// Option normalization shared by the session runtime (desktop/agent-runtime.cjs)
// and the one-shot CLI fallback (desktop/agents.cjs).
//
// Access levels follow the four-level model documented in docs/wonder-ai-mcp-spec.md §2.5:
//   ask  -> every edit and command needs approval
//   edit -> file edits auto-approved, other tools ask
//   auto -> the provider's reviewer approves actions
//   full -> everything runs without asking
const ACCESS_LEVELS = ["ask", "edit", "auto", "full"];
const LEGACY_ACCESS = { "read-only": "ask", "workspace-write": "edit" };
const EFFORT = new Set(["", "low", "medium", "high", "xhigh", "max"]);
const AGENTS = ["codex", "claude"];

function normalizeAccess(value) {
  const access = LEGACY_ACCESS[value] || value || "edit";
  if (!ACCESS_LEVELS.includes(access)) throw Error("Choose Ask, Edit, Auto, or Full access");
  return access;
}

function normalizeOptions(options = {}) {
  const model = options.model || "",
    effort = options.effort || "";
  if (typeof model !== "string" || model.length > 160 || !/^[a-zA-Z0-9._:/[\]-]*$/.test(model))
    throw Error("Invalid model name");
  if (!EFFORT.has(effort)) throw Error("Invalid effort level");
  const sessionId = options.sessionId || "";
  if (
    typeof sessionId !== "string" ||
    sessionId.length > 200 ||
    !/^[a-zA-Z0-9._:-]*$/.test(sessionId)
  )
    throw Error("Invalid session id");
  return {
    model,
    access: normalizeAccess(options.access),
    effort,
    structured: options.structured === true,
    sessionId,
  };
}

// Design defaults used when the user has not chosen a model / effort. Claude defaults to Opus 5.5 at
// high effort (the recommended design model). Codex keeps the CLI's own default model unless a
// model id is configured (here or via VERYNIZE_DEFAULT_CODEX_MODEL). Override per run by
// passing model/effort, globally with VERYNIZE_DEFAULT_<AGENT>_MODEL / _EFFORT (set to an empty
// string to disable a default), or skip defaults entirely with options.useDefaults === false.
const DESIGN_DEFAULTS = Object.freeze({
  claude: Object.freeze({ model: "claude-opus-5-5", effort: "high" }),
  codex: Object.freeze({ model: "", effort: "" }),
});

function defaultsFor(agent, env = process.env) {
  if (!AGENTS.includes(agent)) throw Error("Unknown local agent");
  const base = DESIGN_DEFAULTS[agent],
    prefix = `VERYNIZE_DEFAULT_${agent.toUpperCase()}_`;
  const pick = (key, fallback) =>
    Object.hasOwn(env, prefix + key) ? String(env[prefix + key] ?? "") : fallback;
  return { model: pick("MODEL", base.model), effort: pick("EFFORT", base.effort) };
}

/** Fill model/effort from the design defaults when the user left them empty. */
function withDefaults(agent, options = {}, env = process.env) {
  if (!options || options.useDefaults === false) return { ...options };
  const out = { ...options };
  const defaults = defaultsFor(agent, env);
  if (!out.model && defaults.model) {
    out.model = defaults.model;
    if (!out.effort && defaults.effort) out.effort = defaults.effort; // effort default belongs to the default model
  } else if (!out.model && !out.effort && defaults.effort) out.effort = defaults.effort;
  return out;
}

// Claude Agent SDK `permissionMode` per access level.
const CLAUDE_MODES = {
  ask: "default",
  edit: "acceptEdits",
  auto: "auto",
  full: "bypassPermissions",
};
// The installed `claude` CLI names the SDK's `default` mode `manual`.
const CLAUDE_CLI_MODES = { ...CLAUDE_MODES, ask: "manual" };
// Codex app-server thread policy per access level.
const CODEX_POLICIES = {
  ask: { approvalPolicy: "untrusted", sandbox: "read-only" },
  edit: { approvalPolicy: "on-request", sandbox: "workspace-write" },
  auto: {
    approvalPolicy: "on-request",
    sandbox: "workspace-write",
    approvalsReviewer: "auto_review",
  },
  full: { approvalPolicy: "never", sandbox: "danger-full-access" },
};

const claudePermissionMode = (access) => CLAUDE_MODES[normalizeAccess(access)];
const codexPolicy = (access) => ({ ...CODEX_POLICIES[normalizeAccess(access)] });

// Codex `-c key=value` overrides that register the live canvas MCP bridge. The bearer token is
// passed through an environment variable so it never appears in argv / process listings.
const MCP_SERVER_NAME = "verynize";
const MCP_TOKEN_ENV = "VERYNIZE_MCP_TOKEN";
function codexMcpArgs(bridge) {
  if (
    !bridge ||
    typeof bridge.url !== "string" ||
    !/^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?\//.test(bridge.url)
  )
    return [];
  const args = ["-c", `mcp_servers.${MCP_SERVER_NAME}.url=${JSON.stringify(bridge.url)}`];
  if (bridge.token)
    args.push(
      "-c",
      `mcp_servers.${MCP_SERVER_NAME}.bearer_token_env_var=${JSON.stringify(MCP_TOKEN_ENV)}`,
    );
  return args;
}

// argv for the one-shot fallback runner (used when the SDK / app-server is unavailable).
function argumentsFor(agent, options = {}) {
  if (!AGENTS.includes(agent)) throw Error("Unknown local agent");
  const o = normalizeOptions(withDefaults(agent, options));
  let args;
  if (agent === "codex") {
    const policy = CODEX_POLICIES[o.access];
    args = ["exec", "--skip-git-repo-check", "--sandbox", policy.sandbox];
    args.push(...codexMcpArgs(options.bridge));
    if (options.codexPersonality === "none") args.push("-c", 'personality="none"'); // Settings › Agents › Codex personality
  } else {
    args = ["--print", "--permission-mode", CLAUDE_CLI_MODES[o.access]];
    if (o.sessionId) args.push("--resume", o.sessionId);
    if (options.claudeSettings && typeof options.claudeSettings === "object")
      args.push("--settings", JSON.stringify(options.claudeSettings)); // response style, commit credit
    if (typeof options.appendSystemPrompt === "string" && options.appendSystemPrompt)
      args.push("--append-system-prompt", options.appendSystemPrompt);
    if (options.bridge?.url)
      args.push(
        "--mcp-config",
        JSON.stringify({
          mcpServers: { [MCP_SERVER_NAME]: claudeMcpServer(options.bridge, o.access) },
        }),
        "--allowedTools",
        `mcp__${MCP_SERVER_NAME}__*`,
      );
  }
  if (o.model) args.push("--model", o.model);
  if (o.effort)
    args.push(
      ...(agent === "codex"
        ? ["--config", `model_reasoning_effort="${o.effort}"`]
        : ["--effort", o.effort]),
    );
  if (o.structured)
    args.push(
      ...(agent === "codex"
        ? ["--json"]
        : ["--output-format", "stream-json", "--verbose", "--include-partial-messages"]),
    );
  // Extra launch flags from Settings › Agents › Access (desktop/agent-access.cjs).
  if (Array.isArray(options.extraArgs))
    args.push(...options.extraArgs.filter((arg) => typeof arg === "string"));
  if (agent === "codex") args.push("-");
  return args;
}

// `access` (ask|edit|auto|full|readonly) scopes the bridge's shell tools; see agent-shell.cjs.
function claudeMcpServer(bridge, access) {
  const headers = {
    ...(bridge.token ? { Authorization: `Bearer ${bridge.token}` } : {}),
    ...(access
      ? { "x-verynize-access": access === "readonly" ? "readonly" : normalizeAccess(access) }
      : {}),
  };
  return { type: "http", url: bridge.url, ...(Object.keys(headers).length ? { headers } : {}) };
}

module.exports = {
  ACCESS_LEVELS,
  DESIGN_DEFAULTS,
  defaultsFor,
  withDefaults,
  normalizeAccess,
  normalizeOptions,
  argumentsFor,
  claudePermissionMode,
  codexPolicy,
  codexMcpArgs,
  claudeMcpServer,
  MCP_SERVER_NAME,
  MCP_TOKEN_ENV,
};

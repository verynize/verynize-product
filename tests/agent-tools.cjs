// Settings › Agents: provider accounts, the agents' own MCP servers and the Access switches.
// Everything runs against a temporary HOME with fixture config files and fake CLIs; the real ~/.claude,
// ~/.claude.json and ~/.codex are never read or written. No model is called.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const tools = require("../desktop/agent-tools.cjs");
const access = require("../desktop/agent-access.cjs");
const { AgentRuntime } = require("../desktop/agent-runtime.cjs");

async function tempHome(t) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "agent-tools-home-"));
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  return home;
}
const jwt = (claims) =>
  ["e30", Buffer.from(JSON.stringify(claims)).toString("base64url"), "sig"].join(".");

/** A fake CLI: records argv (one JSON line per call) and prints canned output per subcommand. */
async function fakeCli(dir, name, outputs) {
  const file = path.join(dir, name),
    log = path.join(dir, `${name}.log`);
  await fs.writeFile(
    file,
    `#!/usr/bin/env node
const fs = require('fs');
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({ args, home: process.env.HOME }) + '\\n');
const outputs = ${JSON.stringify(outputs)};
const hit = outputs[args.join(' ')] ?? outputs[args.slice(0, 2).join(' ')] ?? { code: 0, stdout: '' };
process.stdout.write(hit.stdout || '');
process.stderr.write(hit.stderr || '');
process.exit(hit.code || 0);
`,
  );
  await fs.chmod(file, 0o755);
  return {
    file,
    calls: async () => {
      try {
        return (await fs.readFile(log, "utf8")).trim().split("\n").filter(Boolean).map(JSON.parse);
      } catch {
        return [];
      }
    },
  };
}

const CODEX_CONFIG = `model = "gpt-5"
# a comment
[features]
apps = true

[mcp_servers.context7]
url = "https://mcp.context7.com/mcp"

[mcp_servers.context7.http_headers]
CONTEXT7_API_KEY = "secret-key"

[mcp_servers.rea]
command = "npx"
args = ["-y", "rea-agents@6.8.0",
  "mcp"]
tool_timeout_sec = 120.0

[mcp_servers."with space"]
command = '/usr/local/bin/thing'
enabled = false

[profiles.fast]
model = "gpt-5-mini"
`;

test("config readers: Codex [mcp_servers.*] tables and Claude user-scope servers from fixture files", async (t) => {
  const home = await tempHome(t);
  await fs.mkdir(path.join(home, ".codex"));
  await fs.writeFile(path.join(home, ".codex", "config.toml"), CODEX_CONFIG);
  const codex = await tools.codexConfiguredServers(home);
  assert.deepEqual(
    codex.map((s) => [s.name, s.transport, s.status]),
    [
      ["context7", "http", "unknown"],
      ["rea", "stdio", "unknown"],
      ["with space", "stdio", "disabled"],
    ],
  );
  assert.deepEqual(codex[1].args, ["-y", "rea-agents@6.8.0", "mcp"]);
  assert.doesNotMatch(JSON.stringify(codex), /secret-key/, "header values never leave the reader");

  await fs.mkdir(path.join(home, ".claude"));
  await fs.writeFile(
    path.join(home, ".claude.json"),
    JSON.stringify({
      mcpServers: {
        sentry: { type: "http", url: "https://mcp.sentry.dev/mcp" },
        pencil: { type: "stdio", command: "/bin/pencil", args: ["--app"], env: { TOKEN: "x" } },
      },
      oauthAccount: { emailAddress: "a@b.c" },
    }),
  );
  await fs.writeFile(
    path.join(home, ".claude", "settings.json"),
    JSON.stringify({ mcpServers: { extra: { command: "node" } } }),
  );
  const claude = await tools.claudeConfiguredServers(home);
  assert.deepEqual(
    claude.map((s) => [s.name, s.transport, s.scope]),
    [
      ["sentry", "http", "user"],
      ["pencil", "stdio", "user"],
      ["extra", "stdio", "settings"],
    ],
  );
  assert.equal(claude[2].removable, false);
  assert.deepEqual(await tools.codexConfiguredServers(path.join(home, "missing")), []);
});

test("CLI status parsers: claude mcp list lines and codex mcp list --json", () => {
  const claude = tools.parseClaudeMcpList(`Checking MCP server health…

claude.ai Gmail: https://gmail.mcp.claude.com/mcp - ✔ Connected
treg: https://treg.to/mcp/ (HTTP) - ! Needs authentication
sentry: https://mcp.sentry.dev/mcp (HTTP) - ✔ Connected
rea: npx -y rea-agents@6.8.0 mcp - ✗ Failed to connect
`);
  assert.deepEqual(
    [...claude].map(([name, info]) => [name, info.status]),
    [
      ["treg", "needs-auth"],
      ["sentry", "connected"],
      ["rea", "error"],
    ],
  );
  const codex = tools.parseCodexMcpList(
    JSON.stringify([
      {
        name: "abadikan",
        enabled: true,
        transport: { type: "stdio", command: "node", args: ["x.js"] },
        auth_status: "unsupported",
      },
      {
        name: "remote",
        enabled: true,
        transport: { type: "streamable_http", url: "https://mcp.example.com/mcp" },
        auth_status: "not_logged_in",
      },
      {
        name: "off",
        enabled: false,
        transport: { type: "stdio", command: "x" },
        auth_status: "unsupported",
      },
    ]),
  );
  assert.deepEqual(
    [...codex].map(([name, info]) => [name, info.status, info.server.transport]),
    [
      ["abadikan", "connected", "stdio"],
      ["remote", "needs-auth", "http"],
      ["off", "disabled", "stdio"],
    ],
  );
  assert.equal(tools.parseCodexMcpList("not json").size, 0);
});

test("accounts: Claude auth status + Codex id_token claims, plans, and Cursor / OpenCode rows", async (t) => {
  const home = await tempHome(t);
  const bin = path.join(home, "bin");
  await fs.mkdir(bin);
  const claude = await fakeCli(bin, "claude", {
    "auth status --json": {
      stdout: JSON.stringify({
        loggedIn: true,
        authMethod: "claude.ai",
        email: "adam@example.com",
        orgName: "Abadikan",
        subscriptionType: "max",
      }),
    },
  });
  const codex = await fakeCli(bin, "codex", {
    "login status": { stdout: "Logged in using ChatGPT\n" },
  });
  const opencode = await fakeCli(bin, "opencode", {});
  await fs.mkdir(path.join(home, ".codex"));
  await fs.writeFile(
    path.join(home, ".codex", "auth.json"),
    JSON.stringify({
      auth_mode: "chatgpt",
      tokens: {
        id_token: jwt({
          email: "team@example.com",
          "https://api.openai.com/auth": { chatgpt_plan_type: "pro" },
        }),
        access_token: "ACCESS-SECRET",
        refresh_token: "REFRESH-SECRET",
      },
    }),
  );
  const lookup = async (name) =>
    ({ claude: claude.file, codex: codex.file, opencode: opencode.file })[name] || null;
  const list = await new tools.AgentTools({ home, lookup, userData: home }).accounts();
  assert.deepEqual(
    list.map((p) => p.id),
    ["claude", "codex", "cursor", "opencode"],
  );
  assert.deepEqual(list[0].accounts, [
    {
      email: "adam@example.com",
      organization: "Abadikan",
      plan: "Claude Max subscription",
      method: "claude.ai",
      default: true,
    },
  ]);
  assert.deepEqual(list[1].accounts, [
    {
      email: "team@example.com",
      organization: "",
      plan: "ChatGPT Pro",
      method: "ChatGPT",
      default: true,
    },
  ]);
  assert.deepEqual(
    [list[2].comingSoon, list[2].installed, list[3].comingSoon, list[3].installed],
    [true, false, true, true],
  );
  assert.doesNotMatch(JSON.stringify(list), /SECRET/, "tokens never reach the renderer");
  assert.equal((await claude.calls())[0].home, home, "CLIs run with the given HOME");

  // Signed out / not installed.
  const out = await fakeCli(bin, "claude2", {
    "auth status --json": { code: 1, stdout: JSON.stringify({ loggedIn: false }) },
  });
  const signedOut = await new tools.AgentTools({
    home,
    lookup: async (name) => (name === "claude" ? out.file : null),
    userData: home,
  }).accounts();
  assert.deepEqual(
    [
      signedOut[0].installed,
      signedOut[0].loggedIn,
      signedOut[0].accounts.length,
      signedOut[1].installed,
    ],
    [true, false, 0, false],
  );
  assert.equal(
    tools.codexAccountFromAuth({ auth_mode: "apikey", OPENAI_API_KEY: "sk-x" }).plan,
    "API key",
  );
  assert.equal(tools.claudePlan({ authMethod: "claude.ai" }), "Claude subscription");
  assert.equal(tools.jwtClaims("nope"), null);
});

test("tools: list merges live status; add / remove / sign-in go through the agent CLIs", async (t) => {
  const home = await tempHome(t);
  const bin = path.join(home, "bin");
  await fs.mkdir(bin);
  await fs.writeFile(
    path.join(home, ".claude.json"),
    JSON.stringify({
      mcpServers: {
        treg: { type: "http", url: "https://treg.to/mcp/" },
        rea: { command: "npx", args: ["rea"] },
      },
    }),
  );
  await fs.mkdir(path.join(home, ".codex"));
  await fs.writeFile(path.join(home, ".codex", "config.toml"), CODEX_CONFIG);
  const claude = await fakeCli(bin, "claude", {
    "mcp list": {
      stdout:
        "treg: https://treg.to/mcp/ (HTTP) - ! Needs authentication\nrea: npx rea - ✔ Connected\n",
    },
  });
  const codex = await fakeCli(bin, "codex", {
    "mcp list --json": {
      stdout: JSON.stringify([
        {
          name: "context7",
          enabled: true,
          transport: { type: "streamable_http", url: "https://mcp.context7.com/mcp" },
          auth_status: "not_logged_in",
        },
        {
          name: "rea",
          enabled: true,
          transport: { type: "stdio", command: "npx", args: [] },
          auth_status: "unsupported",
        },
      ]),
    },
    "mcp login": { code: 0 },
  });
  const agentTools = new tools.AgentTools({
    home,
    lookup: async (name) => ({ claude: claude.file, codex: codex.file })[name] || null,
    userData: home,
  });

  const quick = await agentTools.listServers({ agent: "claude" });
  assert.equal(quick.checked, false);
  assert.ok(quick.servers.every((s) => s.status === "unknown"));
  const live = await agentTools.listServers({ agent: "claude", check: true });
  assert.deepEqual(
    live.servers.map((s) => [s.name, s.status]),
    [
      ["treg", "needs-auth"],
      ["rea", "connected"],
    ],
  );
  const codexLive = await agentTools.listServers({ agent: "codex", check: true });
  assert.deepEqual(
    codexLive.servers.map((s) => [s.name, s.status]),
    [
      ["context7", "needs-auth"],
      ["rea", "connected"],
      ["with space", "disabled"],
    ],
  );

  await agentTools.addServer({
    agent: "claude",
    name: "figma",
    transport: "http",
    url: "https://mcp.figma.com/mcp",
  });
  await agentTools.addServer({
    agent: "codex",
    name: "local",
    transport: "stdio",
    command: "node",
    args: ["server.js", "--flag value"],
  });
  await agentTools.removeServer({ agent: "claude", name: "rea" });
  await agentTools.loginServer({ agent: "codex", name: "context7" });
  const claudeCalls = (await claude.calls()).map((c) => c.args.join(" "));
  assert.ok(
    claudeCalls.includes("mcp add --scope user --transport http figma https://mcp.figma.com/mcp"),
  );
  assert.ok(claudeCalls.includes("mcp remove --scope user rea"));
  const codexCalls = (await codex.calls()).map((c) => c.args);
  assert.ok(
    codexCalls.some(
      (a) =>
        JSON.stringify(a) ===
        JSON.stringify(["mcp", "add", "local", "--", "node", "server.js", "--flag value"]),
    ),
  );
  assert.ok(codexCalls.some((a) => a.join(" ") === "mcp login context7"));

  await assert.rejects(
    () =>
      agentTools.addServer({
        agent: "claude",
        name: "bad name",
        transport: "http",
        url: "https://x",
      }),
    /tool name/,
  );
  await assert.rejects(
    () =>
      agentTools.addServer({
        agent: "claude",
        name: "x",
        transport: "http",
        url: "file:///etc/passwd",
      }),
    /HTTP or HTTPS/,
  );
  await assert.rejects(
    () =>
      agentTools.addServer({
        agent: "claude",
        name: "treg",
        transport: "http",
        url: "https://x.dev",
      }),
    /already exists/,
  );
  await assert.rejects(
    () => agentTools.removeServer({ agent: "codex", name: "nope" }),
    /not configured/,
  );
  await assert.rejects(() => agentTools.listServers({ agent: "gemini" }), /Choose/);
});

test("tools without the CLI edit the config files in place and keep everything else", async (t) => {
  const home = await tempHome(t);
  await fs.writeFile(
    path.join(home, ".claude.json"),
    JSON.stringify({
      numStartups: 4,
      oauthAccount: { emailAddress: "a@b.c" },
      mcpServers: { keep: { command: "x" } },
    }),
  );
  await fs.mkdir(path.join(home, ".codex"));
  await fs.writeFile(path.join(home, ".codex", "config.toml"), CODEX_CONFIG);
  const agentTools = new tools.AgentTools({ home, lookup: async () => null, userData: home });

  assert.deepEqual(
    await agentTools.addServer({
      agent: "claude",
      name: "figma",
      transport: "http",
      url: "https://mcp.figma.com/mcp",
    }),
    { added: true, via: "config" },
  );
  const claudeConfig = JSON.parse(await fs.readFile(path.join(home, ".claude.json"), "utf8"));
  assert.equal(claudeConfig.numStartups, 4);
  assert.deepEqual(Object.keys(claudeConfig.mcpServers), ["keep", "figma"]);
  await agentTools.removeServer({ agent: "claude", name: "keep" });
  assert.deepEqual(
    Object.keys(JSON.parse(await fs.readFile(path.join(home, ".claude.json"), "utf8")).mcpServers),
    ["figma"],
  );

  await agentTools.addServer({
    agent: "codex",
    name: "local",
    transport: "stdio",
    command: "node",
    args: ['a "b".js'],
  });
  await agentTools.removeServer({ agent: "codex", name: "context7" });
  const toml = await fs.readFile(path.join(home, ".codex", "config.toml"), "utf8");
  assert.doesNotMatch(toml, /context7|secret-key/, "the server and its sub-tables are removed");
  assert.match(toml, /model = "gpt-5"/);
  assert.match(toml, /\[profiles\.fast\]\nmodel = "gpt-5-mini"/);
  assert.match(toml, /\[mcp_servers\.rea\]/);
  const servers = await tools.codexConfiguredServers(home);
  assert.deepEqual(
    servers.map((s) => s.name),
    ["rea", "with space", "local"],
  );
  assert.deepEqual(servers[2].args, ['a "b".js']);
});

test("access settings: defaults, persistence and validation", async (t) => {
  const dir = await tempHome(t);
  assert.deepEqual(await access.loadAccessSettings(dir), access.ACCESS_DEFAULTS);
  assert.deepEqual(access.ACCESS_DEFAULTS, {
    createFiles: true,
    shareMemory: true,
    askAgents: false,
    claudeConnectors: true,
    claudeArtifacts: true,
    claudeChrome: false,
    codexApps: true,
    codexComputerUse: false,
  });
  const { previous, settings } = await access.saveAccessSettings(dir, {
    askAgents: true,
    codexApps: false,
  });
  assert.equal(previous.askAgents, false);
  assert.deepEqual(await access.loadAccessSettings(dir), settings);
  await assert.rejects(() => access.saveAccessSettings(dir, { nope: true }), /Unknown/);
  await assert.rejects(() => access.saveAccessSettings(dir, { askAgents: "yes" }), /on or off/);
  await fs.writeFile(path.join(dir, access.ACCESS_FILE), "{broken");
  assert.deepEqual(await access.loadAccessSettings(dir), access.ACCESS_DEFAULTS);
});

test("access → launch options: Claude env / flags / tools and Codex feature flags", () => {
  const on = {
    ...access.ACCESS_DEFAULTS,
    askAgents: true,
    claudeChrome: true,
    codexComputerUse: true,
  };
  const off = { ...access.ACCESS_DEFAULTS, claudeConnectors: false, claudeArtifacts: false };
  assert.deepEqual(access.claudeAccessOptions(on), {
    env: {},
    disallowedTools: [],
    extraArgs: { chrome: null },
    cliArgs: ["--chrome"],
  });
  const closed = access.claudeAccessOptions(off);
  assert.deepEqual(closed.env, {
    ENABLE_CLAUDEAI_MCP_SERVERS: "false",
    CLAUDE_CODE_DISABLE_ARTIFACT: "1",
  });
  assert.deepEqual(closed.disallowedTools, [
    ...access.CLAUDE_ARTIFACT_TOOLS,
    "mcp__verynize__ask_agent",
  ]);
  assert.deepEqual(closed.extraArgs, { "no-chrome": null });
  assert.deepEqual(access.codexAccessArgs(access.ACCESS_DEFAULTS, { bridge: true }), [
    "--enable",
    "apps",
    "--disable",
    "computer_use",
    "-c",
    'mcp_servers.verynize.disabled_tools=["ask_agent"]',
  ]);
  assert.deepEqual(access.codexAccessArgs({ ...on, codexApps: false }, { bridge: true }), [
    "--disable",
    "apps",
    "--enable",
    "computer_use",
  ]);
  assert.match(access.accessPersonaLines(access.ACCESS_DEFAULTS), /create them yourself/);
  assert.match(
    access.accessPersonaLines({ ...access.ACCESS_DEFAULTS, createFiles: false }),
    /Ask the user before you create/,
  );
});

test("shared memory reads the other agent’s files from HOME and the project", async (t) => {
  const home = await tempHome(t);
  const project = path.join(home, "project");
  await fs.mkdir(project);
  await fs.mkdir(path.join(home, ".codex", "memories"), { recursive: true });
  await fs.writeFile(path.join(home, ".codex", "AGENTS.md"), "Codex global: prefer pnpm");
  await fs.writeFile(
    path.join(home, ".codex", "memories", "notes.md"),
    "Codex remembers: brand is teal",
  );
  await fs.writeFile(path.join(project, "AGENTS.md"), "Project rule for Codex");
  await fs.writeFile(path.join(project, "CLAUDE.md"), "Project rule for Claude");
  const slug = access.claudeProjectSlug(project);
  await fs.mkdir(path.join(home, ".claude", "projects", slug, "memory"), { recursive: true });
  await fs.writeFile(
    path.join(home, ".claude", "projects", slug, "memory", "MEMORY.md"),
    "Claude remembers: uses Inter",
  );
  const forClaude = await access.sharedMemoryBlock("claude", { cwd: project, home });
  assert.match(
    forClaude,
    /Codex global: prefer pnpm[\s\S]*Project rule for Codex[\s\S]*brand is teal/,
  );
  assert.doesNotMatch(forClaude, /Project rule for Claude/);
  const forCodex = await access.sharedMemoryBlock("codex", { cwd: project, home });
  assert.match(forCodex, /Project rule for Claude[\s\S]*uses Inter/);
  assert.equal(
    await access.sharedMemoryBlock("codex", {
      cwd: path.join(home, "empty"),
      home: path.join(home, "none"),
    }),
    "",
  );
});

test("createFiles gate recognises new files, mkdir and canvas pages", async (t) => {
  const dir = await tempHome(t);
  await fs.writeFile(path.join(dir, "exists.txt"), "x");
  assert.equal(
    await access.claudeCreatesSomething("Write", { file_path: path.join(dir, "exists.txt") }),
    false,
  );
  assert.equal(
    await access.claudeCreatesSomething("Write", { file_path: "new.txt" }, { cwd: dir }),
    true,
  );
  assert.equal(await access.claudeCreatesSomething("Bash", { command: "mkdir -p src/x" }), true);
  assert.equal(await access.claudeCreatesSomething("Bash", { command: "ls" }), false);
  assert.equal(await access.claudeCreatesSomething("mcp__verynize__create_page", {}), true);
  assert.equal(await access.claudeCreatesSomething("mcp__verynize__update_elements", {}), false);
});

// --- runtime wiring -------------------------------------------------------------------------------
function recordingSdk(record) {
  return {
    query({ prompt, options }) {
      record.options = options;
      const gen = (async function* () {
        const iterator = prompt[Symbol.asyncIterator]();
        await iterator.next();
        yield { type: "system", subtype: "init", session_id: "s", model: "fake" };
        if (options.hooks?.PreToolUse)
          record.hook = await options.hooks.PreToolUse[0].hooks[0](
            { tool_name: "Write", tool_input: { file_path: "brand-new.txt" } },
            "tu-1",
            { signal: new AbortController().signal },
          );
        yield {
          type: "result",
          subtype: "success",
          is_error: false,
          result: "ok",
          session_id: "s",
        };
        await iterator.next();
      })();
      gen.interrupt = async () => {};
      gen.close = () => {};
      return gen;
    },
  };
}

async function runtimeSetup(t, settings) {
  const root = await tempHome(t);
  const userData = path.join(root, "userData");
  if (settings) await access.saveAccessSettings(userData, settings);
  const bin = path.join(root, "bin");
  await fs.mkdir(bin);
  const codex = path.join(bin, "codex");
  await fs.copyFile(path.join(__dirname, "fixtures/fake-codex.cjs"), codex);
  await fs.chmod(codex, 0o755);
  process.env.FAKE_CODEX_LOG = path.join(root, "codex.log");
  const home = path.join(root, "home");
  await fs.mkdir(path.join(home, ".codex"), { recursive: true });
  await fs.writeFile(path.join(home, ".codex", "AGENTS.md"), "SHARED-FROM-CODEX");
  await fs.mkdir(path.join(home, ".codex", "memories"), { recursive: true });
  await fs.writeFile(path.join(home, ".codex", "memories", "notes.md"), "CODEX-MEMORY-MARKER");
  const events = [],
    record = {};
  const runtime = new AgentRuntime({
    userData,
    home,
    discover: async () => [
      { id: "codex", available: true, path: codex },
      { id: "claude", available: true, path: "/usr/bin/true" },
    ],
    loadClaudeSdk: async () => recordingSdk(record),
    getBridge: async () => ({ url: "http://127.0.0.1:7777/mcp", token: "t" }),
    loadPreferences: async () => [],
    emit: (event) => {
      events.push(event);
      if (event.type === "permission-request")
        runtime.respondPermission({ requestId: event.requestId, allow: false });
    },
  });
  t.after(() => runtime.close());
  const until = (predicate, label) =>
    new Promise((resolve, reject) => {
      const end = Date.now() + 8000;
      const poll = () => {
        const hit = events.find(predicate);
        if (hit) return resolve(hit);
        if (Date.now() > end) return reject(Error("Timed out waiting for " + label));
        setTimeout(poll, 5);
      };
      poll();
    });
  return { root, runtime, events, record, until };
}

test("runtime: Claude chats get the Access options; ask_agent is gated; memory is shared", async (t) => {
  const { runtime, record, until, events } = await runtimeSetup(t, {
    createFiles: false,
    claudeConnectors: false,
    claudeArtifacts: false,
    claudeChrome: true,
  });
  await runtime.run({ agent: "claude", chatId: "chat-access-1", prompt: "hello", access: "edit" });
  await until((e) => e.type === "done", "done");
  const options = record.options;
  assert.equal(options.env.ENABLE_CLAUDEAI_MCP_SERVERS, "false");
  assert.equal(options.env.CLAUDE_CODE_DISABLE_ARTIFACT, "1");
  assert.deepEqual(options.extraArgs, { chrome: null });
  assert.ok(options.disallowedTools.includes("mcp__verynize__ask_agent"));
  assert.ok(options.disallowedTools.includes("Artifact"));
  assert.match(options.systemPrompt.append, /SHARED-FROM-CODEX/);
  assert.match(options.systemPrompt.append, /CODEX-MEMORY-MARKER/);
  assert.match(options.systemPrompt.append, /Ask the user before you create/);
  // The createFiles gate asked (the test denies) before a brand-new file was written.
  assert.ok(events.some((e) => e.type === "permission-request" && e.toolName === "Write"));
  assert.equal(record.hook.hookSpecificOutput.permissionDecision, "deny");
  await assert.rejects(() => runtime.askTool({ agent: "claude", task: "x" }), /turned off/);
});

test("runtime: defaults keep connectors and artifacts, pass --no-chrome; Codex gets feature flags and Computer Use stops", async (t) => {
  const { runtime, record, until, events, root } = await runtimeSetup(t, {
    shareMemory: false,
    codexComputerUse: true,
    askAgents: true,
  });
  await runtime.run({ agent: "claude", chatId: "chat-access-2", prompt: "hello", access: "edit" });
  await until((e) => e.type === "done", "claude done");
  assert.equal(record.options.env.ENABLE_CLAUDEAI_MCP_SERVERS, undefined);
  assert.equal(record.options.env.CLAUDE_CODE_DISABLE_ARTIFACT, undefined);
  assert.deepEqual(record.options.extraArgs, { "no-chrome": null });
  assert.ok(
    !(record.options.hooks.PreToolUse || []).some((h) => !h.matcher),
    "no create gate while createFiles is on",
  );
  // Sharing off: Codex's memories stay out, but ~/.codex/AGENTS.md is still given to Claude as personal instructions (Settings › Memory).
  assert.doesNotMatch(record.options.systemPrompt.append, /CODEX-MEMORY-MARKER/);
  assert.equal(record.options.systemPrompt.append.match(/SHARED-FROM-CODEX/g)?.length, 1);

  const started = await runtime.run({
    agent: "codex",
    chatId: "chat-access-3",
    prompt: "slow task",
    access: "edit",
  });
  await until(
    (e) => e.type === "assistant-text-delta" && e.chatId === "chat-access-3",
    "codex streaming",
  );
  const launch = (await fs.readFile(path.join(root, "codex.log"), "utf8"))
    .trim()
    .split("\n")
    .map(JSON.parse)
    .find((c) => c.args && c.args[0] === "app-server" && !c.args.includes("--help"));
  assert.ok(launch.args.join(" ").includes("--enable apps --enable computer_use"));
  assert.ok(
    !launch.args.some((a) => /disabled_tools/.test(a)),
    "ask_agent stays available while askAgents is on",
  );
  const agentTools = new tools.AgentTools({
    userData: path.join(root, "userData"),
    getRuntime: () => runtime,
    lookup: async () => null,
  });
  const result = await agentTools.setAccess({ codexComputerUse: false });
  assert.equal(result.stopped, 1);
  const done = await until((e) => e.type === "done" && e.runId === started.id, "codex stopped");
  assert.equal(done.stopped, true);
});

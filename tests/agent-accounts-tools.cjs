// Named provider accounts, Verynize-managed MCP servers + permission defaults, and per-chat autonomy.
// Real stores in temp folders, real child processes: provider CLIs are the scripted fixtures used by the
// other agent tests (tests/fixtures/fake-codex.cjs and small temp executables). No model or account is used.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { AgentProfiles, profileEnv } = require("../desktop/agent-profiles.cjs");
const { AgentAuth } = require("../desktop/agent-auth.cjs");
const { AgentUsage } = require("../desktop/agent-usage.cjs");
const {
  AgentToolConfig,
  codexServerArgs,
  claudeServers,
  decisionFor,
  toolMatches,
} = require("../desktop/agent-tool-config.cjs");
const {
  AgentAutonomy,
  normalizeAutonomy,
  autonomyDecision,
  describeAutonomy,
} = require("../desktop/agent-autonomy.cjs");
const {
  AgentRuntime,
  applyClaudePolicy,
  applyCodexPlanFirst,
} = require("../desktop/agent-runtime.cjs");

const CHAT = "9a9a9a9a-2222-3333-4444-555555555555";

async function temp(t, prefix) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}
const jwt = (claims) =>
  ["e30", Buffer.from(JSON.stringify(claims)).toString("base64url"), "sig"].join(".");

test("profiles: add, rename, defaults, per-chat pick, isolated 0700 folders and removal", async (t) => {
  const userData = await temp(t, "profiles-");
  const profiles = new AgentProfiles({ userData });
  const listed = await profiles.list();
  assert.deepEqual(
    listed.profiles.map((p) => [p.agent, p.id, p.system]),
    [
      ["claude", "system", true],
      ["codex", "system", true],
    ],
  );
  const work = await profiles.add({ agent: "claude", name: "  Work   account " });
  assert.equal(work.name, "Work account");
  await assert.rejects(
    () => profiles.add({ agent: "claude", name: "work ACCOUNT" }),
    /already exists/,
  );
  await assert.rejects(() => profiles.add({ agent: "claude", name: "This Mac" }), /already exists/);
  await assert.rejects(() => profiles.add({ agent: "gemini", name: "x" }), /Claude Code or Codex/);
  const personal = await profiles.add({ agent: "codex", name: "Personal" });
  const dir = path.join(userData, "agent-profiles", "claude", work.id);
  assert.equal((await fs.stat(dir)).mode & 0o777, 0o700);
  assert.deepEqual(await profiles.envFor("claude", work.id), { CLAUDE_CONFIG_DIR: dir });
  assert.deepEqual(await profiles.envFor("codex", personal.id), {
    CODEX_HOME: path.join(userData, "agent-profiles", "codex", personal.id),
  });
  await assert.rejects(() => profiles.envFor("codex", work.id), /another agent/);
  assert.deepEqual(await profiles.envFor("claude", "system"), {});

  // Resolution order: explicit id, then the chat's pick, then the agent default.
  assert.equal((await profiles.resolve("claude", { chatId: CHAT })).id, "system");
  await profiles.setDefault({ agent: "claude", id: work.id });
  assert.equal((await profiles.resolve("claude", { chatId: CHAT })).id, work.id);
  await profiles.setChat({ chatId: CHAT, agent: "claude", id: "system" });
  assert.equal((await profiles.resolve("claude", { chatId: CHAT })).id, "system");
  assert.equal(
    (await profiles.resolve("claude", { chatId: CHAT, id: work.id })).env.CLAUDE_CONFIG_DIR,
    dir,
  );
  await assert.rejects(
    () => profiles.setChat({ chatId: CHAT, agent: "codex", id: work.id }),
    /another agent/,
  );

  await profiles.rename({ id: work.id, name: "Client" });
  // A fresh store reads the same file.
  const reread = new AgentProfiles({ userData });
  assert.equal((await reread.list()).profiles.find((p) => p.id === work.id).name, "Client");
  assert.equal((await reread.list()).defaults.claude, work.id);
  await fs.writeFile(path.join(dir, "marker"), "x");
  await reread.remove({ id: work.id });
  await assert.rejects(() => fs.access(dir));
  assert.equal((await reread.list()).defaults.claude, "system");
  assert.deepEqual(await reread.chat(CHAT), { claude: "system" });
  const stored = await fs.readFile(path.join(userData, "agent-profiles.json"), "utf8");
  assert.doesNotMatch(stored, /token/i);
  assert.equal((await fs.stat(path.join(userData, "agent-profiles.json"))).mode & 0o777, 0o600);
});

test("auth with a named account: status, browser login and logout run with the isolated config folder", async (t) => {
  const root = await temp(t, "profile-auth-");
  const userData = path.join(root, "userData"),
    log = path.join(root, "calls.jsonl");
  const profiles = new AgentProfiles({ userData });
  const claudeProfile = await profiles.add({ agent: "claude", name: "Client" });
  const codexProfile = await profiles.add({ agent: "codex", name: "Side" });
  const files = {};
  for (const agent of ["claude", "codex"]) {
    files[agent] = path.join(root, agent);
    // Records argv and the account variables; `login` stays open until killed (a browser flow in progress).
    await fs.writeFile(
      files[agent],
      `#!/usr/bin/env node
const fs=require('node:fs');const args=process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(log)},JSON.stringify({agent:${JSON.stringify(agent)},args,claudeDir:process.env.CLAUDE_CONFIG_DIR||null,codexHome:process.env.CODEX_HOME||null})+'\\n');
if(args.join(' ')==='auth status --json'){console.log(JSON.stringify({loggedIn:!!process.env.CLAUDE_CONFIG_DIR,authMethod:'claude.ai',email:process.env.CLAUDE_CONFIG_DIR?'client@example.com':'me@example.com',subscriptionType:'max'}));process.exit(0);}
if(args.join(' ')==='login status'){if(process.env.CODEX_HOME){console.log('Logged in using ChatGPT');process.exit(0);}console.log('Not logged in');process.exit(1);}
if(args[0]==='login'||args.join(' ')==='auth login'){console.log('Opening browser…');setInterval(()=>{},1000);}
else process.exit(0);
`,
    );
    await fs.chmod(files[agent], 0o755);
  }
  const codexDir = path.join(userData, "agent-profiles", "codex", codexProfile.id);
  await fs.writeFile(
    path.join(codexDir, "auth.json"),
    JSON.stringify({
      tokens: {
        id_token: jwt({
          email: "side@example.com",
          "https://api.openai.com/auth": { chatgpt_plan_type: "plus" },
        }),
        access_token: "SECRET-ACCESS",
        refresh_token: "SECRET-REFRESH",
      },
    }),
  );
  const events = [];
  const auth = new AgentAuth({
    discover: async () =>
      Object.entries(files).map(([id, p]) => ({ id, path: p, available: true })),
    emit: (event) => events.push(event),
    profileEnv: (agent, id) => profiles.envFor(agent, id),
    profileAccount: (agent, dir, extra) =>
      require("../desktop/agent-profiles.cjs").profileAccount(agent, dir, extra),
  });
  t.after(() => auth.close());
  const claudeDir = path.join(userData, "agent-profiles", "claude", claudeProfile.id);
  const status = await auth.status({ agent: "claude", profile: claudeProfile.id });
  assert.deepEqual(status, {
    agent: "claude",
    installed: true,
    loggedIn: true,
    method: "claude.ai",
    profile: claudeProfile.id,
    configDir: claudeDir,
    email: "client@example.com",
    plan: "Claude Max subscription",
  });
  const codexStatus = await auth.status({ agent: "codex", profile: codexProfile.id });
  assert.equal(codexStatus.email, "side@example.com");
  assert.equal(codexStatus.plan, "ChatGPT Plus");
  assert.doesNotMatch(JSON.stringify(codexStatus), /SECRET/);
  // The computer's own login keeps its exact old shape and environment.
  assert.deepEqual(await auth.status({ agent: "codex" }), {
    agent: "codex",
    installed: true,
    loggedIn: false,
    method: "signed out",
  });

  // Browser sign-in for the named account launches the CLI login with the isolated folder only.
  const login = await auth.login({ agent: "claude", profile: claudeProfile.id });
  assert.equal(login.profile, claudeProfile.id);
  const until = async (predicate) => {
    const end = Date.now() + 4000;
    while (Date.now() < end) {
      if (predicate()) return;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw Error("timed out");
  };
  await until(() => events.some((e) => e.id === login.id && e.type === "waiting"));
  // The same agent's own login is a separate slot, so it can be used meanwhile.
  await auth.logout({ agent: "claude" });
  await assert.rejects(
    () => auth.logout({ agent: "claude", profile: claudeProfile.id }),
    /pending/,
  );
  assert.deepEqual(auth.cancel({ id: login.id }), { canceled: true });
  await until(() => events.some((e) => e.id === login.id && e.type === "canceled"));
  const calls = (await fs.readFile(log, "utf8")).trim().split("\n").map(JSON.parse);
  const loginCall = calls.find((c) => c.args.join(" ") === "auth login");
  assert.equal(loginCall.claudeDir, claudeDir);
  assert.equal(
    calls.find((c) => c.agent === "claude" && c.args.join(" ") === "auth logout").claudeDir,
    null,
  );
  assert.equal(calls.find((c) => c.agent === "codex" && c.codexHome).codexHome, codexDir);
  await assert.rejects(
    () => auth.status({ agent: "claude", profile: "ffffffffffffffff" }),
    /no longer exists/,
  );
});

test("usage per account: each named account fetches its own limits with its own folder and cache", async (t) => {
  const userData = await temp(t, "profile-usage-");
  const profiles = new AgentProfiles({ userData });
  const a = await profiles.add({ agent: "codex", name: "A" });
  const seen = [];
  const usage = new AgentUsage({
    userData,
    discover: async () => [
      { id: "codex", available: true, path: "/bin/echo" },
      { id: "claude", available: true, path: "/bin/echo" },
    ],
    // Provider fake: answers like app-server account/rateLimits would, per CODEX_HOME.
    codex: async ({ env }) => {
      seen.push(env);
      return {
        agent: "codex",
        status: "ok",
        email: env.CODEX_HOME ? "a@example.com" : "me@example.com",
        plan: "Plus",
        limits: [{ id: "primary", label: "5-hour limit", usedPercent: env.CODEX_HOME ? 80 : 10 }],
      };
    },
    profileEnv: (agent, id) => profiles.envFor(agent, id),
  });
  const own = await usage.provider("codex");
  const named = await usage.provider("codex", { profile: a.id });
  assert.equal(own.limits[0].usedPercent, 10);
  assert.equal(named.limits[0].usedPercent, 80);
  assert.equal(named.profile, a.id);
  assert.deepEqual(seen, [
    {},
    { CODEX_HOME: path.join(userData, "agent-profiles", "codex", a.id) },
  ]);
  await usage.provider("codex", { profile: a.id });
  assert.equal(seen.length, 2, "cached per account");
  usage.forget(a.id);
  await usage.provider("codex", { profile: a.id });
  assert.equal(seen.length, 3);
  await assert.rejects(
    () => usage.provider("codex", { profile: "ffffffffffffffff" }),
    /no longer exists/,
  );
});

test("tool config: servers per scope, secrets kept out of the renderer view, permission defaults", async (t) => {
  const userData = await temp(t, "tool-config-");
  const project = await temp(t, "tool-project-");
  const config = new AgentToolConfig({ userData });
  const stdio = await config.saveServer({
    name: "files",
    transport: "stdio",
    command: "npx",
    args: ["-y", "some-mcp"],
    env: { API_KEY: "sk-test-123" },
  });
  assert.deepEqual(stdio.envKeys, ["API_KEY"]);
  assert.equal(stdio.env, undefined);
  assert.doesNotMatch(JSON.stringify(await config.list()), /sk-test-123/);
  const http = await config.saveServer({
    name: "docs",
    transport: "http",
    url: "https://mcp.example.com/mcp",
    scope: "project",
    project,
    agents: ["codex"],
  });
  await assert.rejects(
    () => config.saveServer({ name: "verynize", transport: "http", url: "https://x.test" }),
    /reserved/,
  );
  await assert.rejects(
    () => config.saveServer({ name: "bad", transport: "http", url: "https://u:p@x.test" }),
    /without credentials/,
  );
  await assert.rejects(
    () => config.saveServer({ name: "files", transport: "stdio", command: "x" }),
    /already exists/,
  );
  // Editing with a null value keeps the stored secret.
  await config.saveServer({
    id: stdio.id,
    name: "files",
    transport: "stdio",
    command: "npx",
    args: ["-y", "other-mcp"],
    env: { API_KEY: null, EXTRA: "on" },
  });
  const run = await config.forRun("claude", { projects: [project] });
  assert.deepEqual(
    run.servers.map((s) => s.name),
    ["files"],
  );
  assert.deepEqual(run.servers[0].env, { API_KEY: "sk-test-123", EXTRA: "on" });
  assert.deepEqual(
    (await config.forRun("codex", { projects: [project] })).servers
      .map((s) => s.name)
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
    ["docs", "files"],
  );
  assert.deepEqual(
    (await config.forRun("codex", { projects: ["/elsewhere"] })).servers.map((s) => s.name),
    ["files"],
  );
  await config.setServerEnabled({ id: stdio.id, enabled: false });
  assert.deepEqual((await config.forRun("claude", { projects: [project] })).servers, []);
  await config.setServerEnabled({ id: stdio.id, enabled: true });

  await config.setPermission({ tool: "Bash", decision: "deny" });
  await config.setPermission({ tool: "mcp__docs__*", decision: "allow" });
  await config.setPermission({ tool: "Bash", decision: "ask", scope: "project", project });
  await assert.rejects(
    () => config.setPermission({ tool: "rm -rf", decision: "deny" }),
    /tool name/,
  );
  const global = await config.forRun("claude", { projects: ["/elsewhere"] });
  assert.equal(decisionFor(global.permissions, "Bash"), "deny");
  assert.equal(decisionFor(global.permissions, "mcp__docs__search"), "allow");
  assert.equal(
    decisionFor((await config.forRun("claude", { projects: [project] })).permissions, "Bash"),
    "ask",
    "project rule overrides the global one",
  );
  await config.setPermission({ tool: "mcp__docs__*", decision: "allow", remove: true });
  assert.equal(
    decisionFor((await config.forRun("claude", {})).permissions, "mcp__docs__search"),
    null,
  );
  assert.ok(toolMatches("mcp__a__*", "mcp__a__b") && !toolMatches("mcp__a__*", "mcp__b__a"));

  const servers = (await config.forRun("codex", { projects: [project] })).servers;
  const codex = codexServerArgs(servers);
  assert.ok(codex.args.includes('mcp_servers.docs.url="https://mcp.example.com/mcp"'));
  assert.ok(codex.args.includes('mcp_servers.files.command="npx"'));
  assert.ok(codex.args.includes('mcp_servers.files.env_vars=["API_KEY","EXTRA"]'));
  assert.doesNotMatch(codex.args.join(" "), /sk-test-123/, "secret values never reach argv");
  assert.deepEqual(codex.env, { API_KEY: "sk-test-123", EXTRA: "on" });
  assert.deepEqual(claudeServers(servers).files, {
    type: "stdio",
    command: "npx",
    args: ["-y", "other-mcp"],
    env: { API_KEY: "sk-test-123", EXTRA: "on" },
  });
  assert.equal(
    codexServerArgs([
      ...servers,
      { name: "dup", transport: "stdio", command: "x", args: [], env: { API_KEY: "different" } },
    ]).skipped[0],
    "dup",
  );
  await config.removeServer({ id: http.id });
  assert.equal((await new AgentToolConfig({ userData }).list()).servers.length, 1, "persisted");
});

test("autonomy: validation, decisions, summary and persistence per chat", async (t) => {
  assert.throws(
    () => normalizeAutonomy({ allowedTools: ["Bash"], deniedTools: ["Bash"] }),
    /both allowed and denied/,
  );
  assert.throws(() => normalizeAutonomy({ maxTurns: 0 }), /1 to 500/);
  assert.throws(() => normalizeAutonomy({ maxBudgetUsd: -1 }), /Budget/);
  assert.throws(() => normalizeAutonomy({ autoApprove: [{ tool: "Bash" }] }), /text to match/);
  const s = normalizeAutonomy({
    allowedTools: ["Read"],
    deniedTools: ["mcp__danger__*"],
    autoApprove: [{ tool: "Bash", match: "npm test" }],
    maxTurns: "12",
    maxBudgetUsd: "1.5",
    planFirst: true,
  });
  assert.deepEqual(autonomyDecision(s, "mcp__danger__drop", {}), {
    decision: "deny",
    reason: "mcp__danger__* is denied for this chat",
  });
  assert.equal(autonomyDecision(s, "Read", {}).decision, "allow");
  assert.equal(
    autonomyDecision(s, "Bash", { command: "npm test -- --watch=false" }).decision,
    "allow",
  );
  assert.equal(autonomyDecision(s, "Bash", { command: "rm -rf build" }), null);
  assert.equal(
    describeAutonomy(s, { access: "edit", account: "Client" }),
    "Edit access · account: Client · plan before edits · max 12 turns · budget $1.50 · allowed: Read · denied: mcp__danger__* · 1 auto-approve rule",
  );
  const userData = await temp(t, "autonomy-");
  const store = new AgentAutonomy({ userData });
  await store.set(CHAT, s);
  assert.deepEqual(await new AgentAutonomy({ userData }).get(CHAT), s);
  await store.set(CHAT, {});
  assert.equal(
    JSON.parse(await fs.readFile(path.join(userData, "agent-autonomy.json"), "utf8")).chats[CHAT],
    undefined,
    "defaults are not stored",
  );
  await assert.rejects(() => store.set("../x", {}), /Invalid chat/);

  const options = applyClaudePolicy(
    {
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      allowedTools: ["mcp__verynize__*"],
    },
    {
      account: { env: { CLAUDE_CONFIG_DIR: "/p" } },
      tools: {
        servers: [],
        permissions: [
          { tool: "WebFetch", decision: "deny" },
          { tool: "Read", decision: "deny" },
        ],
      },
      autonomy: s,
    },
  );
  assert.equal(options.permissionMode, "plan");
  assert.equal(options.allowDangerouslySkipPermissions, undefined);
  assert.deepEqual(options.allowedTools, ["mcp__verynize__*", "Read"]);
  assert.deepEqual(
    options.disallowedTools,
    ["WebFetch", "mcp__danger__*"],
    "a chat allow overrides a global deny",
  );
  assert.equal(options.maxTurns, 12);
  assert.equal(options.maxBudgetUsd, 1.5);
  assert.equal(options.env.CLAUDE_CONFIG_DIR, "/p");
  assert.deepEqual(
    applyCodexPlanFirst(
      { cwd: "/x", approvalPolicy: "never", sandbox: "danger-full-access", config: { a: 1 } },
      s,
    ),
    { cwd: "/x", approvalPolicy: "untrusted", sandbox: "read-only" },
  );
});

// --- runtime integration ------------------------------------------------------------------------
function scriptedClaude(record) {
  return {
    query({ prompt, options }) {
      record.options = options;
      const gen = (async function* () {
        const iterator = prompt[Symbol.asyncIterator]();
        await iterator.next();
        yield { type: "system", subtype: "init", session_id: "s1", model: "fake" };
        record.decisions = [];
        for (const [tool, input] of [
          ["Bash", { command: "npm test" }],
          ["Bash", { command: "rm -rf build" }],
          ["mcp__danger__drop", {}],
        ]) {
          if (options.permissionMode === "default")
            record.decisions.push(
              (
                await options.canUseTool(tool, input, {
                  signal: new AbortController().signal,
                  toolUseID: "tu-" + record.decisions.length,
                })
              ).behavior,
            );
        }
        yield {
          type: "result",
          subtype: "success",
          is_error: false,
          result: "ok",
          session_id: "s1",
          usage: { input_tokens: 1, output_tokens: 1 },
          total_cost_usd: 0.001,
        };
        await iterator.next();
      })();
      gen.interrupt = async () => {};
      gen.close = () => {};
      return gen;
    },
  };
}

async function runtimeSetup(t) {
  const root = await temp(t, "accounts-runtime-");
  const userData = path.join(root, "userData");
  const bin = path.join(root, "bin");
  await fs.mkdir(bin);
  const codex = path.join(bin, "codex");
  await fs.copyFile(path.join(__dirname, "fixtures/fake-codex.cjs"), codex);
  await fs.chmod(codex, 0o755);
  const log = path.join(root, "codex.log");
  process.env.FAKE_CODEX_LOG = log;
  const profiles = new AgentProfiles({ userData }),
    tools = new AgentToolConfig({ userData }),
    autonomy = new AgentAutonomy({ userData });
  const events = [],
    record = {};
  const runtime = new AgentRuntime({
    userData,
    home: path.join(root, "home"),
    profiles,
    tools,
    autonomy,
    discover: async () => [
      { id: "codex", available: true, path: codex },
      { id: "claude", available: true, path: "/usr/bin/true" },
    ],
    loadClaudeSdk: async () => scriptedClaude(record),
    getBridge: async () => null,
    loadPreferences: async () => [],
    emit: (event) => {
      events.push(event);
      if (event.type === "permission-request")
        setTimeout(
          () => runtime.respondPermission({ requestId: event.requestId, allow: false }),
          5,
        );
    },
  });
  t.after(() => runtime.close());
  const until = (predicate, label) =>
    new Promise((resolve, reject) => {
      const end = Date.now() + 8000;
      const poll = () => {
        const hit = events.find(predicate);
        if (hit) return resolve(hit);
        if (Date.now() > end)
          return reject(
            Error("Timed out: " + label + " " + JSON.stringify(events.map((e) => e.type))),
          );
        setTimeout(poll, 5);
      };
      poll();
    });
  return { root, userData, runtime, events, record, until, log, profiles, tools, autonomy };
}

test("runtime (Claude): the chat account, Verynize MCP servers and autonomy reach the SDK and the transcript", async (t) => {
  const { userData, runtime, events, record, until, profiles, tools, autonomy } =
    await runtimeSetup(t);
  const account = await profiles.add({ agent: "claude", name: "Client" });
  await profiles.setChat({ chatId: CHAT, agent: "claude", id: account.id });
  await tools.saveServer({
    name: "files",
    transport: "stdio",
    command: "node",
    args: ["server.js"],
    env: { FILES_KEY: "k1" },
  });
  await tools.setPermission({ tool: "WebFetch", decision: "deny" });
  await autonomy.set(CHAT, {
    deniedTools: ["mcp__danger__*"],
    autoApprove: [{ tool: "Bash", match: "npm test" }],
    maxTurns: 9,
    maxBudgetUsd: 2,
  });
  const started = await runtime.run({
    agent: "claude",
    chatId: CHAT,
    prompt: "Run the tests",
    access: "ask",
  });
  assert.deepEqual(started.account, { id: account.id, name: "Client" });
  await until((e) => e.type === "done", "done");
  const o = record.options;
  assert.equal(
    o.env.CLAUDE_CONFIG_DIR,
    path.join(userData, "agent-profiles", "claude", account.id),
  );
  assert.deepEqual(o.mcpServers.files, {
    type: "stdio",
    command: "node",
    args: ["server.js"],
    env: { FILES_KEY: "k1" },
  });
  assert.deepEqual(
    o.disallowedTools.filter((x) => ["WebFetch", "mcp__danger__*"].includes(x)),
    ["WebFetch", "mcp__danger__*"],
  );
  assert.equal(o.maxTurns, 9);
  assert.equal(o.maxBudgetUsd, 2);
  assert.equal(o.permissionMode, "default");
  // npm test auto-approved, rm asked (and declined by the user), the denied MCP tool refused without asking.
  assert.deepEqual(record.decisions, ["allow", "deny", "deny"]);
  assert.equal(events.filter((e) => e.type === "permission-request").length, 1);
  const auto = events.find((e) => e.type === "autonomy");
  assert.match(
    auto.text,
    /^Ask access · account: Client · max 9 turns · budget \$2\.00 · denied: mcp__danger__\* · 1 auto-approve rule$/,
  );
  assert.deepEqual(auto.servers, ["files"]);
  const policies = events.filter((e) => e.type === "policy");
  assert.deepEqual(
    policies.map((p) => [p.decision, p.toolName]),
    [
      ["allow", "Bash"],
      ["deny", "mcp__danger__drop"],
    ],
  );
  assert.ok(events.indexOf(auto) < events.findIndex((e) => e.type === "done"));

  // Plan before edits switches the SDK into plan mode for the next run.
  await autonomy.set(CHAT, { planFirst: true });
  await runtime.run({ agent: "claude", chatId: CHAT, prompt: "Refactor", access: "full" });
  await until(
    (e) => e.type === "done" && events.filter((x) => x.type === "done").length === 2,
    "second done",
  );
  assert.equal(record.options.permissionMode, "plan");
  assert.equal(record.options.allowDangerouslySkipPermissions, undefined);
  assert.match(record.options.systemPrompt.append, /Plan before editing/);
});

test("runtime (Codex): a named account gets its own app-server with CODEX_HOME; MCP servers, auto-approve and step limit apply", async (t) => {
  const { userData, runtime, events, until, log, profiles, tools, autonomy } =
    await runtimeSetup(t);
  const account = await profiles.add({ agent: "codex", name: "Side" });
  await tools.saveServer({
    name: "notes",
    transport: "stdio",
    command: "notes-mcp",
    args: ["--stdio"],
    env: { FAKE_MCP_SECRET: "value-123" },
  });
  await autonomy.set(CHAT, { autoApprove: [{ tool: "shell", match: "ls" }] });
  const first = await runtime.run({
    agent: "codex",
    chatId: CHAT,
    prompt: "please approve listing",
    access: "ask",
    account: account.id,
  });
  assert.equal(first.runtime, "codex-app-server");
  const done = await until((e) => e.type === "done", "done");
  assert.equal(done.code, 0);
  assert.match(
    events
      .filter((e) => e.type === "assistant-text-delta")
      .map((e) => e.text)
      .join(""),
    /declined=false/,
  );
  assert.equal(
    events.filter((e) => e.type === "permission-request").length,
    0,
    "auto-approved without a card",
  );
  assert.ok(
    events.some((e) => e.type === "policy" && e.decision === "allow" && e.toolName === "shell"),
  );
  const launches = (await fs.readFile(log, "utf8"))
    .trim()
    .split("\n")
    .map(JSON.parse)
    .filter((l) => l.args?.[0] === "app-server" && !l.args.includes("--help"));
  assert.equal(launches.length, 1);
  assert.equal(launches[0].codexHome, path.join(userData, "agent-profiles", "codex", account.id));
  assert.equal(launches[0].mcpEnv, "value-123", "the server secret travels in the environment");
  assert.ok(launches[0].args.includes('mcp_servers.notes.env_vars=["FAKE_MCP_SECRET"]'));
  assert.doesNotMatch(launches[0].args.join(" "), /value-123/);

  // The computer's own login runs on a separate server; a one-step limit stops the run after the second tool.
  await autonomy.set(CHAT, { maxTurns: 1 });
  events.length = 0;
  await runtime.run({ agent: "codex", chatId: CHAT, prompt: "list things", access: "edit" });
  await until((e) => e.type === "done", "limited done");
  const limit = events.find((e) => e.type === "policy" && e.decision === "limit");
  assert.match(limit.text, /at most 1 tool steps/);
  const all = (await fs.readFile(log, "utf8"))
    .trim()
    .split("\n")
    .map(JSON.parse)
    .filter((l) => l.args?.[0] === "app-server" && !l.args.includes("--help"));
  assert.equal(all.length, 2);
  assert.equal(all[1].codexHome, undefined);
  assert.equal(runtime.codexPool.size, 2);
});

test("runtime: a reported cost over the chat budget stops the run", async (t) => {
  const { runtime } = await runtimeSetup(t);
  let cancelled = 0;
  const emitted = [];
  const run = {
    id: "r",
    chatId: CHAT,
    agent: "claude",
    autonomy: normalizeAutonomy({ maxBudgetUsd: 0.5 }),
    cancel: () => {
      cancelled++;
    },
    sink: (e) => emitted.push(e),
  };
  runtime.forward(run, { type: "usage", costUsd: 0.2 });
  assert.equal(cancelled, 0);
  runtime.forward(run, { type: "usage", costUsd: 0.75 });
  runtime.forward(run, { type: "usage", costUsd: 0.9 });
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(cancelled, 1);
  assert.match(
    emitted.find((e) => e.type === "policy").text,
    /\$0\.75, over the chat budget of \$0\.50/,
  );
  assert.deepEqual(profileEnv("claude", "/x"), { CLAUDE_CONFIG_DIR: "/x" });
});

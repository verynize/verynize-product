// Settings › Usage and Memory (desktop/agent-usage.cjs, desktop/agent-memory.cjs).
// Provider responses are fixtures shaped like the real Claude Agent SDK `/usage` data and codex-cli 0.165
// app-server results; the Codex fetch talks to a scripted fake app-server. Home folders are temp dirs:
// no test reads the real ~/.claude or ~/.codex, and nothing goes to the network.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const usage = require("../desktop/agent-usage.cjs");
const memory = require("../desktop/agent-memory.cjs");
const { AgentRuntime, buildPersona } = require("../desktop/agent-runtime.cjs");

async function tempDir(t, prefix) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}
const write = async (file, text) => {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, text);
};

const CLAUDE_ACCOUNT = {
  email: "person@example.com",
  organization: "Example Org",
  subscriptionType: "Claude Team",
  apiProvider: "firstParty",
};
const CLAUDE_USAGE = {
  subscription_type: "team",
  rate_limits_available: true,
  rate_limits: {
    five_hour: { utilization: 4, resets_at: "2026-10-29T15:39:59.847917+00:00" },
    seven_day: null,
    seven_day_opus: { utilization: 12.34, resets_at: "2026-10-31T04:00:00+00:00" },
    seven_day_sonnet: null,
    model_scoped: [
      { display_name: "Fable", utilization: 0, resets_at: "2026-10-31T04:00:00+00:00" },
      { display_name: "Opus", utilization: 12, resets_at: null },
    ],
    extra_usage: {
      is_enabled: false,
      monthly_limit: null,
      used_credits: null,
      utilization: null,
      currency: null,
    },
  },
};
const CODEX_ACCOUNT = {
  account: { type: "chatgpt", email: "person@example.com", planType: "pro" },
  requiresOpenaiAuth: true,
};
const CODEX_LIMITS = {
  rateLimits: {
    limitId: "codex",
    primary: { usedPercent: 31, windowDurationMins: 10080, resetsAt: 1793775370 },
    secondary: null,
    credits: { hasCredits: true, unlimited: false, balance: "58949.8361375000" },
    planType: "pro",
  },
  rateLimitsByLimitId: {
    codex: {
      limitId: "codex",
      limitName: null,
      primary: { usedPercent: 31, windowDurationMins: 10080, resetsAt: 1793775370 },
      secondary: { usedPercent: 7, windowDurationMins: 300, resetsAt: 1793700000 },
      credits: { hasCredits: true, unlimited: false, balance: "58949.8361375000" },
      planType: "pro",
    },
  },
  rateLimitResetCredits: { availableCount: 2, credits: null },
};

// --- usage parsing -----------------------------------------------------------------------------
test("Claude /usage data becomes plan, account and per-window limits (5-hour, weekly per model, extra usage)", () => {
  const out = usage.parseClaudeUsage({ account: CLAUDE_ACCOUNT, usage: CLAUDE_USAGE });
  assert.equal(out.status, "ready");
  assert.equal(out.plan, "Team");
  assert.equal(out.email, "person@example.com");
  assert.equal(out.organization, "Example Org");
  assert.deepEqual(
    out.limits.map((l) => [l.label, l.usedPercent]),
    [
      ["5-hour limit", 4],
      ["Weekly limit · Opus", 12.3],
      ["Weekly limit · Fable", 0],
    ],
  );
  assert.equal(out.limits[0].resetsAt, Date.parse("2026-10-29T15:39:59.847917+00:00"));
  assert.deepEqual(out.extraUsage, { enabled: false });
  const on = usage.parseClaudeUsage({
    account: CLAUDE_ACCOUNT,
    usage: {
      ...CLAUDE_USAGE,
      rate_limits: {
        ...CLAUDE_USAGE.rate_limits,
        extra_usage: {
          is_enabled: true,
          monthly_limit: 5000,
          used_credits: 1250,
          utilization: 25,
          currency: "USD",
        },
      },
    },
  });
  assert.deepEqual(on.extraUsage, {
    enabled: true,
    used: 12.5,
    limit: 50,
    usedPercent: 25,
    currency: "USD",
  });
});

test("Claude usage: signed out, API key / Bedrock and missing limits are reported, not drawn as bars", () => {
  assert.equal(usage.parseClaudeUsage({ account: {}, usage: {} }).status, "signed-out");
  const bedrock = usage.parseClaudeUsage({ account: { apiProvider: "bedrock" }, usage: {} });
  assert.equal(bedrock.status, "unavailable");
  assert.match(bedrock.message, /Bedrock/);
  const apiKey = usage.parseClaudeUsage({
    account: { email: "a@b.c", apiKeySource: "ANTHROPIC_API_KEY", apiProvider: "firstParty" },
    usage: { subscription_type: null, rate_limits_available: false, rate_limits: null },
  });
  assert.equal(apiKey.status, "unavailable");
  assert.match(apiKey.message, /API key/);
  assert.deepEqual(apiKey.limits, []);
  assert.equal(usage.claudePlan("max"), "Max");
  assert.equal(usage.claudePlan(null, "Claude Pro"), "Pro");
});

test("Codex rate limits: plan, 5-hour before weekly, reset times in ms, credits and reset credits", () => {
  const out = usage.parseCodexUsage({ account: CODEX_ACCOUNT, limits: CODEX_LIMITS });
  assert.equal(out.status, "ready");
  assert.equal(out.plan, "Pro");
  assert.deepEqual(
    out.limits.map((l) => [l.label, l.usedPercent, l.resetsAt]),
    [
      ["5-hour limit", 7, 1793700000000],
      ["Weekly limit", 31, 1793775370000],
    ],
  );
  assert.deepEqual(out.credits, { hasCredits: true, unlimited: false, balance: 58949.8361375 });
  assert.equal(out.resetCredits, 2);
  // Older payload without rateLimitsByLimitId falls back to the single-bucket view.
  const single = usage.parseCodexUsage({
    account: CODEX_ACCOUNT,
    limits: { rateLimits: CODEX_LIMITS.rateLimits },
  });
  assert.deepEqual(
    single.limits.map((l) => l.label),
    ["Weekly limit"],
  );
  assert.equal(
    usage.parseCodexUsage({ account: { account: null, requiresOpenaiAuth: true } }).status,
    "signed-out",
  );
  assert.match(
    usage.parseCodexUsage({ account: { account: { type: "apiKey" } } }).message,
    /API key/,
  );
});

test("fetchClaudeUsage reads accountInfo and /usage from an idle SDK session and closes it", async () => {
  const seen = {};
  const sdk = {
    query({ prompt, options }) {
      seen.options = options;
      return {
        accountInfo: async () => CLAUDE_ACCOUNT,
        usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET: async (opts) => {
          seen.opts = opts;
          return CLAUDE_USAGE;
        },
        close: () => {
          seen.closed = true;
        },
        [Symbol.asyncIterator]: () => prompt[Symbol.asyncIterator](),
      };
    },
  };
  const out = await usage.fetchClaudeUsage({
    executable: "/fake/claude",
    loadSdk: async () => sdk,
    cwd: os.tmpdir(),
  });
  assert.equal(out.status, "ready");
  assert.equal(out.limits.length, 3);
  assert.deepEqual(seen.opts, { skipBehaviors: true });
  assert.equal(seen.options.pathToClaudeCodeExecutable, "/fake/claude");
  assert.equal(seen.options.persistSession, false);
  assert.ok(seen.closed);
  // An older Claude Code without the usage request still shows the account.
  const old = await usage.fetchClaudeUsage({
    loadSdk: async () => ({ query: () => ({ accountInfo: async () => CLAUDE_ACCOUNT }) }),
  });
  assert.equal(old.status, "unavailable");
  assert.equal(old.email, "person@example.com");
});

test("fetchCodexUsage speaks app-server JSON-RPC: initialize, account/read, account/rateLimits/read", async (t) => {
  const dir = await tempDir(t, "codex-usage-");
  const log = path.join(dir, "calls.log");
  const bin = path.join(dir, "codex");
  await fs.writeFile(
    bin,
    `#!/usr/bin/env node
const fs = require('node:fs');
const results = { initialize: { userAgent: 'fake' }, 'account/read': ${JSON.stringify(CODEX_ACCOUNT)}, 'account/rateLimits/read': ${JSON.stringify(CODEX_LIMITS)} };
let buf = '';
process.stdin.on('data', d => { buf += d; let i; while ((i = buf.indexOf('\\n')) >= 0) { const m = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1);
  fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({ method: m.method, params: m.params }) + '\\n');
  if (m.id !== undefined) process.stdout.write(JSON.stringify({ id: m.id, result: results[m.method] }) + '\\n'); } });
process.stdin.on('end', () => process.exit(0));
`,
  );
  await fs.chmod(bin, 0o755);
  const out = await usage.fetchCodexUsage({ executable: bin, timeout: 8000 });
  assert.equal(out.status, "ready");
  assert.equal(out.email, "person@example.com");
  assert.equal(out.limits.length, 2);
  const calls = (await fs.readFile(log, "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.deepEqual(
    calls.map((c) => c.method),
    ["initialize", "initialized", "account/read", "account/rateLimits/read"],
  );
  assert.deepEqual(calls[3].params, { excludeResetCreditDetails: true });
});

test("AgentUsage: missing CLI, provider errors and caching until refresh", async () => {
  let calls = 0;
  const service = new usage.AgentUsage({
    userData: os.tmpdir(),
    disabled: false,
    discover: async () => [
      { id: "claude", available: true, path: "/fake/claude" },
      { id: "codex", available: false, path: null },
    ],
    claude: async () => {
      calls++;
      if (calls === 2) throw Error("getaddrinfo ENOTFOUND api.anthropic.com");
      return usage.parseClaudeUsage({ account: CLAUDE_ACCOUNT, usage: CLAUDE_USAGE });
    },
  });
  const codex = await service.provider("codex");
  assert.equal(codex.status, "missing");
  const first = await service.provider("claude");
  assert.equal(first.status, "ready");
  assert.ok(first.updatedAt > 0);
  assert.equal(await service.provider("claude"), first); // cached
  assert.equal(calls, 1);
  const offline = await service.provider("claude", { refresh: true });
  assert.equal(offline.status, "error");
  assert.match(offline.message, /connection/);
  await assert.rejects(service.provider("gemini"), /Claude or Codex/);
});

test("AI-generated layers: new node ids are counted per local week", async (t) => {
  const dir = await tempDir(t, "layer-log-");
  const before = { pages: [{ id: "p", nodes: [{ id: "a" }, { id: "b" }] }] };
  const after = {
    pages: [
      { id: "p", nodes: [{ id: "a" }, { id: "c" }, { id: "d" }] },
      { id: "q", nodes: [{ id: "e" }] },
    ],
  };
  assert.equal(usage.countNewNodes(before, after), 3);
  assert.equal(usage.countNewNodes(after, before), 1);
  assert.equal(usage.countNewNodes(null, null), 0);
  const log = new usage.LayerLog(path.join(dir, "agent-usage.json"));
  const monday = new Date(2026, 9, 26, 10),
    thursday = new Date(2026, 9, 29, 18),
    nextMonday = new Date(2026, 10, 2, 9);
  assert.equal(usage.weekStart(thursday), "2026-10-26");
  assert.equal(usage.weekStart(new Date(2026, 10, 1, 23)), "2026-10-26"); // Sunday belongs to the same week
  await log.record(4, monday);
  await log.record(3, thursday);
  await log.record(0, thursday);
  let summary = await log.summary(thursday);
  assert.equal(summary.thisWeek, 7);
  assert.equal(summary.total, 7);
  assert.equal(summary.resetsAt, new Date(2026, 10, 2).getTime());
  await log.record(2, nextMonday);
  summary = await log.summary(nextMonday);
  assert.deepEqual([summary.thisWeek, summary.lastWeek, summary.total], [2, 7, 9]);
});

// --- memory --------------------------------------------------------------------------------------
test("Codex features.memories is read from tables, dotted keys and inline tables", () => {
  assert.equal(memory.codexMemoriesSetting(""), null);
  assert.equal(memory.codexMemoriesSetting("[features]\nmulti_agent = true\n"), null);
  assert.equal(
    memory.codexMemoriesSetting(
      'model = "x"\n[features]\nmemories = true # opted in\n[mcp_servers.a]\nmemories = false\n',
    ),
    true,
  );
  assert.equal(memory.codexMemoriesSetting("features.memories = false\n"), false);
  assert.equal(
    memory.codexMemoriesSetting("features = { multi_agent = true, memories = true }\n"),
    true,
  );
  assert.equal(memory.codexMemoriesSetting("[features]\n# memories = true\n"), null);
  assert.equal(memory.codexMemoriesSetting("[[profiles]]\nmemories = true\n"), null);
});

test("Memory overview counts Codex summaries and skills and lists repo-less Claude memory in temp folders", async (t) => {
  const home = await tempDir(t, "memory-home-");
  const userData = await tempDir(t, "memory-ud-");
  await write(path.join(home, ".codex/config.toml"), "[features]\nmemories = true\n");
  await write(path.join(home, ".codex/memories/rollout_summaries/one.md"), "# a");
  await write(path.join(home, ".codex/memories/rollout_summaries/two.md"), "# b");
  await write(path.join(home, ".codex/memories/rollout_summaries/notes.txt"), "ignored");
  await write(path.join(home, ".codex/memories/skills/deploy/SKILL.md"), "# deploy");
  await write(path.join(home, ".codex/memories/MEMORY.md"), "# index");
  await write(path.join(home, ".codex/AGENTS.md"), "Prefer pnpm.");
  await write(path.join(home, ".claude/projects/-repo-a/memory/MEMORY.md"), "# repo a");
  await fs.mkdir(path.join(home, ".claude/projects/-repo-b/memory"), { recursive: true });

  const first = await memory.memoryOverview({ userData, home, env: {} });
  const dir = first.repoLess.claude.dir;
  assert.ok(dir.startsWith(path.join(userData, "agent-memory") + path.sep));
  assert.equal(first.repoLess.claude.enabled, true);
  assert.deepEqual(first.repoLess.claude.files, []);
  assert.equal(
    (await memory.memoryOverview({ userData, home, env: {} })).repoLess.claude.dir,
    dir,
    "the folder id is stable",
  );
  await write(path.join(dir, "MEMORY.md"), "- user likes teal");
  const second = await memory.memoryOverview({ userData, home, env: {} });
  assert.deepEqual(
    second.repoLess.claude.files.map((f) => f.name),
    ["MEMORY.md"],
  );

  const codex = second.aboutYou.codex;
  assert.deepEqual(
    [codex.enabled, codex.configured, codex.summaries, codex.skills, codex.displayDir],
    [true, true, 2, 1, "~/.codex/memories"],
  );
  const claude = second.aboutYou.claude;
  assert.equal(claude.enabled, true);
  assert.equal(claude.userMemory.exists, false);
  assert.equal(claude.userMemory.displayPath, "~/.claude/CLAUDE.md");
  assert.equal(claude.projectsWithMemory, 1);
  assert.deepEqual(
    second.instructions.map((i) => [i.id, i.exists, i.displayPath]),
    [
      ["codexAgents", true, "~/.codex/AGENTS.md"],
      ["claudeUser", false, "~/.claude/CLAUDE.md"],
    ],
  );

  // Auto memory off (settings or env) and a custom folder.
  await write(
    path.join(home, ".claude/settings.json"),
    JSON.stringify({ autoMemoryEnabled: false, autoMemoryDirectory: "~/notes/claude" }),
  );
  await write(path.join(home, "notes/claude/topic.md"), "x");
  const off = await memory.memoryOverview({ userData, home, env: {} });
  assert.equal(off.repoLess.claude.enabled, false);
  assert.deepEqual(off.aboutYou.claude.autoMemoryDir, {
    path: path.join(home, "notes/claude"),
    displayPath: "~/notes/claude",
    files: 1,
  });
  await write(path.join(home, ".claude/settings.json"), "{}");
  assert.equal(
    (await memory.claudeAutoMemory({ home, env: { CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1" } }))
      .enabled,
    false,
  );
  assert.equal((await memory.claudeAutoMemory({ home, env: {} })).enabled, true);
  // Codex memories unset in config.
  await write(path.join(home, ".codex/config.toml"), 'model = "gpt"\n');
  const unset = (await memory.memoryOverview({ userData, home, env: {} })).aboutYou.codex;
  assert.deepEqual([unset.enabled, unset.configured], [false, false]);
});

test("Only known memory locations can be revealed or opened", async (t) => {
  const home = await tempDir(t, "memory-target-");
  const userData = await tempDir(t, "memory-target-ud-");
  const ctx = { userData, home };
  assert.equal(
    (await memory.targetPath({ kind: "codexAgents" }, ctx)).file,
    path.join(home, ".codex/AGENTS.md"),
  );
  assert.equal((await memory.targetPath({ kind: "claudeUser" }, ctx)).create, true);
  assert.ok(
    (await memory.targetPath({ kind: "repoLessFile", name: "MEMORY.md" }, ctx)).file.endsWith(
      `${path.sep}MEMORY.md`,
    ),
  );
  for (const bad of [
    { kind: "repoLessFile", name: "../../etc/passwd.md" },
    { kind: "repoLessFile", name: "x.sh" },
    { kind: "anything" },
    {},
  ])
    await assert.rejects(memory.targetPath(bad, ctx));
  await assert.rejects(
    memory.targetPath({ kind: "claudeAutoMemory" }, ctx),
    /No custom memory folder/,
  );
});

test("~/.codex/AGENTS.md is given to Claude Code chats, not duplicated, and never to Codex", async (t) => {
  const home = await tempDir(t, "memory-instr-");
  assert.equal(await memory.homeInstructions("claude", { home }), "");
  await write(path.join(home, ".codex/AGENTS.md"), "Always answer in British English.\n");
  assert.equal(
    await memory.homeInstructions("claude", { home }),
    "Always answer in British English.",
  );
  assert.equal(await memory.homeInstructions("codex", { home }), "");
  await write(path.join(home, ".claude/CLAUDE.md"), "See @~/.codex/AGENTS.md\n");
  assert.equal(
    await memory.homeInstructions("claude", { home }),
    "",
    "CLAUDE.md already imports it",
  );
  await write(path.join(home, ".claude/CLAUDE.md"), "Always answer in British English.");
  assert.equal(
    await memory.homeInstructions("claude", { home }),
    "",
    "same text is not added twice",
  );
  assert.match(
    buildPersona({ homeInstructions: "Use tabs." }),
    /~\/\.codex\/AGENTS\.md\):\nUse tabs\./,
  );
  assert.doesNotMatch(buildPersona({}), /AGENTS\.md/);
});

test("A quick Claude chat uses the shared repo-less memory folder and gets ~/.codex/AGENTS.md", async (t) => {
  const root = await tempDir(t, "memory-runtime-");
  const home = path.join(root, "home");
  await write(path.join(home, ".codex/AGENTS.md"), "Prefer small commits.");
  const record = {};
  const sdk = {
    query({ prompt, options }) {
      record.options = options;
      const gen = (async function* () {
        const iterator = prompt[Symbol.asyncIterator]();
        await iterator.next();
        yield { type: "system", subtype: "init", session_id: "s1", model: "fake" };
        yield {
          type: "result",
          subtype: "success",
          is_error: false,
          result: "ok",
          session_id: "s1",
          usage: { input_tokens: 1, output_tokens: 1 },
        };
        await iterator.next();
      })();
      gen.interrupt = async () => {};
      gen.close = () => {};
      return gen;
    },
  };
  const events = [];
  const runtime = new AgentRuntime({
    userData: path.join(root, "userData"),
    home,
    discover: async () => [
      { id: "claude", available: true, path: "/usr/bin/true" },
      { id: "codex", available: false, path: null },
    ],
    loadClaudeSdk: async () => sdk,
    getBridge: async () => null,
    loadPreferences: async () => [],
    emit: (e) => events.push(e),
  });
  t.after(() => runtime.close());
  const started = await runtime.run({
    agent: "claude",
    prompt: "remember teal",
    chatId: "11111111-2222-3333-4444-555555555555",
    root: null,
  });
  assert.equal(started.quickChat, true);
  const deadline = Date.now() + 8000;
  while (!events.some((e) => e.type === "done") && Date.now() < deadline)
    await new Promise((r) => setTimeout(r, 10));
  const expected = await memory.repoLessMemoryDir(path.join(root, "userData"));
  assert.deepEqual(record.options.settings, { autoMemoryDirectory: expected });
  assert.match(record.options.systemPrompt.append, /Prefer small commits\./);
  // A repository chat keeps Claude Code's per-repository memory.
  const project = path.join(root, "repo");
  await fs.mkdir(project);
  const repoRuntime = new AgentRuntime({
    userData: path.join(root, "userData"),
    home,
    getProject: () => ({ root: project }),
    discover: async () => [{ id: "claude", available: true, path: "/usr/bin/true" }],
    loadClaudeSdk: async () => sdk,
    getBridge: async () => null,
    loadPreferences: async () => [],
    emit: () => {},
  });
  t.after(() => repoRuntime.close());
  await repoRuntime.run({
    agent: "claude",
    prompt: "hi",
    chatId: "21111111-2222-3333-4444-555555555555",
  });
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(record.options.settings, undefined);
  assert.equal(record.options.cwd, project);
});

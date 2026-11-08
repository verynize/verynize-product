// Composer indicators, main-process side (desktop/agent-live-status.cjs + agent-runtime-events.cjs): MCP server status
// from a chat's open run (Claude SDK mcpServerStatus(), Codex mcpServerStatus/list), the configured fallback before the
// agent starts (fixture HOME, never the real ~/.claude or ~/.codex), streamed `mcp-status` events and the context breakdown.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { AgentLiveStatus, contextBreakdown } = require("../desktop/agent-live-status.cjs");
const { AgentTools } = require("../desktop/agent-tools.cjs");
const { createClaudeMapper, createCodexMapper } = require("../desktop/agent-runtime-events.cjs");

const runtimeWith = (...runs) => ({ runs: new Map(runs.map((r, i) => [`run-${i}`, r])) });

test("mcp-status events: Claude init mcp_servers and Codex startup updates are normalized", () => {
  const claude = createClaudeMapper()({
    type: "system",
    subtype: "init",
    session_id: "s1",
    mcp_servers: [
      { name: "verynize", status: "connected" },
      { name: "linear", status: "needs-auth" },
      { name: "rea", status: "pending" },
    ],
  });
  assert.deepEqual(
    claude.find((e) => e.type === "mcp-status"),
    {
      type: "mcp-status",
      agent: "claude",
      servers: [
        { name: "verynize", status: "connected" },
        { name: "linear", status: "needs-auth" },
        { name: "rea", status: "starting" },
      ],
    },
  );
  assert.equal(
    createClaudeMapper()({ type: "system", subtype: "init", session_id: "s2" }).some(
      (e) => e.type === "mcp-status",
    ),
    false,
    "no event without mcp_servers",
  );
  const codex = createCodexMapper()({
    method: "mcpServer/startupStatus/updated",
    params: {
      threadId: "t",
      name: "rea",
      status: "failed",
      error: "spawn rea ENOENT",
      failureReason: null,
    },
  });
  assert.deepEqual(codex, [
    {
      type: "mcp-status",
      agent: "codex",
      partial: true,
      servers: [{ name: "rea", status: "failed", error: "spawn rea ENOENT" }],
    },
  ]);
});

test("live status: an open Claude or Codex run answers with the runtime status, Verynize first", async () => {
  const claudeRun = {
    chatId: "chat-a",
    agent: "claude",
    done: false,
    mcpStatus: async () => [
      { name: "linear", status: "failed", error: "HTTP 500" },
      { name: "verynize", status: "connected", serverInfo: { name: "verynize", version: "1" } },
    ],
  };
  const codexRun = {
    chatId: "chat-b",
    agent: "codex",
    done: false,
    mcpStatus: async () => ({
      data: [
        {
          name: "figma",
          runtimeStatus: "authenticationRequired",
          authStatus: "notLoggedIn",
          toolsError: null,
        },
        { name: "verynize", runtimeStatus: "connected" },
        { name: "off", runtimeStatus: "disabled" },
        { name: "later", runtimeStatus: null, authStatus: "unsupported" },
      ],
      nextCursor: null,
    }),
  };
  const status = new AgentLiveStatus({
    getRuntime: () => runtimeWith(claudeRun, codexRun),
    tools: {
      listServers: async () => {
        throw Error("configured list must not be read for a live run");
      },
    },
  });
  assert.deepEqual(await status.mcp({ agent: "claude", chatId: "chat-a" }), {
    agent: "claude",
    live: true,
    servers: [
      { name: "verynize", status: "connected", builtIn: true },
      { name: "linear", status: "failed", error: "HTTP 500" },
    ],
  });
  assert.deepEqual((await status.mcp({ agent: "claude", chatId: "chat-b" })).servers, [
    { name: "verynize", status: "connected", builtIn: true },
    { name: "figma", status: "needs-auth" },
    { name: "off", status: "disabled" },
    { name: "later", status: "not-started" },
  ]);
});

test("configured fallback: Verynize plus the fixture HOME servers, all not started; a failing live query falls back", async (t) => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "live-status-"));
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  await fs.mkdir(path.join(home, ".codex"));
  await fs.writeFile(
    path.join(home, ".codex/config.toml"),
    '[mcp_servers.rea]\ncommand = "rea"\n\n[mcp_servers.old]\ncommand = "old"\nenabled = false\n',
  );
  await fs.writeFile(
    path.join(home, ".claude.json"),
    JSON.stringify({
      mcpServers: { context7: { type: "http", url: "https://example.invalid/mcp" } },
    }),
  );
  const saved = process.env.CODEX_HOME;
  delete process.env.CODEX_HOME;
  t.after(() => {
    if (saved !== undefined) process.env.CODEX_HOME = saved;
  });
  const tools = new AgentTools({ home, lookup: async () => null });
  const broken = {
    chatId: "chat-x",
    agent: "codex",
    done: false,
    mcpStatus: async () => {
      throw Error("Codex app-server is not running");
    },
  };
  const status = new AgentLiveStatus({ getRuntime: () => runtimeWith(broken), tools });
  assert.deepEqual(await status.mcp({ agent: "codex", chatId: "idle-chat" }), {
    agent: "codex",
    live: false,
    servers: [
      { name: "verynize", status: "not-started", builtIn: true },
      { name: "rea", status: "not-started" },
      { name: "old", status: "disabled" },
    ],
  });
  assert.deepEqual(
    (await status.mcp({ agent: "claude" })).servers.map((s) => s.name),
    ["verynize", "context7"],
  );
  const fallback = await status.mcp({ agent: "claude", chatId: "chat-x" });
  assert.equal(fallback.live, false);
  assert.equal(fallback.agent, "codex", "the run's agent decides which configuration is listed");
  assert.match(fallback.error, /not running/);
});

test("context breakdown: open Claude run only, deferred and empty rows dropped", async () => {
  const raw = {
    totalTokens: 106600,
    maxTokens: 1000000,
    rawMaxTokens: 1000000,
    percentage: 11,
    model: "claude-x",
    gridRows: [],
    memoryFiles: [],
    mcpTools: [],
    categories: [
      { id: "system_prompt", name: "System prompt", tokens: 3200, color: "x", kind: "used" },
      { id: "messages", name: "Messages", tokens: 90000, color: "x", kind: "used" },
      {
        id: "mcp_tools_deferred",
        name: "MCP tools (deferred)",
        tokens: 5000,
        color: "x",
        kind: "deferred",
        isDeferred: true,
      },
      { id: "skills", name: "Skills", tokens: 0, color: "x", kind: "used" },
      { id: "free_space", name: "Free space", tokens: 893400, color: "x", kind: "free" },
    ],
  };
  const run = { chatId: "chat-c", agent: "claude", done: false, contextUsage: async () => raw };
  const status = new AgentLiveStatus({ getRuntime: () => runtimeWith(run) });
  const out = await status.context({ chatId: "chat-c" });
  assert.deepEqual(out, contextBreakdown(raw));
  assert.deepEqual(
    out.categories.map((c) => c.name),
    ["System prompt", "Messages", "Free space"],
  );
  assert.equal(out.maxTokens, 1000000);
  assert.equal(await status.context({ chatId: "other" }), null);
  assert.equal(
    await new AgentLiveStatus({
      getRuntime: () =>
        runtimeWith({
          ...run,
          contextUsage: async () => {
            throw Error("closed");
          },
        }),
    }).context({ chatId: "chat-c" }),
    null,
  );
});

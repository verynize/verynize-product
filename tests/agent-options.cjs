const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { argumentsFor, start } = require("../desktop/agents.cjs");
const settings = require("../desktop/agent-settings.cjs");

test("four access levels map to Claude permission modes and Codex policies", () => {
  assert.deepEqual(settings.ACCESS_LEVELS, ["ask", "edit", "auto", "full"]);
  assert.deepEqual(settings.ACCESS_LEVELS.map(settings.claudePermissionMode), [
    "default",
    "acceptEdits",
    "auto",
    "bypassPermissions",
  ]);
  assert.deepEqual(settings.codexPolicy("ask"), {
    approvalPolicy: "untrusted",
    sandbox: "read-only",
  });
  assert.deepEqual(settings.codexPolicy("edit"), {
    approvalPolicy: "on-request",
    sandbox: "workspace-write",
  });
  assert.equal(settings.codexPolicy("auto").approvalsReviewer, "auto_review");
  assert.deepEqual(settings.codexPolicy("full"), {
    approvalPolicy: "never",
    sandbox: "danger-full-access",
  });
  // Older saved defaults keep working.
  assert.equal(settings.normalizeAccess("read-only"), "ask");
  assert.equal(settings.normalizeAccess("workspace-write"), "edit");
  assert.throws(() => settings.normalizeAccess("danger-full-access"), /Choose/);
  assert.throws(() => settings.normalizeOptions({ sessionId: "../etc" }), /session/);
});

test("fallback CLI argv carries model, effort, permissions, resume and MCP without shell expansion", () => {
  assert.deepEqual(
    argumentsFor("codex", { model: "custom-model", access: "ask", effort: "high" }),
    [
      "exec",
      "--skip-git-repo-check",
      "--sandbox",
      "read-only",
      "--model",
      "custom-model",
      "--config",
      'model_reasoning_effort="high"',
      "-",
    ],
  );
  assert.deepEqual(
    argumentsFor("claude", { model: "sonnet", access: "edit", effort: "medium", structured: true }),
    [
      "--print",
      "--permission-mode",
      "acceptEdits",
      "--model",
      "sonnet",
      "--effort",
      "medium",
      "--output-format",
      "stream-json",
      "--verbose",
      "--include-partial-messages",
    ],
  );
  assert.deepEqual(argumentsFor("claude", { access: "ask", sessionId: "abc-123" }).slice(0, 5), [
    "--print",
    "--permission-mode",
    "manual",
    "--resume",
    "abc-123",
  ]);
  const bridge = { url: "http://127.0.0.1:4555/mcp", token: "tok-secret" };
  const codex = argumentsFor("codex", { access: "full", bridge });
  assert.ok(codex.includes("danger-full-access"));
  assert.ok(codex.includes('mcp_servers.verynize.url="http://127.0.0.1:4555/mcp"'));
  assert.ok(codex.includes('mcp_servers.verynize.bearer_token_env_var="VERYNIZE_MCP_TOKEN"'));
  assert.doesNotMatch(codex.join(" "), /tok-secret/, "Codex token travels via env, not argv");
  const claude = argumentsFor("claude", { bridge });
  const config = JSON.parse(claude[claude.indexOf("--mcp-config") + 1]);
  assert.deepEqual(
    config.mcpServers["verynize"],
    {
      type: "http",
      url: bridge.url,
      headers: { Authorization: "Bearer tok-secret", "x-verynize-access": "edit" },
    },
    "the chat access level scopes the bridge shell tools",
  );
  assert.deepEqual(
    settings.codexMcpArgs({ url: "https://evil.example/mcp", token: "x" }),
    [],
    "only loopback bridges are wired",
  );
  assert.throws(() => argumentsFor("codex", { access: "danger-full-access" }));
  assert.throws(() => argumentsFor("codex", { model: "--inject arg" }));
});

test("design defaults: Opus 5.5 at high effort for Claude, Codex keeps its CLI default, all overridable", () => {
  assert.deepEqual(settings.withDefaults("claude", {}, {}), {
    model: "claude-opus-5-5",
    effort: "high",
  });
  assert.deepEqual(
    settings.withDefaults("claude", { model: "sonnet" }, {}),
    { model: "sonnet" },
    "a chosen model keeps its own effort default",
  );
  assert.deepEqual(settings.withDefaults("claude", { effort: "max" }, {}), {
    model: "claude-opus-5-5",
    effort: "max",
  });
  assert.deepEqual(settings.withDefaults("claude", { useDefaults: false }, {}), {
    useDefaults: false,
  });
  assert.deepEqual(settings.withDefaults("codex", {}, {}), {}, "Codex: no model unless configured");
  assert.deepEqual(
    settings.withDefaults("codex", {}, { VERYNIZE_DEFAULT_CODEX_MODEL: "gpt-5.5-codex" }),
    { model: "gpt-5.5-codex" },
  );
  assert.deepEqual(
    settings.withDefaults(
      "claude",
      {},
      { VERYNIZE_DEFAULT_CLAUDE_MODEL: "", VERYNIZE_DEFAULT_CLAUDE_EFFORT: "" },
    ),
    {},
    "env can disable defaults",
  );
  assert.deepEqual(
    settings.withDefaults("claude", {}, { VERYNIZE_DEFAULT_CLAUDE_MODEL: "claude-sonnet-5" }),
    { model: "claude-sonnet-5", effort: "high" },
  );
  const saved = process.env.VERYNIZE_DEFAULT_CLAUDE_MODEL;
  delete process.env.VERYNIZE_DEFAULT_CLAUDE_MODEL;
  try {
    assert.deepEqual(argumentsFor("claude", { access: "edit" }).slice(3), [
      "--model",
      "claude-opus-5-5",
      "--effort",
      "high",
    ]);
  } finally {
    if (saved !== undefined) process.env.VERYNIZE_DEFAULT_CLAUDE_MODEL = saved;
  }
  assert.ok(!argumentsFor("codex", { access: "edit" }).includes("--model"));
});

test("fallback runner streams typed events from a real temporary executable", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agent-fixture-"));
  try {
    const binary = path.join(root, "fixture");
    await fs.writeFile(
      binary,
      '#!/usr/bin/env node\nlet input="";process.stdin.on("data",d=>input+=d);process.stdin.on("end",()=>{const o=x=>console.log(JSON.stringify(x));o({type:"thread.started",thread_id:"t-1"});o({type:"item.started",item:{id:"c1",type:"command_execution",command:"ls"}});o({type:"item.completed",item:{id:"c1",type:"command_execution",aggregated_output:"a.txt",exit_code:0}});o({type:"item.completed",item:{type:"agent_message",text:input}});o({type:"turn.completed",usage:{input_tokens:4,output_tokens:3}});});',
    );
    await fs.chmod(binary, 0o755);
    const events = [];
    await new Promise((resolve, reject) => {
      start(
        binary,
        "codex",
        "hello",
        root,
        (event) => {
          events.push(event);
          if (event.type === "done") resolve();
          if (event.type === "error") reject(Error(event.text));
        },
        { structured: true },
      );
    });
    assert.ok(events.some((e) => e.type === "session" && e.sessionId === "t-1"));
    assert.ok(
      events.some(
        (e) => e.type === "tool-call" && e.toolName === "shell" && e.input.command === "ls",
      ),
    );
    assert.ok(
      events.some(
        (e) =>
          e.type === "tool-result" && e.toolCallId === "c1" && e.content === "a.txt" && !e.isError,
      ),
    );
    assert.ok(events.some((e) => e.type === "assistant-text" && e.text === "hello"));
    assert.ok(
      events.some(
        (e) =>
          e.type === "usage" &&
          e.usage.outputTokens === 3 &&
          e.outputTokens === 3 &&
          e.inputTokens === 4,
      ),
    );
    assert.deepEqual(events.at(-1), {
      id: events[0].id,
      type: "done",
      code: 0,
      stopped: false,
      sessionId: "t-1",
    });
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

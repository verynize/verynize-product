// Opt-in live validation of desktop/agent-runtime.cjs against the providers installed on this Mac.
// Skipped unless BD_LIVE_AGENTS=1. Each provider gets ONE trivial turn ("Reply with exactly
// VERYNIZE_OK") in a private temporary quick-chat folder, at Ask access with a small model and
// low effort, driven through the runtime module directly (no Electron, no UI). No project files or
// secrets are sent; the only tool server is a throwaway loopback MCP server started here, which
// proves the bridge wiring (URL + bearer token injection, tool discovery) without the app.
//
//   BD_LIVE_AGENTS=1 node --test tests/agent-runtime-live.cjs
//   BD_LIVE_AGENTS_ONLY=claude|codex          run one provider
//   BD_LIVE_AGENTS_REWIND=1                   also run one forked (rewound) turn per provider
//   BD_LIVE_CLAUDE_MODEL / BD_LIVE_CODEX_MODEL override the models (defaults: haiku / gpt-6-luna)
//
// Fork points are also checked without a model call: the Claude transcript must contain the
// reported `resumeAt` uuid, and Codex `thread/fork` must accept the reported turn id.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { AgentRuntime } = require("../desktop/agent-runtime.cjs");
const agents = require("../desktop/agents.cjs");

const LIVE = process.env.BD_LIVE_AGENTS === "1";
const ONLY = process.env.BD_LIVE_AGENTS_ONLY || "";
const REWIND = process.env.BD_LIVE_AGENTS_REWIND === "1";
const PROMPT = "Reply with exactly VERYNIZE_OK. Do not use tools.";
const MODELS = {
  claude: process.env.BD_LIVE_CLAUDE_MODEL || "haiku",
  codex: process.env.BD_LIVE_CODEX_MODEL || "gpt-6-luna",
};
const TURN_TIMEOUT = 180000;

/** Minimal Streamable-HTTP MCP server (JSON responses) with one harmless tool and bearer auth. */
async function startMcpServer() {
  const token = randomUUID();
  const log = { authorized: [], unauthorized: 0 };
  const server = http.createServer((req, res) => {
    if (req.headers.authorization !== `Bearer ${token}`) {
      log.unauthorized++;
      res.writeHead(401).end();
      return;
    }
    if (req.method !== "POST") {
      res.writeHead(405).end();
      return;
    }
    let body = "";
    req.on("data", (d) => {
      body += d;
    });
    req.on("end", () => {
      let parsed;
      try {
        parsed = JSON.parse(body);
      } catch {
        res.writeHead(400).end();
        return;
      }
      const replies = [];
      for (const message of Array.isArray(parsed) ? parsed : [parsed]) {
        log.authorized.push(message.method || "response");
        if (message.id === undefined || !message.method) continue;
        let result;
        if (message.method === "initialize")
          result = {
            protocolVersion: message.params?.protocolVersion || "2025-06-18",
            capabilities: { tools: {} },
            serverInfo: { name: "verynize-live-test", version: "0.0.0" },
          };
        else if (message.method === "tools/list")
          result = {
            tools: [
              {
                name: "live_ping",
                description: "Test-only tool. Returns pong. Never needed.",
                inputSchema: { type: "object", properties: {} },
              },
            ],
          };
        else if (message.method === "tools/call")
          result = { content: [{ type: "text", text: "pong" }] };
        else if (message.method === "ping") result = {};
        replies.push(
          result
            ? { jsonrpc: "2.0", id: message.id, result }
            : {
                jsonrpc: "2.0",
                id: message.id,
                error: { code: -32601, message: "Method not found" },
              },
        );
      }
      if (!replies.length) {
        res.writeHead(202).end();
        return;
      }
      res
        .writeHead(200, { "content-type": "application/json" })
        .end(JSON.stringify(Array.isArray(parsed) ? replies : replies[0]));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    bridge: { url: `http://127.0.0.1:${server.address().port}/mcp`, token },
    log,
    close: () => new Promise((r) => server.close(r)),
  };
}

/** Wraps the real SDK so the test can read the session's init message (MCP servers + tool list). */
function recordingSdk(record) {
  return async () => {
    const sdk = await import("@anthropic-ai/claude-agent-sdk");
    record.sdk = sdk;
    return {
      ...sdk,
      query(args) {
        record.options = args.options;
        const q = sdk.query(args);
        const iterator = {
          next: async () => {
            const step = await q.next();
            if (step.value?.type === "system" && step.value.subtype === "init")
              record.init = step.value;
            return step;
          },
          return: (value) => q.return(value),
          throw: (error) => q.throw(error),
          [Symbol.asyncIterator]() {
            return iterator;
          },
        };
        return new Proxy(q, {
          get: (target, prop) =>
            prop === Symbol.asyncIterator
              ? () => iterator
              : typeof target[prop] === "function"
                ? target[prop].bind(target)
                : target[prop],
        });
      },
    };
  };
}

async function setup(t, agent) {
  const found = (await agents.discover()).find((a) => a.id === agent);
  if (!found?.available) {
    t.skip(`${agent} CLI is not installed`);
    return null;
  }
  const userData = await fs.mkdtemp(path.join(os.tmpdir(), `bd-live-${agent}-`));
  const mcp = await startMcpServer();
  const events = [],
    record = {};
  const runtime = new AgentRuntime({
    userData,
    getProject: () => null, // quick chat: a private scratch folder under userData
    getBridge: async () => mcp.bridge,
    loadPreferences: async () => [],
    emit: (event) => events.push(event),
    ...(agent === "claude" ? { loadClaudeSdk: recordingSdk(record) } : {}),
  });
  t.after(async () => {
    runtime.close();
    await mcp.close();
    await fs.rm(userData, { recursive: true, force: true });
  });
  const waitDone = (runId) =>
    new Promise((resolve, reject) => {
      const end = Date.now() + TURN_TIMEOUT;
      const poll = () => {
        const done = events.find((e) => e.runId === runId && e.type === "done");
        if (done) return resolve(done);
        if (Date.now() > end) {
          runtime.cancel(runId);
          return reject(
            Error(
              "Live turn timed out: " +
                JSON.stringify(events.filter((e) => e.runId === runId).map((e) => e.type)),
            ),
          );
        }
        setTimeout(poll, 100);
      };
      poll();
    });
  return { runtime, events, record, mcp, waitDone, userData };
}

/** Shape checks shared by both providers. Returns the run's events. */
function assertTurn(events, started, chatId, label) {
  const mine = events.filter((e) => e.runId === started.id);
  const summary = mine.map((e) => e.type).join(",");
  for (const e of mine) {
    assert.equal(e.id, started.id, `${label}: event id is the run id`);
    assert.equal(e.chatId, chatId, `${label}: event chatId`);
    assert.ok(Number.isInteger(e.seq) && e.seq > 0, `${label}: integer seq`);
    assert.equal(typeof e.type, "string");
  }
  for (let i = 1; i < mine.length; i++)
    assert.ok(mine[i].seq > mine[i - 1].seq, `${label}: seq increases`);
  const errors = mine.filter((e) => e.type === "error").map((e) => e.text);
  assert.deepEqual(errors, [], `${label}: no error events (${summary})`);
  const done = mine.at(-1);
  assert.equal(done.type, "done", `${label}: done is last (${summary})`);
  assert.equal(done.code, 0, `${label}: exit code 0`);
  assert.equal(done.stopped, false);
  assert.ok(done.sessionId, `${label}: done carries the session id`);
  assert.ok(done.resumeAt, `${label}: done carries a resumeAt fork point`);
  assert.ok(
    mine.some((e) => e.type === "session" && e.sessionId === done.sessionId),
    `${label}: session event`,
  );
  const deltas = mine.filter((e) => e.type === "assistant-text-delta");
  assert.ok(deltas.length > 0, `${label}: streamed text deltas (${summary})`);
  const text = mine
    .filter((e) => e.type === "assistant-text-delta" || e.type === "assistant-text")
    .map((e) => e.text)
    .join("");
  const usage = mine.filter((e) => e.type === "usage" && (e.outputTokens > 0 || e.inputTokens > 0));
  assert.ok(usage.length > 0, `${label}: usage with token counts (${summary})`);
  assert.equal(
    mine.filter((e) => e.type === "permission-request").length,
    0,
    `${label}: no tool approval was needed`,
  );
  return { mine, done, text, usage: usage.at(-1) };
}

test(
  "live Claude turn through the Agent SDK runtime (BD_LIVE_AGENTS=1)",
  {
    skip: !LIVE || (ONLY && ONLY !== "claude") ? "set BD_LIVE_AGENTS=1" : false,
    timeout: TURN_TIMEOUT * 3,
  },
  async (t) => {
    const ctx = await setup(t, "claude");
    if (!ctx) return;
    const { runtime, events, record, mcp, waitDone } = ctx;
    const chatId = randomUUID();
    const started = await runtime.run({
      agent: "claude",
      chatId,
      prompt: PROMPT,
      access: "ask",
      model: MODELS.claude,
      effort: "low",
    });
    assert.equal(started.runtime, "claude-sdk");
    assert.equal(started.quickChat, true);
    assert.equal(started.mcp, true);
    await waitDone(started.id);
    const { done, text, usage } = assertTurn(events, started, chatId, "claude");
    assert.match(text, /VERYNIZE_OK/);
    t.diagnostic(
      `claude reply=${JSON.stringify(text.trim())} model=${record.init?.model} session=${done.sessionId} usage=${JSON.stringify(usage.usage)}`,
    );
    // Options reached the SDK as documented.
    assert.equal(record.options.permissionMode, "default");
    assert.equal(record.options.includePartialMessages, true);
    assert.equal(
      record.options.mcpServers["verynize"].headers.Authorization,
      `Bearer ${mcp.bridge.token}`,
    );
    // MCP bridge: the session connected with the bearer token and the agent sees the tool.
    const server = (record.init?.mcp_servers || []).find((s) => s.name === "verynize");
    assert.equal(
      server?.status,
      "connected",
      "verynize MCP server connected: " + JSON.stringify(record.init?.mcp_servers),
    );
    assert.ok(
      (record.init?.tools || []).includes("mcp__verynize__live_ping"),
      "agent tool list includes the bridge tool",
    );
    assert.ok(
      events.some((e) => e.type === "status" && /verynize: connected/.test(e.text)),
      "status names the bridge: " +
        JSON.stringify(events.filter((e) => e.type === "status").map((e) => e.text)),
    );
    assert.ok(
      mcp.log.authorized.includes("initialize") && mcp.log.authorized.includes("tools/list"),
      "authorized MCP handshake: " + mcp.log.authorized.join(","),
    );
    // Rewind fork point exists in the saved transcript (local read, no model call).
    const transcript = await record.sdk.getSessionMessages(done.sessionId, {
      dir: started.cwd,
      includeSystemMessages: true,
    });
    assert.ok(
      transcript.some((m) => m.uuid === done.resumeAt),
      "resumeAt is a transcript entry",
    );
    if (REWIND) {
      const rewound = await runtime.run({
        agent: "claude",
        chatId,
        prompt: "Reply with exactly VERYNIZE_FORK_OK. Do not use tools.",
        access: "ask",
        model: MODELS.claude,
        effort: "low",
        fork: { sessionId: done.sessionId, at: done.resumeAt },
        seed: "user: (fallback seed, unused when the fork works)",
      });
      assert.equal(rewound.rewound, true);
      assert.equal(rewound.seeded, false);
      await waitDone(rewound.id);
      const second = assertTurn(events, rewound, chatId, "claude fork");
      assert.notEqual(second.done.sessionId, done.sessionId, "the fork is a new session");
      assert.equal(record.options.resume, done.sessionId);
      assert.equal(record.options.resumeSessionAt, done.resumeAt);
      assert.equal(record.options.forkSession, true);
      assert.match(second.text, /VERYNIZE_FORK_OK/);
      t.diagnostic(
        `claude fork reply=${JSON.stringify(second.text.trim())} session=${second.done.sessionId}`,
      );
      await record.sdk.deleteSession?.(second.done.sessionId, { dir: rewound.cwd }).catch(() => {});
    }
    await record.sdk.deleteSession?.(done.sessionId, { dir: started.cwd }).catch(() => {});
  },
);

test(
  "live Codex turn through the app-server runtime (BD_LIVE_AGENTS=1)",
  {
    skip: !LIVE || (ONLY && ONLY !== "codex") ? "set BD_LIVE_AGENTS=1" : false,
    timeout: TURN_TIMEOUT * 3,
  },
  async (t) => {
    const ctx = await setup(t, "codex");
    if (!ctx) return;
    const { runtime, events, mcp, waitDone } = ctx;
    const chatId = randomUUID();
    const started = await runtime.run({
      agent: "codex",
      chatId,
      prompt: PROMPT,
      access: "ask",
      model: MODELS.codex,
      effort: "low",
    });
    assert.equal(started.runtime, "codex-app-server");
    assert.equal(started.mcp, true);
    await waitDone(started.id);
    const { done, text, usage } = assertTurn(events, started, chatId, "codex");
    assert.match(text, /VERYNIZE_OK/);
    t.diagnostic(
      `codex reply=${JSON.stringify(text.trim())} thread=${done.sessionId} turn=${done.resumeAt} usage=${JSON.stringify(usage.usage)}`,
    );
    // MCP bridge: app-server reached the loopback server with the env-provided bearer token.
    const rpc = runtime.codex.rpc;
    const status = await rpc.request(
      "mcpServerStatus/list",
      { threadId: done.sessionId, serverName: "verynize" },
      30000,
    );
    const server = (status?.data || []).find((s) => s.name === "verynize");
    assert.ok(
      server,
      "verynize is configured: " + JSON.stringify((status?.data || []).map((s) => s.name)),
    );
    assert.ok(
      (server.tools && Object.values(server.tools).some((tool) => tool?.name === "live_ping")) ||
        Object.keys(server.tools || {}).some((k) => /live_ping/.test(k)),
      "tool list includes the bridge tool: " +
        JSON.stringify(Object.keys(server.tools || {})) +
        " error=" +
        server.toolsError,
    );
    assert.ok(
      mcp.log.authorized.includes("initialize") && mcp.log.authorized.includes("tools/list"),
      "authorized MCP handshake: " + mcp.log.authorized.join(","),
    );
    assert.equal(mcp.log.unauthorized, 0, "every MCP request carried the bearer token");
    // Rewind fork point: thread/fork accepts the reported turn id (no model call).
    const forked = await rpc.request(
      "thread/fork",
      { threadId: done.sessionId, lastTurnId: done.resumeAt, excludeTurns: true, ephemeral: true },
      30000,
    );
    assert.ok(
      forked?.thread?.id && forked.thread.id !== done.sessionId,
      "thread/fork returns a new thread",
    );
    if (REWIND) {
      const rewound = await runtime.run({
        agent: "codex",
        chatId,
        prompt: "Reply with exactly VERYNIZE_FORK_OK. Do not use tools.",
        access: "ask",
        model: MODELS.codex,
        effort: "low",
        fork: { sessionId: done.sessionId, at: done.resumeAt },
        seed: "user: (fallback seed, unused when the fork works)",
      });
      assert.equal(rewound.rewound, true);
      assert.equal(rewound.seeded, false);
      await waitDone(rewound.id);
      const second = assertTurn(events, rewound, chatId, "codex fork");
      assert.notEqual(second.done.sessionId, done.sessionId, "the fork is a new thread");
      assert.match(second.text, /VERYNIZE_FORK_OK/);
      t.diagnostic(
        `codex fork reply=${JSON.stringify(second.text.trim())} thread=${second.done.sessionId}`,
      );
    }
  },
);

// Session runtime tests. Providers are deterministic fakes: a scripted Claude Agent SDK `query()`
// and tests/fixtures/fake-codex.cjs speaking the app-server JSON-RPC protocol. No models are called.
// Set VERYNIZE_REAL_AGENT_SMOKE=1 to additionally run a tiny real Claude SDK turn.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const {
  AgentRuntime,
  buildTurnContext,
  normalizeContext,
  claudeQueryOptions,
  buildPersona,
  createDesignTurnGuard,
  designHooks,
  toolOutcome,
  composePrompt,
  buildSeedBlock,
  claudeQuestions,
  claudeAnswerInput,
  codexQuestions,
  codexAnswers,
  normalizeAnswers,
  allowRuleFor,
  ruleMatches,
  AllowRules,
  heuristicTitle,
  cleanTitle,
  agentToolsVersion,
  normalizeFork,
  buildReviewTask,
  preferenceBlock,
  PREFERENCE_LIMITS,
  validPreference,
  normalizeDesignStyle,
  listDesignStyles,
  codexPreferenceConfig,
  PREFERENCE_BLOCKED_REASON,
} = require("../desktop/agent-runtime.cjs");
const agentAccess = require("../desktop/agent-access.cjs");
const { execFileSync } = require("node:child_process");
const {
  createClaudeMapper,
  createCodexMapper,
  claudeRateLimit,
  codexRateLimits,
} = require("../desktop/agent-runtime-events.cjs");

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const CHAT = "11111111-2222-3333-4444-555555555555";

function fakeClaudeSdk(record) {
  return {
    // Saved transcripts: session id -> chain entry uuids (getSessionMessages reads them locally).
    async getSessionMessages(sessionId, options) {
      record.sessionLookups = [...(record.sessionLookups || []), { sessionId, dir: options?.dir }];
      return ({ "sess-new": ["uuid-a1", "uuid-u1"] }[sessionId] || []).map((uuid) => ({
        type: "assistant",
        uuid,
        session_id: sessionId,
        message: {},
        parent_tool_use_id: null,
      }));
    },
    query({ prompt, options }) {
      record.options = options;
      let interrupted,
        interruptedPromise = new Promise((r) => {
          interrupted = r;
        });
      const gen = (async function* () {
        const iterator = prompt[Symbol.asyncIterator]();
        const first = (await iterator.next()).value;
        record.message = first;
        const text = first.message.content[0].text;
        const sid = options.forkSession ? "sess-fork" : options.resume || "sess-new";
        if (/Write a 3 to 6 word title/.test(text)) {
          record.titleOptions = options;
          yield { type: "system", subtype: "init", session_id: "t", model: options.model };
          yield {
            type: "result",
            subtype: "success",
            result: '"Blue Header Refresh."',
            session_id: "t",
          };
          return;
        }
        if (String(text).startsWith("REVIEW")) {
          record.reviewOptions = options;
          yield { type: "system", subtype: "init", session_id: "r", model: "fake-opus" };
          yield {
            type: "result",
            subtype: "success",
            result: "The header contrast is fine.",
            session_id: "r",
          };
          return;
        }
        yield {
          type: "system",
          subtype: "init",
          session_id: sid,
          model: "fake-sonnet",
          mcp_servers: options.mcpServers ? [{ name: "verynize", status: "connected" }] : [],
        };
        if (/slow/.test(text)) {
          yield {
            type: "stream_event",
            session_id: sid,
            event: {
              type: "content_block_delta",
              index: 0,
              delta: { type: "text_delta", text: "Starting…" },
            },
          };
          await interruptedPromise;
          yield {
            type: "result",
            subtype: "error_during_execution",
            is_error: true,
            session_id: sid,
          };
          return;
        }
        yield { type: "stream_event", session_id: sid, event: { type: "message_start" } };
        yield {
          type: "stream_event",
          session_id: sid,
          event: {
            type: "content_block_delta",
            index: 0,
            delta: { type: "thinking_delta", thinking: "Considering" },
          },
        };
        yield {
          type: "stream_event",
          session_id: sid,
          event: {
            type: "content_block_delta",
            index: 1,
            delta: { type: "text_delta", text: "Hel" },
          },
        };
        yield {
          type: "stream_event",
          session_id: sid,
          event: {
            type: "content_block_delta",
            index: 1,
            delta: { type: "text_delta", text: "lo" },
          },
        };
        yield {
          type: "stream_event",
          session_id: sid,
          event: {
            type: "content_block_start",
            index: 2,
            content_block: { type: "tool_use", id: "tu-1", name: "mcp__verynize__update_elements" },
          },
        };
        yield {
          type: "stream_event",
          session_id: sid,
          event: {
            type: "content_block_delta",
            index: 2,
            delta: { type: "input_json_delta", partial_json: '{"pageId":"p' },
          },
        };
        const input = { pageId: "page-1", edit: "x" };
        yield {
          type: "assistant",
          uuid: "uuid-a1",
          session_id: sid,
          message: {
            content: [
              { type: "text", text: "Hello" },
              { type: "tool_use", id: "tu-1", name: "mcp__verynize__update_elements", input },
            ],
          },
        };
        if (/question/.test(text))
          record.question = await options.canUseTool(
            "AskUserQuestion",
            {
              questions: [
                {
                  question: "Which accent color?",
                  header: "Accent",
                  multiSelect: false,
                  options: [
                    { label: "Teal", description: "Calm" },
                    { label: "Orange", description: "Loud" },
                  ],
                },
              ],
            },
            { signal: new AbortController().signal, toolUseID: "tu-q" },
          );
        if (/steer/.test(text)) {
          record.steer = (await iterator.next()).value;
          yield {
            type: "stream_event",
            session_id: sid,
            event: {
              type: "content_block_delta",
              index: 1,
              delta: { type: "text_delta", text: "!" },
            },
          };
        }
        let allowed = true;
        if (options.permissionMode === "default")
          allowed =
            (
              await options.canUseTool(
                "Bash",
                { command: "rm -rf build" },
                { signal: new AbortController().signal },
              )
            ).behavior === "allow";
        record.allowed = allowed;
        yield {
          type: "user",
          uuid: "uuid-u1",
          session_id: sid,
          message: {
            content: [
              {
                type: "tool_result",
                tool_use_id: "tu-1",
                content: [{ type: "text", text: "updated 1 element" }],
                is_error: false,
              },
            ],
          },
        };
        yield {
          type: "user",
          uuid: "uuid-sub",
          parent_tool_use_id: "tu-1",
          session_id: sid,
          message: { content: [] },
        };
        yield {
          type: "result",
          subtype: "success",
          is_error: false,
          result: "Hello",
          session_id: sid,
          usage: { input_tokens: 9, output_tokens: 2 },
          total_cost_usd: 0.001,
        };
        if (/steer/.test(text))
          yield {
            type: "system",
            subtype: "session_state_changed",
            state: "idle",
            session_id: sid,
          };
        // A real SDK keeps going until input ends; make sure the runtime ends input after `result`.
        await iterator.next();
      })();
      gen.interrupt = async () => {
        record.interrupted = true;
        interrupted();
      };
      gen.close = () => {};
      gen.supportedModels = async () => [
        {
          value: "sonnet",
          displayName: "Sonnet",
          description: "fixture",
          supportedEffortLevels: ["low", "high"],
        },
      ];
      return gen;
    },
  };
}

async function setup(t, extra = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agent-runtime-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const bin = path.join(root, "bin");
  await fs.mkdir(bin);
  const codex = path.join(bin, "codex");
  await fs.copyFile(path.join(__dirname, "fixtures/fake-codex.cjs"), codex);
  await fs.chmod(codex, 0o755);
  const log = path.join(root, "codex.log");
  process.env.FAKE_CODEX_LOG = log;
  const events = [],
    record = {};
  const runtime = new AgentRuntime({
    userData: path.join(root, "userData"),
    home: path.join(root, "home"), // shared agent memory is read from here, never the real HOME
    discover: async () => [
      { id: "codex", available: true, path: codex },
      { id: "claude", available: true, path: "/usr/bin/true" },
    ],
    loadClaudeSdk: async () => fakeClaudeSdk(record),
    getBridge: async () => extra.bridge ?? null,
    loadPreferences: async () => extra.preferences ?? [],
    emit: (event) => {
      events.push(event);
      if (extra.onEvent) extra.onEvent(event, runtime);
    },
    ...(extra.getProject ? { getProject: extra.getProject } : {}),
  });
  t.after(() => runtime.close());
  const until = (predicate, label = "event") =>
    new Promise((resolve, reject) => {
      const end = Date.now() + 8000;
      const poll = () => {
        const hit = events.find(predicate);
        if (hit) return resolve(hit);
        if (Date.now() > end)
          return reject(
            Error(
              "Timed out waiting for " + label + ": " + JSON.stringify(events.map((e) => e.type)),
            ),
          );
        setTimeout(poll, 5);
      };
      poll();
    });
  return { root, runtime, events, record, until, log };
}

test("turn context block lists document, page, selection ids and validated image paths only", () => {
  const ctx = normalizeContext(
    {
      documentName: "Landing <v2>",
      documentPath: "/tmp/a.design.json",
      pageId: "page-1",
      pageName: "Home",
      selection: ["n1", "bad id with spaces", "frame.abc"],
      images: ["/data/agent-attachments/c/x.png", "/etc/passwd"],
    },
    "/data/agent-attachments",
  );
  const block = buildTurnContext(ctx);
  assert.match(block, /^<verynize-context>/);
  assert.match(block, /Open document: "Landing  v2" saved at \/tmp\/a.design.json/);
  assert.match(block, /pageId page-1/);
  assert.match(block, /Selected element ids: n1, frame.abc\./);
  assert.match(block, /- \/data\/agent-attachments\/c\/x.png/);
  assert.doesNotMatch(block, /passwd|bad id/);
  assert.match(buildTurnContext(normalizeContext({ pageId: "p" }, "/x")), /nothing is selected/);
  assert.match(buildPersona({ bridge: true }), /verynize/);
  assert.match(buildPersona({ bridge: false }), /not connected/);
});

test("Claude SDK options: preset prompt + persona, partial messages, resume, permission modes and MCP bridge", () => {
  const bridge = { url: "http://127.0.0.1:9000/mcp", token: "abc" };
  const options = claudeQueryOptions({
    cwd: "/p",
    access: "full",
    model: "opus",
    effort: "high",
    sessionId: "s-1",
    persona: "P",
    bridge,
    executable: "/bin/claude",
  });
  assert.deepEqual(options.systemPrompt, { type: "preset", preset: "claude_code", append: "P" });
  assert.equal(options.includePartialMessages, true);
  assert.equal(options.permissionMode, "bypassPermissions");
  assert.equal(options.allowDangerouslySkipPermissions, true);
  assert.equal(options.resume, "s-1");
  assert.equal(options.pathToClaudeCodeExecutable, "/bin/claude");
  assert.deepEqual(options.mcpServers, {
    verynize: {
      type: "http",
      url: bridge.url,
      headers: { Authorization: "Bearer abc", "x-verynize-access": "full" },
    },
  });
  assert.deepEqual(options.allowedTools, ["mcp__verynize__*"]);
  const ask = claudeQueryOptions({ cwd: "/p", access: "ask", persona: "P" });
  assert.equal(ask.permissionMode, "default");
  assert.equal(ask.allowDangerouslySkipPermissions, undefined);
  assert.equal(ask.mcpServers, undefined);
});

test("Claude mapper does not duplicate streamed text and reports tool results", () => {
  const map = createClaudeMapper();
  const out = [
    ...map({
      type: "stream_event",
      event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hi" } },
    }),
    ...map({ type: "assistant", message: { content: [{ type: "text", text: "Hi" }] } }),
    ...map({ type: "result", subtype: "success", result: "Hi" }),
  ];
  assert.deepEqual(
    out.map((e) => e.type),
    ["assistant-text-delta", "turn-complete"],
  );
  const plain = createClaudeMapper();
  assert.deepEqual(
    plain({ type: "assistant", message: { content: [{ type: "text", text: "Full" }] } }),
    [{ type: "assistant-text", text: "Full" }],
  );
});

test("Claude session streams typed events, wires MCP, asks permission in Ask mode and resumes", async (t) => {
  const bridge = { url: "http://127.0.0.1:7777/mcp", token: "secret-token" };
  const { runtime, events, record, until } = await setup(t, {
    bridge,
    onEvent: (e, rt) => {
      if (e.type === "permission-request")
        setTimeout(() => rt.respondPermission({ requestId: e.requestId, allow: false }), 5);
    },
  });
  const image = await runtime.saveImage({
    chatId: CHAT,
    name: "shot.png",
    data: "data:image/png;base64," + PNG.toString("base64"),
  });
  assert.match(image.path, /agent-attachments/);
  await assert.rejects(
    () => runtime.saveImage({ chatId: CHAT, data: Buffer.from("not an image").toString("base64") }),
    /PNG/,
  );
  const started = await runtime.run({
    agent: "claude",
    chatId: CHAT,
    prompt: "Make the header blue",
    access: "ask",
    model: "sonnet",
    context: { documentName: "Doc", pageId: "page-1", selection: ["node-1"], images: [image.path] },
  });
  assert.equal(started.runtime, "claude-sdk");
  assert.equal(started.quickChat, true);
  assert.match(started.cwd, new RegExp("agent-workdirs/" + CHAT + "$"));
  const done = await until((e) => e.type === "done", "done");
  assert.equal(done.code, 0);
  assert.equal(done.sessionId, "sess-new");
  const types = events.map((e) => e.type);
  for (const type of [
    "session",
    "status",
    "thinking-delta",
    "assistant-text-delta",
    "tool-call",
    "tool-input-delta",
    "permission-request",
    "permission-resolved",
    "tool-result",
    "usage",
    "done",
  ])
    assert.ok(types.includes(type), "missing " + type);
  assert.equal(
    events.filter((e) => e.type === "assistant-text").length,
    0,
    "streamed text is not repeated",
  );
  assert.equal(
    events
      .filter((e) => e.type === "assistant-text-delta")
      .map((e) => e.text)
      .join(""),
    "Hello",
  );
  assert.ok(
    events.every((e) => e.id === started.id && e.chatId === CHAT && Number.isInteger(e.seq)),
  );
  assert.equal(record.allowed, false, "declined permission is passed back to the SDK");
  assert.equal(record.options.permissionMode, "default");
  assert.equal(record.options.mcpServers["verynize"].headers.Authorization, "Bearer secret-token");
  assert.equal(record.options.pathToClaudeCodeExecutable, "/usr/bin/true");
  assert.match(record.options.systemPrompt.append, /Verynize/);
  const content = record.message.message.content;
  assert.match(
    content[0].text,
    /<verynize-context>[\s\S]*pageId page-1[\s\S]*node-1[\s\S]*<\/verynize-context>\n\nMake the header blue$/,
  );
  assert.equal(content[1].type, "image");
  const toolCall = events.find((e) => e.type === "tool-call" && !e.partial);
  assert.equal(toolCall.title.startsWith("Canvas · update_elements"), true);
  // Continue the conversation: resume by session id.
  events.length = 0;
  await runtime.run({
    agent: "claude",
    chatId: CHAT,
    prompt: "And the footer",
    access: "edit",
    sessionId: done.sessionId,
  });
  const second = await until((e) => e.type === "done");
  assert.equal(record.options.resume, "sess-new");
  assert.equal(record.options.permissionMode, "acceptEdits");
  assert.equal(second.sessionId, "sess-new");
  assert.equal(record.options.model, "claude-opus-5-5", "design default model when none is chosen");
  assert.equal(record.options.effort, "high", "design default effort comes with the default model");
  // The Stop hook is wired when the canvas bridge is connected and enforces finish_artboard.
  for (const event of ["PostToolUse", "PostToolUseFailure", "Stop"])
    assert.equal(typeof record.options.hooks[event][0].hooks[0], "function", event);
  assert.equal(record.options.hooks.PostToolUse[0].matcher, "mcp__verynize__.*");
  const post = record.options.hooks.PostToolUse[0].hooks[0],
    stop = record.options.hooks.Stop[0].hooks[0];
  assert.deepEqual(
    await stop({ hook_event_name: "Stop", stop_hook_active: false }),
    {},
    "a turn without canvas edits may stop",
  );
  await post({
    hook_event_name: "PostToolUse",
    tool_name: "mcp__verynize__update_elements",
    tool_response: [{ type: "text", text: "1 of 1 directives applied." }],
  });
  assert.equal(
    (await stop({ hook_event_name: "Stop", stop_hook_active: false })).decision,
    "block",
  );
});

test("persona comes from the design knowledge layer and keeps user instructions and memory", () => {
  const persona = buildPersona({
    bridge: true,
    instructions: "Use British spelling",
    memory: "# Brand: teal",
  });
  assert.match(persona, /^You are the designer inside Verynize/);
  assert.match(persona, /get_skills/);
  assert.match(persona, /finish_artboard/);
  assert.match(persona, /Personal instructions from the user:\nUse British spelling/);
  assert.match(
    persona,
    /Project memory \(VERYNIZE\.md\):\n# Brand: teal\n\n<saved-design-preferences>/,
  );
  assert.match(
    persona,
    /<\/saved-design-preferences>$/,
    "the preferences block closes the persona",
  );
});

test("Stop hook guard: blocks once per unfinished canvas edit, never loops", () => {
  const tool = (name) => `mcp__verynize__${name}`;
  const guard = createDesignTurnGuard();
  assert.deepEqual(guard.stop({ stop_hook_active: false }), {}, "no edits: stop allowed");
  guard.toolResult(tool("get_design_context"));
  guard.toolResult(tool("update_elements"), { ok: false });
  assert.deepEqual(guard.stop({}), {}, "failed edits do not count");
  guard.toolResult("Bash");
  guard.toolResult(tool("create_artboard"));
  const blocked = guard.stop({ stop_hook_active: false });
  assert.equal(blocked.decision, "block");
  assert.match(blocked.reason, /finish_artboard/);
  assert.deepEqual(
    guard.stop({ stop_hook_active: true }),
    {},
    "no canvas progress since the block: let it stop",
  );
  guard.toolResult(tool("take_screenshot"));
  assert.equal(
    guard.stop({ stop_hook_active: true }).decision,
    "block",
    "progress but still unfinished: second block",
  );
  guard.toolResult(tool("take_screenshot"));
  assert.deepEqual(guard.stop({ stop_hook_active: true }), {}, "max two blocks per turn");

  const finished = createDesignTurnGuard();
  finished.toolResult(tool("update_elements"));
  finished.toolResult(
    tool("finish_artboard"),
    toolOutcome({
      isError: true,
      content: [{ type: "text", text: "Finish blocked for artboard bok (status: blocked)." }],
    }),
  );
  assert.equal(finished.stop({}).decision, "block", "a blocked finish does not count");
  finished.toolResult(
    tool("finish_artboard"),
    toolOutcome([{ type: "text", text: '{"status": "unverified"}' }]),
  );
  assert.deepEqual(
    finished.stop({ stop_hook_active: true }),
    {},
    "finish after the last edit ends the turn",
  );
  finished.toolResult(tool("delete_elements"));
  assert.equal(
    finished.stop({ stop_hook_active: false }).decision,
    "block",
    "an edit after finishing needs another finish",
  );

  assert.deepEqual(toolOutcome("plain"), { ok: true, text: "plain" });
  assert.equal(toolOutcome({ is_error: true, content: [] }).ok, false);
  assert.deepEqual(Object.keys(designHooks(createDesignTurnGuard())), [
    "PostToolUse",
    "PostToolUseFailure",
    "Stop",
  ]);
});

test("Claude stop interrupts the SDK query and reports a stopped turn", async (t) => {
  const { runtime, record, until } = await setup(t);
  const started = await runtime.run({
    agent: "claude",
    chatId: CHAT,
    prompt: "slow task",
    access: "edit",
  });
  await until((e) => e.type === "assistant-text-delta");
  assert.equal(runtime.cancel(started.id), true);
  const done = await until((e) => e.type === "done");
  assert.equal(record.interrupted, true);
  assert.deepEqual([done.code, done.stopped], [130, true]);
});

test("Codex app-server: thread/start, streaming, tool cards, approval, MCP flags, resume and interrupt", async (t) => {
  const bridge = { url: "http://127.0.0.1:7777/mcp", token: "codex-token" };
  const project = await fs.mkdtemp(path.join(os.tmpdir(), "codex-project-"));
  t.after(() => fs.rm(project, { recursive: true, force: true }));
  const { runtime, events, until, log } = await setup(t, {
    bridge,
    getProject: () => ({ root: project, memory: async () => "Use 8px grid" }),
    onEvent: (e, rt) => {
      if (e.type === "permission-request")
        rt.respondPermission({ requestId: e.requestId, allow: true });
    },
  });
  const started = await runtime.run({
    agent: "codex",
    chatId: CHAT,
    prompt: "please approve listing",
    access: "ask",
    model: "gpt-x",
    effort: "high",
  });
  assert.equal(started.runtime, "codex-app-server");
  assert.equal(started.cwd, project);
  const done = await until((e) => e.type === "done");
  assert.equal(done.code, 0);
  assert.equal(done.sessionId, "thr-1");
  const text = events
    .filter((e) => e.type === "assistant-text-delta")
    .map((e) => e.text)
    .join("");
  assert.match(text, /^Reply to .*please approve listing.*declined=false$/);
  assert.equal(events.filter((e) => e.type === "assistant-text").length, 0);
  assert.ok(events.some((e) => e.type === "thinking-delta" && e.text === "Plan the change."));
  assert.ok(events.some((e) => e.type === "tool-call" && e.toolName === "shell"));
  assert.ok(
    events.some(
      (e) =>
        e.type === "tool-call" &&
        e.toolName === "mcp__verynize__get_design_context" &&
        e.input.pageId === "page-1",
    ),
  );
  assert.ok(
    events.some(
      (e) => e.type === "tool-result" && e.toolCallId === "mcp-1" && e.content === "page ok",
    ),
  );
  assert.ok(events.some((e) => e.type === "permission-request" && e.toolName === "shell"));
  const calls = (await fs.readFile(log, "utf8")).trim().split("\n").map(JSON.parse);
  const launch = calls.find(
    (c) => c.args && c.args[0] === "app-server" && !c.args.includes("--help"),
  );
  assert.ok(launch.args.includes('mcp_servers.verynize.url="http://127.0.0.1:7777/mcp"'));
  assert.equal(launch.token, "codex-token");
  assert.doesNotMatch(JSON.stringify(launch.args), /codex-token/);
  const threadStart = calls.find((c) => c.rpc === "thread/start").params;
  assert.equal(threadStart.cwd, project);
  assert.equal(threadStart.approvalPolicy, "untrusted");
  assert.equal(threadStart.sandbox, "read-only");
  assert.equal(threadStart.model, "gpt-x");
  assert.match(threadStart.developerInstructions, /Use 8px grid/);
  assert.deepEqual(
    threadStart.config?.["mcp_servers.verynize.disabled_tools"],
    ["ask_agent", "save_design_preference", "update_design_preference", "delete_design_preference"],
    "Ask access blocks preference writes per thread",
  );
  assert.match(threadStart.developerInstructions, /read-only in this chat/);
  assert.equal(calls.find((c) => c.rpc === "turn/start").params.effort, "high");
  // Resume the same thread, then interrupt a slow turn.
  events.length = 0;
  const resumed = await runtime.run({
    agent: "codex",
    chatId: CHAT,
    prompt: "slow follow-up",
    access: "full",
    sessionId: "thr-1",
  });
  await until((e) => e.type === "assistant-text-delta");
  runtime.cancel(resumed.id);
  const stopped = await until((e) => e.type === "done");
  assert.deepEqual([stopped.code, stopped.stopped, stopped.sessionId], [130, true, "thr-1"]);
  const later = (await fs.readFile(log, "utf8")).trim().split("\n").map(JSON.parse);
  assert.equal(later.find((c) => c.rpc === "thread/resume").params.sandbox, "danger-full-access");
  assert.ok(later.some((c) => c.rpc === "turn/interrupt"));
  assert.equal(
    later.filter((c) => c.args && c.args[0] === "app-server" && !c.args.includes("--help")).length,
    1,
    "one app-server process serves both turns",
  );
  // Missing thread falls back to a fresh thread.
  events.length = 0;
  await runtime.run({
    agent: "codex",
    chatId: CHAT,
    prompt: "hello again",
    sessionId: "thr-missing",
  });
  const fresh = await until((e) => e.type === "done");
  assert.ok(events.some((e) => e.type === "status" && /new one/.test(e.text)));
  assert.equal(fresh.sessionId, "thr-2");
  assert.deepEqual(
    (await runtime.models({ agent: "codex" })).map((m) => m.id),
    ["fake-large"],
  );
  assert.deepEqual(
    (await runtime.models({ agent: "claude" })).map((m) => m.id),
    ["sonnet"],
  );
});

test("Codex without app-server falls back to the exec runner with the same events", async (t) => {
  process.env.FAKE_CODEX_NO_APP_SERVER = "1";
  t.after(() => {
    delete process.env.FAKE_CODEX_NO_APP_SERVER;
  });
  const { runtime, events, until } = await setup(t);
  const started = await runtime.run({
    agent: "codex",
    chatId: CHAT,
    prompt: "quick question",
    access: "edit",
  });
  assert.equal(started.runtime, "codex-exec");
  const done = await until((e) => e.type === "done");
  assert.equal(done.code, 0);
  const reply = events.find((e) => e.type === "assistant-text");
  assert.match(reply.text, /Exec reply ARGS .*workspace-write[\s\S]*quick question$/);
  assert.match(
    reply.text,
    /Do not repeat the same call[^\n]*\n\nquick question$/,
    "persona is prepended for exec",
  );
});

test(
  "optional real Claude SDK smoke (VERYNIZE_REAL_AGENT_SMOKE=1)",
  { skip: process.env.VERYNIZE_REAL_AGENT_SMOKE !== "1" },
  async (t) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "agent-smoke-"));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const events = [];
    const runtime = new AgentRuntime({
      userData: root,
      getBridge: async () => null,
      emit: (e) => events.push(e),
    });
    await runtime.run({
      agent: "claude",
      chatId: CHAT,
      prompt: "Reply with the single word: pong",
      access: "ask",
      model: "haiku",
    });
    await new Promise((resolve, reject) => {
      const end = Date.now() + 120000;
      const poll = () =>
        events.some((e) => e.type === "done")
          ? resolve()
          : Date.now() > end
            ? reject(Error("timeout"))
            : setTimeout(poll, 100);
      poll();
    });
    assert.equal(events.find((e) => e.type === "done").code, 0);
    assert.match(
      events
        .filter((e) => /assistant-text/.test(e.type))
        .map((e) => e.text)
        .join(""),
      /pong/i,
    );
  },
);

// --- chat parity: questions, steering, usage, always-allow, seeds, mentions, helpers -------------

test("question mapping: Claude AskUserQuestion and Codex requestUserInput share one renderer shape", () => {
  const input = {
    questions: [
      {
        question: "Which layout?",
        header: "Layout",
        multiSelect: true,
        options: [
          { label: "Grid", description: "Cards" },
          { label: "List", description: "Rows" },
        ],
      },
      { question: "", header: "x", options: [] },
    ],
  };
  const questions = claudeQuestions(input);
  assert.deepEqual(questions, [
    {
      id: "q1",
      question: "Which layout?",
      header: "Layout",
      options: [
        { label: "Grid", description: "Cards" },
        { label: "List", description: "Rows" },
      ],
      multiSelect: true,
    },
  ]);
  assert.deepEqual(claudeAnswerInput(input, questions, { q1: "Grid, List" }).answers, {
    "Which layout?": "Grid, List",
  });
  assert.equal(
    claudeAnswerInput(input, questions, {}).questions,
    input.questions,
    "original input is preserved",
  );
  const codex = codexQuestions({
    questions: [
      {
        id: "tone",
        header: "Tone",
        question: "Formal or casual?",
        options: [{ label: "Formal", description: "" }],
      },
      { id: "name", header: "Name", question: "Product name?", options: null, isSecret: true },
    ],
  });
  assert.deepEqual(codex, [
    { id: "tone", question: "Formal or casual?", header: "Tone", options: [{ label: "Formal" }] },
    { id: "name", question: "Product name?", header: "Name", secret: true },
  ]);
  assert.deepEqual(codexAnswers(codex, { tone: "Casual", name: "" }), {
    answers: { tone: { answers: ["Casual"] } },
  });
  assert.deepEqual(codexAnswers(codex, null), { answers: {} });
  assert.deepEqual(normalizeAnswers({ a: ["x", "y"], b: 3, "": "z", c: " " }), { a: "x, y" });
});

test("Claude AskUserQuestion becomes question-request and the answer goes back as updatedInput.answers", async (t) => {
  const { runtime, events, record, until } = await setup(t, {
    onEvent: (e, rt) => {
      if (e.type === "question-request")
        setTimeout(
          () =>
            rt.respondQuestion({
              runId: e.runId,
              requestId: e.requestId,
              answers: { q1: "Teal", bogus: "x" },
            }),
          5,
        );
    },
  });
  const started = await runtime.run({
    agent: "claude",
    chatId: CHAT,
    prompt: "question please",
    access: "full",
  });
  await until((e) => e.type === "done");
  const request = events.find((e) => e.type === "question-request");
  assert.equal(request.toolCallId, "tu-q");
  assert.equal(request.runId, started.id);
  assert.equal(request.conversationId, CHAT);
  assert.deepEqual(request.questions[0], {
    id: "q1",
    question: "Which accent color?",
    header: "Accent",
    options: [
      { label: "Teal", description: "Calm" },
      { label: "Orange", description: "Loud" },
    ],
  });
  assert.equal(record.question.behavior, "allow");
  assert.deepEqual(record.question.updatedInput.answers, { "Which accent color?": "Teal" });
  assert.deepEqual(events.find((e) => e.type === "question-resolved").answers, { q1: "Teal" });
  assert.ok(
    !events.some((e) => e.type === "permission-request"),
    "questions are not permission prompts",
  );
  // Stopping / cancelling answers with a deny the model can act on.
  events.length = 0;
  const cancelling = await setup(t, {
    onEvent: (e, rt) => {
      if (e.type === "question-request")
        rt.respondQuestion({ requestId: e.requestId, cancel: true });
    },
  });
  await cancelling.runtime.run({
    agent: "claude",
    chatId: CHAT,
    prompt: "question please",
    access: "full",
  });
  await cancelling.until((e) => e.type === "done");
  assert.equal(cancelling.record.question.behavior, "deny");
  assert.equal(cancelling.events.find((e) => e.type === "question-resolved").cancelled, true);
  assert.deepEqual(runtime.respondQuestion({ requestId: "nope", answers: {} }), {
    resolved: false,
  });
});

test("Codex item/tool/requestUserInput asks the user and answers in the app-server schema", async (t) => {
  const { runtime, events } = await setup(t, {
    onEvent: (e, rt) => {
      if (e.type === "question-request")
        rt.respondQuestion({ requestId: e.requestId, answers: { tone: "Casual" } });
    },
  });
  const run = { id: "run-q", chatId: CHAT, done: false, projectKey: "unattached" };
  const server = { threads: new Map([["thr-q", run]]), children: new Map() };
  const result = await runtime.codexRequest(server, {
    method: "item/tool/requestUserInput",
    params: {
      threadId: "thr-q",
      turnId: "t",
      itemId: "item-9",
      isBlocking: true,
      questions: [
        {
          id: "tone",
          header: "Tone",
          question: "Formal or casual?",
          options: [
            { label: "Formal", description: "Suits" },
            { label: "Casual", description: "Jeans" },
          ],
        },
      ],
    },
  });
  assert.deepEqual(result, { answers: { tone: { answers: ["Casual"] } } });
  const request = events.find((e) => e.type === "question-request");
  assert.equal(request.toolCallId, "item-9");
  assert.equal(request.questions[0].options[1].label, "Casual");
  // A finished run cancels pending questions.
  const pending = runtime.codexRequest(
    {
      threads: new Map([["thr-z", { id: "run-z", chatId: CHAT, done: false }]]),
      children: new Map(),
    },
    {
      method: "item/tool/requestUserInput",
      params: { threadId: "thr-z", questions: [{ id: "a", question: "A?", header: "A" }] },
    },
  );
  await new Promise((r) => setTimeout(r, 5));
  runtime.finish({ id: "run-z", chatId: CHAT, done: false });
  assert.deepEqual(await pending, { answers: {} });
});

test('steering: Claude yields a priority "next" user message into the open input; ended runs queue', async (t) => {
  const { runtime, events, record, until } = await setup(t);
  const started = await runtime.run({
    agent: "claude",
    chatId: CHAT,
    prompt: "steer me",
    access: "full",
  });
  assert.equal(started.steerable, true);
  await until((e) => e.type === "session");
  const steered = await runtime.steer({
    runId: started.id,
    text: "Make it bolder",
    mentions: [{ id: "n-7", label: "Hero title", pageId: "p1", type: "text" }],
  });
  assert.deepEqual(steered, { steered: true });
  const done = await until((e) => e.type === "done");
  assert.equal(done.code, 0);
  assert.equal(record.steer.priority, "next");
  assert.equal(record.steer.type, "user");
  assert.match(
    record.steer.message.content[0].text,
    /Referenced elements[\s\S]*"Hero title" \(id n-7, text, pageId p1\)[\s\S]*Make it bolder$/,
  );
  assert.ok(events.some((e) => e.type === "steer" && e.text === "Make it bolder"));
  assert.deepEqual(await runtime.steer({ runId: started.id, text: "late" }), {
    queued: true,
    reason: "not-running",
  });
  await assert.rejects(() => runtime.steer({ runId: started.id, text: "  " }), /Enter a message/);
});

test("steering: Codex uses turn/steer and falls back to queueing; exec runner queues", async (t) => {
  const { runtime, until, log } = await setup(t);
  const started = await runtime.run({
    agent: "codex",
    chatId: CHAT,
    prompt: "slow work",
    access: "full",
  });
  await until((e) => e.type === "assistant-text-delta");
  const result = await runtime.steer({ chatId: CHAT, text: "also add a footer" });
  assert.equal(result.queued, true, "fixture has no turn/steer: renderer must queue");
  const calls = (await fs.readFile(log, "utf8")).trim().split("\n").map(JSON.parse);
  const steer = calls.find((c) => c.rpc === "turn/steer");
  assert.equal(steer.params.threadId, "thr-1");
  assert.match(steer.params.expectedTurnId, /^turn-/);
  assert.equal(steer.params.input[0].text, "also add a footer");
  runtime.cancel(started.id);
  await until((e) => e.type === "done");
  process.env.FAKE_CODEX_NO_APP_SERVER = "1";
  t.after(() => {
    delete process.env.FAKE_CODEX_NO_APP_SERVER;
  });
  const exec = await setup(t);
  const run = await exec.runtime.run({
    agent: "codex",
    chatId: CHAT,
    prompt: "quick",
    access: "edit",
  });
  assert.equal(run.steerable, false);
  const queued = await exec.runtime
    .steer({ runId: run.id, text: "more" })
    .catch(() => ({ queued: true }));
  assert.equal(queued.queued, true);
  await exec.until((e) => e.type === "done");
});

test("usage events: Claude result/modelUsage/rate limits and Codex token usage/rate limits normalize to one shape", () => {
  const map = createClaudeMapper();
  map({
    type: "assistant",
    message: {
      usage: {
        input_tokens: 10,
        cache_read_input_tokens: 5000,
        cache_creation_input_tokens: 90,
        output_tokens: 7,
      },
      content: [],
    },
  });
  const [usage] = map({
    type: "result",
    subtype: "success",
    result: "x",
    usage: { input_tokens: 40, output_tokens: 120, cache_read_input_tokens: 9000 },
    total_cost_usd: 0.42,
    modelUsage: { "claude-opus-5-5": { contextWindow: 200000, inputTokens: 1, outputTokens: 1 } },
  });
  assert.deepEqual(usage, {
    type: "usage",
    usage: {
      inputTokens: 5100,
      outputTokens: 120,
      contextTokens: 5100,
      contextWindow: 200000,
      costUsd: 0.42,
    },
    inputTokens: 5100,
    outputTokens: 120,
    contextTokens: 5100,
    contextWindow: 200000,
    costUsd: 0.42,
  });
  const [limit] = map({
    type: "rate_limit_event",
    rate_limit_info: {
      status: "allowed_warning",
      rateLimitType: "five_hour",
      utilization: 0.83,
      resetsAt: 1900000000,
    },
  });
  assert.deepEqual(limit.rateLimit, [
    { label: "5-hour limit", usedPercent: 83, resetsAt: 1900000000000 },
  ]);
  assert.deepEqual(limit.usage, { rateLimit: limit.rateLimit });
  assert.deepEqual(claudeRateLimit({ status: "allowed" }), []);
  assert.deepEqual(map({ type: "system", subtype: "session_state_changed", state: "idle" }), [
    { type: "turn-idle" },
  ]);
  const codex = createCodexMapper();
  const [tokens] = codex({
    method: "thread/tokenUsage/updated",
    params: {
      threadId: "t",
      tokenUsage: {
        last: {
          inputTokens: 300,
          outputTokens: 20,
          totalTokens: 320,
          cachedInputTokens: 100,
          reasoningOutputTokens: 5,
        },
        total: {},
        modelContextWindow: 272000,
      },
    },
  });
  assert.deepEqual(tokens.usage, {
    inputTokens: 300,
    outputTokens: 20,
    contextTokens: 320,
    contextWindow: 272000,
  });
  const [limits] = codex({
    method: "account/rateLimits/updated",
    params: {
      rateLimits: {
        primary: { usedPercent: 12, windowDurationMins: 300, resetsAt: 1900000000 },
        secondary: { usedPercent: 40, windowDurationMins: 10080 },
      },
    },
  });
  assert.deepEqual(limits.rateLimit, [
    { label: "5-hour limit", usedPercent: 12, resetsAt: 1900000000000 },
    { label: "Weekly limit", usedPercent: 40 },
  ]);
  assert.deepEqual(codexRateLimits(null), []);
});

test("subagent nesting: Claude tool events carry parentToolCallId; Codex child threads nest under the collab call", () => {
  const map = createClaudeMapper();
  const call = map({
    type: "assistant",
    parent_tool_use_id: "task-1",
    message: {
      content: [{ type: "tool_use", id: "sub-1", name: "Read", input: { file_path: "/a" } }],
    },
  });
  assert.equal(call[0].parentToolCallId, "task-1");
  const result = map({
    type: "user",
    parent_tool_use_id: "task-1",
    message: { content: [{ type: "tool_result", tool_use_id: "sub-1", content: "ok" }] },
  });
  assert.equal(result[0].parentToolCallId, "task-1");
  const parent = createCodexMapper();
  const started = parent({
    method: "item/started",
    params: {
      item: {
        type: "collabAgentToolCall",
        id: "collab-1",
        tool: "spawnAgent",
        prompt: "look",
        receiverThreadIds: ["thr-child"],
        senderThreadId: "thr-1",
      },
    },
  });
  assert.deepEqual(
    started.map((e) => e.type),
    ["tool-call", "subagent-threads"],
  );
  assert.deepEqual(started[1].threadIds, ["thr-child"]);
  const child = createCodexMapper({ parentToolCallId: "collab-1" });
  const out = [
    ...child({ method: "item/agentMessage/delta", params: { delta: "child text" } }),
    ...child({
      method: "item/started",
      params: { item: { type: "commandExecution", id: "c-9", command: "ls" } },
    }),
    ...child({ method: "turn/completed", params: { turn: { status: "completed" } } }),
  ];
  assert.deepEqual(
    out.map((e) => [e.type, e.parentToolCallId]),
    [["tool-call", "collab-1"]],
    "child text and turn end stay out of the parent run",
  );
});

test("always allow: rules derive per tool, match patterns, persist per project and auto-allow later calls", async (t) => {
  assert.equal(allowRuleFor("Bash", { command: "npm run build" }), "Bash(npm run build)");
  assert.equal(allowRuleFor("Edit", { file_path: "/p/a.ts" }), "Edit");
  assert.equal(allowRuleFor("AskUserQuestion", {}), null);
  assert.equal(allowRuleFor("Bash", {}), null);
  assert.ok(ruleMatches("Bash(npm run build)", "Bash", { command: "npm run build" }));
  assert.ok(!ruleMatches("Bash(npm run build)", "Bash", { command: "npm run build && rm -rf /" }));
  assert.ok(ruleMatches("Bash(git status*)", "Bash", { command: "git status --short" }));
  assert.ok(ruleMatches("shell(ls (a))", "shell", { command: ["ls", "(a)"] }));
  assert.ok(ruleMatches("mcp__verynize__update_elements", "mcp__verynize__update_elements", {}));
  assert.ok(!ruleMatches("Edit", "Write", {}));
  assert.ok(
    !ruleMatches("Bash(a.c)", "Bash", { command: "abc" }),
    "pattern characters are literal",
  );

  const permissionEvents = [];
  const { runtime, events, record, until, root } = await setup(t, {
    onEvent: (e, rt) => {
      if (e.type === "permission-request") {
        permissionEvents.push(e);
        rt.respondPermission({ requestId: e.requestId, allow: true, always: true });
      }
    },
  });
  await runtime.run({ agent: "claude", chatId: CHAT, prompt: "first", access: "ask" });
  await until((e) => e.type === "done");
  assert.equal(record.allowed, true);
  assert.equal(permissionEvents.length, 1);
  assert.equal(permissionEvents[0].canAlwaysAllow, true);
  assert.deepEqual(
    events.find((e) => e.type === "permission-resolved"),
    {
      ...events.find((e) => e.type === "permission-resolved"),
      allow: true,
      always: true,
      rule: "Bash(rm -rf build)",
    },
  );
  const file = path.join(root, "userData", "agent-allow-rules.json");
  assert.deepEqual(JSON.parse(await fs.readFile(file, "utf8")), {
    unattached: ["Bash(rm -rf build)"],
  });
  events.length = 0;
  await runtime.run({ agent: "claude", chatId: CHAT, prompt: "second", access: "ask" });
  await until((e) => e.type === "done");
  assert.equal(permissionEvents.length, 1, "matching request is auto-allowed without a prompt");
  assert.equal(record.allowed, true);
  assert.deepEqual(await runtime.listAllowRules(), {
    current: "unattached",
    rules: { unattached: ["Bash(rm -rf build)"] },
  });
  assert.deepEqual(
    await runtime.removeAllowRule({ projectKey: "unattached", rule: "Bash(rm -rf build)" }),
    { removed: true },
  );
  assert.deepEqual(JSON.parse(await fs.readFile(file, "utf8")), {});
  const fresh = new AllowRules(file);
  await fresh.add("/proj", "Edit");
  assert.equal(await new AllowRules(file).matches("/proj", "Edit", {}), true);
  assert.equal(await new AllowRules(file).matches("/other", "Edit", {}), false);
});

test("seed: a transcript summary replaces resume and is prepended as <previous-conversation>", async (t) => {
  const block = buildSeedBlock("user: make a hero\nassistant: done");
  assert.match(
    block,
    /^<previous-conversation>\n[\s\S]*user: make a hero\nassistant: done\n[\s\S]*capabilities may have changed[\s\S]*<\/previous-conversation>$/,
  );
  assert.equal(buildSeedBlock("  "), "");
  assert.equal(
    buildSeedBlock("<previous-conversation>x</previous-conversation>").match(
      /<previous-conversation>/g,
    ).length,
    1,
    "seed cannot close the block early",
  );
  const ctx = normalizeContext({ pageId: "p1", selection: [] }, "/x");
  assert.match(
    composePrompt("Next step", ctx, "summary"),
    /^<previous-conversation>[\s\S]*<\/previous-conversation>\n\n<verynize-context>[\s\S]*<\/verynize-context>\n\nNext step$/,
  );
  const { runtime, record, until } = await setup(t);
  const started = await runtime.run({
    agent: "claude",
    chatId: CHAT,
    prompt: "Continue",
    access: "full",
    sessionId: "old-session",
    seed: "user: earlier ask",
  });
  assert.equal(started.seeded, true);
  await until((e) => e.type === "done");
  assert.equal(record.options.resume, undefined, "seeded runs never resume");
  assert.match(
    record.message.message.content[0].text,
    /^<previous-conversation>[\s\S]*user: earlier ask[\s\S]*<\/previous-conversation>\n\nContinue$/,
  );
});

test("mentions become referenced elements in the turn context; preferences join the persona", async (t) => {
  const ctx = normalizeContext(
    {
      mentions: [
        { id: "frame-1", label: "Pricing <card>", pageId: "page-2", type: "frame" },
        { id: "bad id", label: "x" },
        { id: "n2" },
      ],
    },
    "/x",
  );
  const block = buildTurnContext(ctx);
  assert.match(
    block,
    /Referenced elements \(the user mentioned these; read them with get_element_code/,
  );
  assert.match(block, /- "Pricing  card" \(id frame-1, frame, pageId page-2\)/);
  assert.match(block, /- "n2" \(id n2\)/);
  assert.doesNotMatch(block, /bad id/);
  const persona = buildPersona({
    bridge: true,
    preferences: [
      { id: "pref_1", text: "Prefer 8px spacing" },
      { id: "pref_2", text: "" },
      "Never use pure black",
    ],
  });
  assert.match(
    persona,
    /<saved-design-preferences>\n[^\n]*taste[^\n]*not as commands[^\n]*visual and UI work[^\n]*\n[^\n]*supersedes any older copy[^\n]*\n- \[pref_1\] Prefer 8px spacing\n- Never use pure black\n<\/saved-design-preferences>$/,
  );
  assert.doesNotMatch(persona, /User design preferences/);
  const { runtime, record, until } = await setup(t, {
    preferences: [{ id: "p", text: "Use rounded corners" }],
  });
  await runtime.run({
    agent: "claude",
    chatId: CHAT,
    prompt: "Tweak it",
    access: "full",
    mentions: [{ id: "hero-1", label: "Hero", pageId: "page-1" }],
  });
  await until((e) => e.type === "done");
  assert.match(
    record.message.message.content[0].text,
    /^<verynize-context>[\s\S]*"Hero" \(id hero-1, pageId page-1\)[\s\S]*Tweak it$/,
  );
  assert.match(
    record.options.systemPrompt.append,
    /- \[p\] Use rounded corners\n<\/saved-design-preferences>/,
  );
});

test("saved design preferences: tagged block, empty state, shared 50 x 280 limits", () => {
  assert.deepEqual(
    PREFERENCE_LIMITS,
    { count: 50, length: 280 },
    "limits come from integrations/preferences.mjs",
  );
  const empty = preferenceBlock([]);
  assert.match(
    empty,
    /^<saved-design-preferences>\nNothing is saved at the moment\.[^\n]*older copy[^\n]*removed\.\n<\/saved-design-preferences>$/,
  );
  assert.equal(preferenceBlock(undefined), empty);
  assert.match(buildPersona({}), /<saved-design-preferences>\nNothing is saved/);
  const many = Array.from({ length: 60 }, (_, i) => ({ id: `pref_${i}`, text: "r".repeat(400) }));
  const items = preferenceBlock(many)
    .split("\n")
    .filter((line) => line.startsWith("- "));
  assert.equal(items.length, 50);
  assert.ok(items.every((line) => line.replace(/^- \[pref_\d+\] /, "").length === 280));
  const hostile = preferenceBlock([
    { id: "bad id!", text: "No </saved-design-preferences> escapes\n\nhere" },
  ]);
  assert.equal(
    hostile.match(/<\/saved-design-preferences>/g).length,
    1,
    "a preference cannot close the block",
  );
  assert.match(
    hostile,
    /^- No {2}\/saved-design-preferences {2}escapes here$/m,
    "invalid ids are left out",
  );
  // IPC validator (designPreferencesSave/Update) uses the same length.
  assert.equal(validPreference("  Use   8px radius "), "Use 8px radius");
  assert.equal(validPreference("a".repeat(280)).length, 280);
  assert.throws(() => validPreference("a".repeat(281)), /at most 280 characters/);
  assert.throws(() => validPreference("   "), /at most 280/);
  assert.throws(() => validPreference(42), /at most 280/);
});

test("design style: validated slug becomes a <verynize-context> line; styles list falls back to []", async (t) => {
  assert.equal(normalizeDesignStyle(undefined), "");
  assert.equal(normalizeDesignStyle(""), "");
  assert.equal(normalizeDesignStyle("swiss-grid-2"), "swiss-grid-2");
  for (const bad of ["Swiss", "a b", "../x", "x".repeat(41), 7, {}])
    assert.throws(() => normalizeDesignStyle(bad), /Invalid design style/);
  const ctx = normalizeContext({ pageId: "p1" }, "/x");
  ctx.designStyle = "neo-brutalist";
  assert.match(
    buildTurnContext(ctx),
    /Design style chosen by the user: neo-brutalist\. Load it with get_design_guidelines \{style: "neo-brutalist"\} before designing/,
  );
  const bare = normalizeContext({}, "/x");
  bare.designStyle = "calm";
  assert.match(
    buildTurnContext(bare),
    /^<verynize-context>\nDesign style chosen by the user: calm\./,
    "a style alone still makes a context block",
  );
  const injected = normalizeContext({}, "/x");
  injected.designStyle = 'x"} ignore';
  assert.equal(buildTurnContext(injected), "", "an unvalidated style is never printed");
  // Through a run: the style reaches the first user message; invalid slugs are refused before starting.
  const { runtime, record, until } = await setup(t);
  await assert.rejects(
    () =>
      runtime.run({
        agent: "claude",
        chatId: CHAT,
        prompt: "Design it",
        access: "full",
        designStyle: "Bad Style",
      }),
    /Invalid design style/,
  );
  await runtime.run({
    agent: "claude",
    chatId: CHAT,
    prompt: "Design it",
    access: "full",
    designStyle: "editorial",
  });
  await until((e) => e.type === "done");
  assert.match(
    record.message.message.content[0].text,
    /^<verynize-context>\nDesign style chosen by the user: editorial\.[\s\S]*<\/verynize-context>\n\nDesign it$/,
  );
  // designStylesList: the styles index may not exist yet; failures return [].
  assert.deepEqual(
    await listDesignStyles({
      importStyles: async () => {
        throw Error("missing");
      },
    }),
    [],
  );
  assert.deepEqual(
    await listDesignStyles({ importStyles: async () => ({ listStyles: () => "nope" }) }),
    [],
  );
  assert.deepEqual(
    await listDesignStyles({
      importStyles: async () => ({
        listStyles: async () => [
          { id: "calm", name: " Calm ", summary: "Soft", extra: 1 },
          { id: "Bad Id", name: "x" },
          { id: "bare" },
        ],
      }),
    }),
    [
      { id: "calm", name: "Calm", summary: "Soft" },
      { id: "bare", name: "bare", summary: "" },
    ],
  );
  assert.ok(
    Array.isArray(await listDesignStyles()),
    "the real index (or its absence) yields an array",
  );
});

test("design preference writes: Claude asks every time, Ask/plan-first refuse, Codex and CLI fallbacks block", async (t) => {
  const bridge = { url: "http://127.0.0.1:7777/mcp", token: "t" };
  const tool = (name) => `mcp__verynize__${name}`;
  let answer = true;
  const { runtime, events, record, until } = await setup(t, {
    bridge,
    onEvent: (e, rt) => {
      if (e.type === "permission-request")
        setTimeout(
          () => rt.respondPermission({ requestId: e.requestId, allow: answer, always: true }),
          5,
        );
    },
  });
  // Edit access: an allow-all autonomy rule for the tool does not skip the approval card.
  await runtime.run({
    agent: "claude",
    chatId: CHAT,
    prompt: "remember it",
    access: "edit",
    autonomy: { allowedTools: [tool("save_design_preference")] },
  });
  await until((e) => e.type === "done");
  assert.match(
    record.options.systemPrompt.append,
    /Saved design preferences change only on the user's word/,
  );
  assert.match(
    record.options.systemPrompt.append,
    /tool refuses a call[\s\S]*Do not repeat the same call/,
  );
  const gate = record.options.hooks.PreToolUse.find(
    (h) => h.matcher && new RegExp(h.matcher).test(tool("save_design_preference")),
  );
  assert.ok(gate, "preference write PreToolUse hook");
  assert.ok(!new RegExp(gate.matcher).test(tool("list_design_preferences")), "reading stays free");
  assert.deepEqual(
    await gate.hooks[0]({ tool_name: tool("list_design_preferences"), tool_input: {} }, "tu-0", {}),
    {},
  );
  // A finished run's hook cannot ask; start a slow run so the approval card can be shown.
  events.length = 0;
  const slow = await runtime.run({
    agent: "claude",
    chatId: CHAT,
    prompt: "slow remember",
    access: "edit",
  });
  const live = record.options.hooks.PreToolUse.find(
    (h) => h.matcher && new RegExp(h.matcher).test(tool("save_design_preference")),
  ).hooks[0];
  const allowed = await live(
    { tool_name: tool("save_design_preference"), tool_input: { preference: "Use 8px radius" } },
    "tu-1",
    { signal: new AbortController().signal },
  );
  assert.equal(allowed.hookSpecificOutput.permissionDecision, "allow");
  const card = events.find(
    (e) => e.type === "permission-request" && e.toolName === tool("save_design_preference"),
  );
  assert.ok(card, "approval card shown");
  assert.equal(card.canAlwaysAllow, false, 'no "always allow" for preference writes');
  answer = false;
  const declined = await live(
    { tool_name: tool("delete_design_preference"), tool_input: { id: "pref_1" } },
    "tu-2",
    {},
  );
  assert.equal(declined.hookSpecificOutput.permissionDecision, "deny");
  assert.match(declined.hookSpecificOutput.permissionDecisionReason, /did not approve/);
  answer = true;
  assert.deepEqual(
    Object.values(await runtime.allowRules.list()).flat(),
    [],
    'no "always allow" rule was saved',
  );
  runtime.cancel(slow.id);
  await until((e) => e.type === "done");
  // Ask access and plan-first chats refuse without a card.
  for (const extra of [{ access: "ask" }, { access: "edit", autonomy: { planFirst: true } }]) {
    events.length = 0;
    await runtime.run({ agent: "claude", chatId: CHAT, prompt: "remember", ...extra });
    await until((e) => e.type === "done");
    assert.match(
      record.options.systemPrompt.append,
      /Saved design preferences are read-only in this chat/,
    );
    const hook = record.options.hooks.PreToolUse.find(
      (h) => h.matcher && new RegExp(h.matcher).test(tool("update_design_preference")),
    ).hooks[0];
    const out = await hook(
      {
        tool_name: tool("update_design_preference"),
        tool_input: { id: "pref_1", preference: "x" },
      },
      "tu-3",
      {},
    );
    assert.deepEqual(out.hookSpecificOutput, {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: PREFERENCE_BLOCKED_REASON,
    });
    assert.ok(
      !events.some(
        (e) => e.type === "permission-request" && e.toolName === tool("update_design_preference"),
      ),
      "no card in " + JSON.stringify(extra),
    );
  }
  // Codex: blocked chats disable the write tools in the thread config; approve chats rely on the persona rule.
  const blocked = codexPreferenceConfig(
    { cwd: "/p", config: { a: 1 } },
    { preferenceWrites: "blocked", bridge, agentSettings: { askAgents: false } },
  );
  assert.deepEqual(blocked.config, {
    a: 1,
    "mcp_servers.verynize.disabled_tools": ["ask_agent", ...agentAccess.PREFERENCE_WRITE_TOOLS],
  });
  assert.deepEqual(codexPreferenceConfig({ cwd: "/p" }, { preferenceWrites: "approve", bridge }), {
    cwd: "/p",
  });
  assert.deepEqual(
    codexPreferenceConfig({ cwd: "/p" }, { preferenceWrites: "blocked", bridge: null }),
    { cwd: "/p" },
  );
  // One-shot fallbacks cannot show a card: the tools are removed.
  assert.ok(
    agentAccess
      .claudeAccessOptions(agentAccess.ACCESS_DEFAULTS, { blockPreferenceWrites: true })
      .cliArgs.includes("mcp__verynize__save_design_preference"),
  );
  assert.match(
    agentAccess
      .codexAccessArgs(agentAccess.ACCESS_DEFAULTS, { bridge: true, blockPreferenceWrites: true })
      .join(" "),
    /disabled_tools=\["ask_agent","save_design_preference","update_design_preference","delete_design_preference"\]/,
  );
  assert.equal(agentAccess.preferenceWritePolicy({ access: "full" }), "approve");
  for (const blockedRun of [
    { access: "ask" },
    { access: "edit", planFirst: true },
    { access: "full", helper: true },
    { access: "edit", interactive: false },
  ])
    assert.equal(agentAccess.preferenceWritePolicy(blockedRun), "blocked");
});

test("parallel runs: up to three chats run at once and every event names its run and conversation", async (t) => {
  const { runtime, events, until } = await setup(t);
  const chats = ["aaaaaaaa-1111", "bbbbbbbb-2222", "cccccccc-3333"];
  const runs = await Promise.all(
    chats.map((chatId) =>
      runtime.run({ agent: "claude", chatId, prompt: "slow task", access: "full" }),
    ),
  );
  await assert.rejects(
    () => runtime.run({ agent: "claude", chatId: "dddddddd-4444", prompt: "x" }),
    /Three agents/,
  );
  assert.deepEqual(
    runtime
      .list()
      .map((r) => r.chatId)
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
    chats,
  );
  for (const run of runs) runtime.cancel(run.id);
  await until(() => events.filter((e) => e.type === "done").length === 3, "three done events");
  for (const run of runs)
    assert.ok(
      events
        .filter((e) => e.runId === run.id)
        .every(
          (e) => e.id === run.id && e.conversationId === run.chatId && e.chatId === run.chatId,
        ),
    );
});

test("helpers: ask_agent runs read-only, titles fall back to a heuristic, tools version is stable", async (t) => {
  const { runtime, record } = await setup(t);
  const answer = await runtime.ask({ agent: "claude", task: "REVIEW the hero section" });
  assert.deepEqual(answer, {
    text: "The header contrast is fine.",
    agent: "claude",
    model: "fake-opus",
  });
  const options = record.reviewOptions;
  assert.equal(options.permissionMode, "default");
  assert.deepEqual(options.tools, ["Read", "Glob", "Grep"]);
  for (const tool of [
    "Write",
    "Edit",
    "Bash",
    "mcp__verynize__update_elements",
    "mcp__verynize__ask_agent",
    "mcp__verynize__run_terminal_command",
    "mcp__verynize__preview_click",
    "mcp__verynize__execute_action",
  ])
    assert.ok(options.disallowedTools.includes(tool), tool);
  if (options.mcpServers)
    assert.equal(
      options.mcpServers["verynize"].headers["x-verynize-access"],
      "readonly",
      "the helper reaches the bridge as read-only",
    );
  assert.equal((await options.canUseTool("Write", {}, {})).behavior, "deny");
  assert.equal(options.persistSession, false);
  await assert.rejects(() => runtime.ask({ agent: "gemini", task: "x" }), /agent must be/);
  const codexAnswer = await runtime.ask({ agent: "codex", task: "Check the copy" });
  assert.match(codexAnswer.text, /^Reply to .*Check the copy/);
  assert.equal(codexAnswer.agent, "codex");

  const title = await runtime.title({
    agent: "claude",
    text: "Make the header blue and the footer smaller please",
  });
  assert.deepEqual(title, {
    title: "Blue Header Refresh",
    source: "claude",
    model: "claude-haiku-5-5",
  });
  assert.equal(record.titleOptions.model, "claude-haiku-5-5");
  assert.equal(record.titleOptions.effort, "low");
  assert.deepEqual(record.titleOptions.tools, []);
  const missing = new AgentRuntime({
    userData: path.join(os.tmpdir(), "unused-" + process.pid),
    discover: async () => [{ id: "claude", available: false, path: null }],
    loadClaudeSdk: async () => {
      throw Error("must not load");
    },
  });
  assert.deepEqual(
    await missing.title({
      agent: "claude",
      text: "Design a **pricing** page for <b>startups</b> today now",
    }),
    { title: "Design a pricing page for startups", source: "heuristic" },
  );
  assert.equal(heuristicTitle(""), "New chat");
  assert.equal(cleanTitle('Title: "Pricing Page Ideas."\nextra'), "Pricing Page Ideas");
  assert.equal(
    cleanTitle("This is far too long to be a sensible short title for any chat at all"),
    "",
  );

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "tools-version-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  await fs.writeFile(path.join(dir, "design-tools.mjs"), "a");
  const hashed = await agentToolsVersion({ importTools: async () => ({}), root: dir });
  assert.match(hashed, /^sha256-[0-9a-f]{16}$/);
  assert.equal(await agentToolsVersion({ importTools: async () => ({}), root: dir }), hashed);
  await fs.writeFile(path.join(dir, "design-edit.mjs"), "b");
  assert.notEqual(await agentToolsVersion({ importTools: async () => ({}), root: dir }), hashed);
  assert.equal(
    await agentToolsVersion({ importTools: async () => ({ TOOLS_VERSION: "7" }), root: dir }),
    "7",
  );
  assert.equal(typeof (await agentToolsVersion()), "string");
});

// --- rewind (provider session forks) and second-opinion review -----------------------------------

test("rewind: fork points validate and map to Claude resume + resumeSessionAt + forkSession", () => {
  assert.deepEqual(normalizeFork({ sessionId: "sess-1", at: "uuid-1", extra: 1 }), {
    sessionId: "sess-1",
    at: "uuid-1",
  });
  for (const bad of [
    null,
    "x",
    {},
    { sessionId: "a b", at: "u" },
    { sessionId: "s", at: "" },
    { sessionId: "s", at: "x".repeat(201) },
  ])
    assert.equal(normalizeFork(bad), null);
  const options = claudeQueryOptions({
    cwd: "/p",
    access: "ask",
    persona: "P",
    sessionId: "ignored",
    fork: { sessionId: "sess-1", at: "uuid-1" },
  });
  assert.deepEqual(
    [options.resume, options.resumeSessionAt, options.forkSession],
    ["sess-1", "uuid-1", true],
  );
  const plain = claudeQueryOptions({ cwd: "/p", access: "ask", persona: "P", sessionId: "sess-2" });
  assert.deepEqual(
    [plain.resume, plain.resumeSessionAt, plain.forkSession],
    ["sess-2", undefined, undefined],
  );
});

test("rewind (Claude): done reports the last main-chain entry; a fork resumes a copy cut there, else falls back to the seed", async (t) => {
  const { runtime, events, record, until } = await setup(t);
  await runtime.run({ agent: "claude", chatId: CHAT, prompt: "First turn", access: "full" });
  const first = await until((e) => e.type === "done");
  assert.deepEqual(
    [first.sessionId, first.resumeAt],
    ["sess-new", "uuid-u1"],
    "subagent entries are not fork points",
  );
  events.length = 0;
  const forked = await runtime.run({
    agent: "claude",
    chatId: CHAT,
    prompt: "Second take",
    access: "full",
    sessionId: "sess-new",
    fork: { sessionId: "sess-new", at: "uuid-a1" },
    seed: "user: First turn",
  });
  assert.deepEqual([forked.rewound, forked.seeded], [true, false]);
  const second = await until((e) => e.type === "done");
  assert.deepEqual(
    [record.options.resume, record.options.resumeSessionAt, record.options.forkSession],
    ["sess-new", "uuid-a1", true],
  );
  assert.equal(
    record.message.message.content[0].text,
    "Second take",
    "a working fork carries the history; no seed is prepended",
  );
  assert.equal(second.sessionId, "sess-fork");
  assert.deepEqual(
    record.sessionLookups.at(-1),
    { sessionId: "sess-new", dir: forked.cwd },
    "the fork point is checked in the transcript of the chat folder",
  );
  // Unknown fork point (e.g. the transcript was deleted): fresh session seeded from the transcript.
  events.length = 0;
  const fallback = await runtime.run({
    agent: "claude",
    chatId: CHAT,
    prompt: "Third take",
    access: "full",
    fork: { sessionId: "sess-gone", at: "uuid-a1" },
    seed: "user: First turn",
  });
  assert.deepEqual([fallback.rewound, fallback.seeded], [false, true]);
  await until((e) => e.type === "done");
  assert.ok(events.some((e) => e.type === "status" && /Could not rewind/.test(e.text)));
  assert.equal(record.options.resume, undefined);
  assert.equal(record.options.forkSession, undefined);
  assert.match(
    record.message.message.content[0].text,
    /^<previous-conversation>[\s\S]*user: First turn[\s\S]*Third take$/,
  );
});

test("rewind (Codex): done reports the turn id; thread/fork continues through it, a refused fork falls back to the seed", async (t) => {
  const { runtime, events, until, log } = await setup(t);
  await runtime.run({ agent: "codex", chatId: CHAT, prompt: "first codex turn", access: "edit" });
  const first = await until((e) => e.type === "done");
  assert.equal(first.sessionId, "thr-1");
  assert.match(first.resumeAt, /^turn-/);
  events.length = 0;
  const forked = await runtime.run({
    agent: "codex",
    chatId: CHAT,
    prompt: "second take",
    access: "ask",
    fork: { sessionId: "thr-1", at: first.resumeAt },
    seed: "user: first codex turn",
  });
  assert.deepEqual([forked.rewound, forked.seeded], [true, false]);
  const second = await until((e) => e.type === "done");
  assert.match(second.sessionId, /^thr-fork-/);
  const calls = (await fs.readFile(log, "utf8")).trim().split("\n").map(JSON.parse);
  const fork = calls.find((c) => c.rpc === "thread/fork").params;
  assert.deepEqual(
    [fork.threadId, fork.lastTurnId, fork.sandbox, fork.approvalPolicy, fork.excludeTurns],
    ["thr-1", first.resumeAt, "read-only", "untrusted", true],
  );
  assert.match(fork.developerInstructions, /Verynize/);
  assert.equal(
    calls.filter((c) => c.rpc === "turn/start").at(-1).params.threadId,
    second.sessionId,
  );
  assert.equal(
    calls.filter((c) => c.rpc === "turn/start").at(-1).params.input[0].text,
    "second take",
  );
  events.length = 0;
  const fallback = await runtime.run({
    agent: "codex",
    chatId: CHAT,
    prompt: "third take",
    fork: { sessionId: "thr-1", at: "turn-missing" },
    seed: "user: first codex turn",
  });
  assert.deepEqual([fallback.rewound, fallback.seeded], [false, true]);
  const third = await until((e) => e.type === "done");
  assert.ok(events.some((e) => e.type === "status" && /Could not rewind/.test(e.text)));
  assert.doesNotMatch(third.sessionId, /fork/);
  const last = (await fs.readFile(log, "utf8"))
    .trim()
    .split("\n")
    .map(JSON.parse)
    .filter((c) => c.rpc === "turn/start")
    .at(-1).params.input[0].text;
  assert.match(last, /^<previous-conversation>[\s\S]*first codex turn[\s\S]*third take$/);
});

test("second opinion: the answer and the uncommitted diff go read-only to the other provider", async (t) => {
  const project = await fs.mkdtemp(path.join(os.tmpdir(), "review-project-"));
  t.after(() => fs.rm(project, { recursive: true, force: true }));
  const git = (...args) => execFileSync("git", ["-C", project, ...args], { stdio: "pipe" });
  git("init", "-q");
  git("config", "user.email", "t@example.com");
  git("config", "user.name", "T");
  await fs.writeFile(path.join(project, "index.html"), "<h1>Old</h1>\n");
  git("add", ".");
  git("commit", "-qm", "init");
  await fs.writeFile(path.join(project, "index.html"), "<h1>New heading</h1>\n");
  await fs.writeFile(path.join(project, "notes.txt"), "untracked\n");
  const { runtime, log } = await setup(t, { getProject: () => ({ root: project }) });
  await assert.rejects(() => runtime.review({ agent: "codex", answer: "  " }), /no answer/);
  await assert.rejects(() => runtime.review({ agent: "gemini", answer: "x" }), /agent must be/);
  const result = await runtime.review({
    agent: "codex",
    author: "claude",
    request: "Rename the heading",
    answer: 'I changed the heading to "New heading".',
  });
  assert.equal(result.agent, "codex");
  assert.equal(result.requested, "codex");
  assert.equal(result.diff, true);
  assert.ok(result.text);
  const calls = (await fs.readFile(log, "utf8")).trim().split("\n").map(JSON.parse);
  const thread = calls.filter((c) => c.rpc === "thread/start").at(-1).params;
  assert.deepEqual(
    [thread.sandbox, thread.approvalPolicy, thread.ephemeral, thread.cwd],
    ["read-only", "never", true, project],
  );
  assert.ok(
    thread.config["mcp_servers.verynize.disabled_tools"].includes("update_elements"),
    "canvas edits are disabled for the reviewer",
  );
  const task = calls.filter((c) => c.rpc === "turn/start").at(-1).params.input[0].text;
  assert.match(task, /^Give a second opinion on a turn another agent \(Claude\)/);
  assert.match(task, /<user-request>\nRename the heading\n<\/user-request>/);
  assert.match(task, /<agent-answer>\nI changed the heading/);
  assert.match(
    task,
    /<uncommitted-changes>\ngit status --short:\n M index.html\n\?\? notes.txt[\s\S]*-<h1>Old<\/h1>\n\+<h1>New heading<\/h1>/,
  );
  // Without the requested provider, the other installed one answers; without a project there is no diff.
  const solo = new AgentRuntime({
    userData: path.join(project, ".ud"),
    discover: async () => [
      { id: "codex", available: false, path: null },
      { id: "claude", available: true, path: "/usr/bin/true" },
    ],
    loadClaudeSdk: async () => fakeClaudeSdk({}),
    getBridge: async () => null,
  });
  t.after(() => solo.close());
  const fallback = await solo.review({ agent: "codex", answer: "Done.", includeDiff: true });
  assert.deepEqual([fallback.agent, fallback.requested, fallback.diff], ["claude", "codex", false]);
  // Long inputs are clipped in the middle so the task stays under the helper limit.
  const long = buildReviewTask({
    request: "r".repeat(50000),
    answer: "a".repeat(200000),
    diff: "d".repeat(200000),
  });
  assert.ok(long.length < 100000, String(long.length));
  assert.match(long, /characters omitted/);
});

#!/usr/bin/env node
// Deterministic stand-in for the `codex` CLI used by agent tests. Never calls a model.
//  codex app-server --help     -> advertises app-server support (unless FAKE_CODEX_NO_APP_SERVER=1)
//  codex app-server [...]      -> newline-delimited JSON-RPC server
//  codex exec ... -            -> legacy one-shot JSONL output
//  codex login status          -> "Not logged in" (exit 1) when $CODEX_HOME/fake-account.json says signed out
//  codex login / logout        -> rewrites $CODEX_HOME/fake-account.json as signed in / out (a finished browser sign-in)
// Sign-in: $CODEX_HOME/fake-account.json, if present, is the `account/read` result (e.g. {"account":null,
// "requiresOpenaiAuth":true} for a signed-out account); without it account/read is an unknown method (old CLIs).
// A prompt containing "unauthorized" fails like a rejected sign-in: three 401 retries, a final 401, a failed turn.
const fs = require("node:fs");
const path = require("node:path");
const args = process.argv.slice(2);
const log = process.env.FAKE_CODEX_LOG;
// codexHome / mcpEnv let account and MCP-server tests see the child environment (names only for mcpEnv).
if (log)
  fs.appendFileSync(
    log,
    JSON.stringify({
      args,
      token: process.env.VERYNIZE_MCP_TOKEN || null,
      ...(process.env.CODEX_HOME ? { codexHome: process.env.CODEX_HOME } : {}),
      ...(process.env.FAKE_MCP_SECRET ? { mcpEnv: process.env.FAKE_MCP_SECRET } : {}),
    }) + "\n",
  );

const MARKDOWN_SAMPLE = [
  "**Fonts** and `font/display`",
  "first line",
  "second line",
  "",
  "| Variable | Nilai | Dipakai |",
  "|---|:---:|---|",
  "| `font/body` | Instrument Sans 400 | Teks isi |",
  "| `space/page-x` | 80 | Padding |",
  "",
  "- [x] done",
  "- [ ] todo",
  "",
  "```ts",
  "const a = 1;",
  "```",
  "",
  "Open verynize://node/editor/page-1/abcd. Docs: https://example.com/docs, [bad](javascript:alert(1)), ~~old~~ <b>raw</b>",
].join("\n");

if (args[0] === "app-server" && args.includes("--help")) {
  if (process.env.FAKE_CODEX_NO_APP_SERVER === "1") {
    console.error("unrecognized subcommand");
    process.exit(2);
  }
  console.log("[experimental] Run the app server or related tooling");
  process.exit(0);
}

const fakeAccount = (() => {
  try {
    return process.env.CODEX_HOME
      ? JSON.parse(fs.readFileSync(path.join(process.env.CODEX_HOME, "fake-account.json"), "utf8"))
      : undefined;
  } catch {
    return undefined;
  }
})();
if (args[0] === "login" && args[1] === "status") {
  if (fakeAccount && !fakeAccount.account && fakeAccount.requiresOpenaiAuth !== false) {
    console.error("Not logged in");
    process.exit(1);
  }
  console.error("Logged in using ChatGPT");
  process.exit(0);
}

if ((args[0] === "login" || args[0] === "logout") && args.length === 1 && process.env.CODEX_HOME) {
  const account =
    args[0] === "login"
      ? {
          account: { type: "chatgpt", email: "fake@example.com", planType: "plus" },
          requiresOpenaiAuth: true,
        }
      : { account: null, requiresOpenaiAuth: true };
  console.log(args[0] === "login" ? "Opening browser…" : "Logged out");
  setTimeout(() => {
    fs.writeFileSync(
      path.join(process.env.CODEX_HOME, "fake-account.json"),
      JSON.stringify(account),
    );
    process.exit(0);
  }, 300);
  return;
}

if (args[0] === "exec") {
  let input = "";
  process.stdin.on("data", (d) => (input += d));
  process.stdin.on("end", () => {
    const out = (o) => console.log(JSON.stringify(o));
    out({ type: "thread.started", thread_id: "exec-thread" });
    if (/unauthorized/.test(input)) {
      for (let i = 1; i <= 3; i++)
        out({
          type: "error",
          message: `Reconnecting... ${i}/5 (unexpected status 401 Unauthorized: Missing bearer or basic authentication in header)`,
        });
      out({
        type: "turn.failed",
        error: {
          message:
            "unexpected status 401 Unauthorized: Missing bearer or basic authentication in header",
        },
      });
      process.exitCode = 1;
      return;
    }
    out({
      type: "item.completed",
      item: {
        id: "m1",
        type: "agent_message",
        text: "Exec reply ARGS " + JSON.stringify(args) + " PROMPT " + input.slice(-400),
      },
    });
    out({ type: "turn.completed", usage: { input_tokens: 4, output_tokens: 3 } });
  });
  return;
}

if (args[0] !== "app-server") {
  console.error("fake codex: unsupported");
  process.exit(2);
}

let buffer = "",
  nextServerId = 1000;
const pendingServer = new Map();
const send = (message) => process.stdout.write(JSON.stringify(message) + "\n");
const notify = (method, params) => send({ method, params });
const turns = new Map();

function completeTurn(threadId, turnId, status) {
  if (!turns.has(turnId)) return;
  turns.delete(turnId);
  notify("turn/completed", { threadId, turn: { id: turnId, status, error: null, items: [] } });
}

async function runTurn(threadId, turnId, text, images) {
  notify("turn/started", { threadId, turn: { id: turnId } });
  // "indicators": MCP startup status, a 1M context window and an account rate-limit update (composer indicators).
  if (/indicators/.test(text)) {
    notify("mcpServer/startupStatus/updated", {
      threadId,
      name: "verynize",
      status: "ready",
      error: null,
      failureReason: null,
    });
    notify("mcpServer/startupStatus/updated", {
      threadId,
      name: "rea",
      status: "failed",
      error: "spawn rea ENOENT",
      failureReason: null,
    });
    notify("thread/tokenUsage/updated", {
      threadId,
      turnId,
      tokenUsage: {
        last: { inputTokens: 106600, outputTokens: 900, totalTokens: 107500 },
        modelContextWindow: 1000000,
      },
    });
    notify("account/rateLimits/updated", {
      rateLimits: {
        limitId: "codex",
        limitName: null,
        primary: {
          usedPercent: 35,
          windowDurationMins: 300,
          resetsAt: Math.floor(Date.now() / 1000) + 3600,
        },
        secondary: null,
      },
    });
  }
  if (/unauthorized/.test(text)) {
    const message =
      "unexpected status 401 Unauthorized: Missing bearer or basic authentication in header, url: https://api.openai.com/v1/responses";
    for (let i = 1; i <= 3; i++)
      notify("error", {
        threadId,
        turnId,
        willRetry: true,
        error: {
          message: `Reconnecting... ${i}/5`,
          codexErrorInfo: { responseStreamDisconnected: { httpStatusCode: 401 } },
          additionalDetails: message,
        },
      });
    // A real Codex keeps retrying for ~17 s; the runtime should interrupt before this final error is reached.
    setTimeout(() => {
      if (!turns.has(turnId)) return;
      notify("error", {
        threadId,
        turnId,
        willRetry: false,
        error: { message, codexErrorInfo: { responseStreamDisconnected: { httpStatusCode: 401 } } },
      });
      turns.delete(turnId);
      notify("turn/completed", {
        threadId,
        turn: {
          id: turnId,
          status: "failed",
          error: {
            message,
            codexErrorInfo: { responseStreamDisconnected: { httpStatusCode: 401 } },
          },
          items: [],
        },
      });
    }, 3000);
    return;
  }
  if (/slow/.test(text)) {
    notify("item/agentMessage/delta", {
      threadId,
      turnId,
      itemId: "msg-slow",
      delta: "Thinking slowly…",
    });
    return;
  }
  notify("item/reasoning/summaryTextDelta", {
    threadId,
    turnId,
    itemId: "r1",
    delta: "Plan the change.",
    summaryIndex: 0,
  });
  notify("item/started", {
    threadId,
    turnId,
    item: {
      type: "commandExecution",
      id: "cmd-1",
      command: "ls",
      cwd: "/tmp",
      status: "inProgress",
    },
  });
  let declined = false;
  if (/approve/.test(text)) {
    const id = nextServerId++;
    const decision = await new Promise((resolve) => {
      pendingServer.set(id, resolve);
      send({
        id,
        method: "item/commandExecution/requestApproval",
        params: { threadId, turnId, itemId: "cmd-1", command: "ls" },
      });
    });
    declined = decision?.decision !== "accept";
  }
  notify("item/completed", {
    threadId,
    turnId,
    item: {
      type: "commandExecution",
      id: "cmd-1",
      command: "ls",
      cwd: "/tmp",
      status: declined ? "declined" : "completed",
      aggregatedOutput: declined ? "" : "hello.txt\n",
      exitCode: declined ? null : 0,
    },
  });
  notify("item/started", {
    threadId,
    turnId,
    item: {
      type: "mcpToolCall",
      id: "mcp-1",
      server: "verynize",
      tool: "get_design_context",
      arguments: { pageId: "page-1" },
      status: "inProgress",
    },
  });
  notify("item/completed", {
    threadId,
    turnId,
    item: {
      type: "mcpToolCall",
      id: "mcp-1",
      server: "verynize",
      tool: "get_design_context",
      arguments: { pageId: "page-1" },
      status: "completed",
      result: { content: [{ type: "text", text: "page ok" }] },
      error: null,
    },
  });
  // "Set up the Preview" (tests/preview-header.cjs): a propose_preview call as auto mode reports it (saved, not started).
  if (/Set up the Preview/.test(text)) {
    const saved = {
      saved: true,
      savedBy: "auto",
      name: "App",
      command: ["python3", "-m", "http.server", "8000"],
      port: 8000,
      started: false,
    };
    notify("item/started", {
      threadId,
      turnId,
      item: {
        type: "mcpToolCall",
        id: "mcp-preview",
        server: "verynize",
        tool: "propose_preview",
        arguments: { command: saved.command, port: 8000 },
        status: "inProgress",
      },
    });
    notify("item/completed", {
      threadId,
      turnId,
      item: {
        type: "mcpToolCall",
        id: "mcp-preview",
        server: "verynize",
        tool: "propose_preview",
        arguments: { command: saved.command, port: 8000 },
        status: "completed",
        result: { content: [{ type: "text", text: JSON.stringify(saved) }] },
        error: null,
      },
    });
  }
  // "markdown sample" gets a fixed Markdown reply (tests/chat-markdown.cjs).
  const reply = /markdown sample/.test(text)
    ? MARKDOWN_SAMPLE
    : `Reply to ${JSON.stringify(text.slice(-300))} images=${images.length} declined=${declined}`;
  for (const part of [reply.slice(0, 9), reply.slice(9)])
    notify("item/agentMessage/delta", { threadId, turnId, itemId: "msg-1", delta: part });
  notify("item/completed", {
    threadId,
    turnId,
    item: { type: "agentMessage", id: "msg-1", text: reply },
  });
  if (!/indicators/.test(text))
    notify("thread/tokenUsage/updated", {
      threadId,
      turnId,
      tokenUsage: { last: { inputTokens: 5, outputTokens: 7 } },
    });
  completeTurn(threadId, turnId, "completed");
}

let threadCount = 0;
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let end;
  while ((end = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, end);
    buffer = buffer.slice(end + 1);
    if (!line.trim()) continue;
    const message = JSON.parse(line);
    if (log)
      fs.appendFileSync(
        log,
        JSON.stringify({
          rpc: message.method || "response",
          params: message.params,
          result: message.result,
        }) + "\n",
      );
    if (message.id !== undefined && !message.method) {
      pendingServer.get(message.id)?.(message.result);
      pendingServer.delete(message.id);
      continue;
    }
    const { id, method, params = {} } = message;
    if (method === "initialize") send({ id, result: { userAgent: "fake-codex" } });
    else if (method === "initialized") {
    } else if (method === "thread/start") {
      const thread = { id: "thr-" + ++threadCount };
      send({ id, result: { thread, model: params.model || "fake-model", cwd: params.cwd } });
      notify("thread/started", { thread });
    } else if (method === "thread/fork") {
      if (params.threadId === "thr-missing" || params.lastTurnId === "turn-missing")
        send({ id, error: { code: -32000, message: "cannot fork: unknown turn" } });
      else {
        const thread = { id: "thr-fork-" + ++threadCount };
        send({ id, result: { thread, model: params.model || "fake-model", cwd: params.cwd } });
        notify("thread/started", { thread });
      }
    } else if (method === "thread/resume") {
      if (params.threadId === "thr-missing")
        send({ id, error: { code: -32000, message: "no rollout found" } });
      else send({ id, result: { thread: { id: params.threadId } } });
    } else if (method === "turn/start") {
      const turnId = "turn-" + Math.random().toString(36).slice(2, 8);
      turns.set(turnId, params.threadId);
      send({ id, result: { turn: { id: turnId, status: "inProgress", items: [] } } });
      const text = params.input
        .filter((i) => i.type === "text")
        .map((i) => i.text)
        .join("\n");
      setTimeout(
        () =>
          runTurn(
            params.threadId,
            turnId,
            text,
            params.input.filter((i) => i.type === "localImage"),
          ),
        5,
      );
    } else if (method === "turn/interrupt") {
      send({ id, result: {} });
      completeTurn(params.threadId, params.turnId, "interrupted");
    } else if (method === "mcpServerStatus/list")
      send({
        id,
        result: {
          data: [
            {
              name: "verynize",
              runtimeStatus: "connected",
              authStatus: "unsupported",
              tools: {},
              toolsError: null,
            },
            {
              name: "rea",
              runtimeStatus: "failed",
              authStatus: "unsupported",
              tools: {},
              toolsError: "spawn rea ENOENT",
            },
            {
              name: "figma",
              runtimeStatus: "authenticationRequired",
              authStatus: "notLoggedIn",
              tools: {},
              toolsError: null,
            },
          ],
          nextCursor: null,
        },
      });
    else if (method === "account/read" && fakeAccount !== undefined)
      send({ id, result: fakeAccount });
    else if (method === "model/list")
      send({
        id,
        result: {
          data: [
            {
              id: "fake-large",
              model: "fake-large",
              displayName: "Fake Large",
              description: "fixture",
              hidden: false,
              supportedReasoningEfforts: [{ reasoningEffort: "high" }],
            },
            { id: "hidden", model: "hidden", hidden: true },
          ],
          nextCursor: null,
        },
      });
    else if (id !== undefined)
      send({ id, error: { code: -32601, message: "unknown method " + method } });
  }
});

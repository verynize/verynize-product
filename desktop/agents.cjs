// Installed-agent discovery and the one-shot CLI fallback runner.
// The primary chat runtime lives in desktop/agent-runtime.cjs (Claude Agent SDK and Codex
// app-server). `start` is used only when those are unavailable; it emits the same typed events.
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { spawn } = require("node:child_process");
const { randomUUID } = require("node:crypto");
const { argumentsFor, MCP_TOKEN_ENV } = require("./agent-settings.cjs");
const { createClaudeMapper, createCodexExecMapper } = require("./agent-runtime-events.cjs");

const dirs = () => [
  ...(process.env.PATH || "").split(path.delimiter),
  "/opt/homebrew/bin",
  "/usr/local/bin",
  path.join(os.homedir(), ".local/bin"),
];
async function discover() {
  return Promise.all(
    ["codex", "claude"].map(async (id) => {
      for (const dir of dirs().filter((dir) => path.isAbsolute(dir))) {
        const candidate = path.join(dir, id);
        try {
          await fs.access(candidate, 1);
          return { id, available: true, path: candidate };
        } catch {}
      }
      return { id, available: false, path: null };
    }),
  );
}

function childEnv(extra = {}) {
  const env = { ...process.env, ...extra };
  delete env.ELECTRON_RUN_AS_NODE;
  return env;
}

function killTree(child, signal = "SIGTERM") {
  try {
    if (process.platform !== "win32") process.kill(-child.pid, signal);
    else child.kill(signal);
  } catch {}
}

function start(executable, agent, prompt, cwd, emit, options = {}) {
  if (typeof prompt !== "string" || !prompt.trim() || prompt.length > 200000)
    throw Error("Enter a prompt under 200,000 characters");
  const args = argumentsFor(agent, options);
  const env = childEnv({
    ...(options.env && typeof options.env === "object" ? options.env : {}),
    ...(options.bridge?.token ? { [MCP_TOKEN_ENV]: options.bridge.token } : {}),
  });
  const child = spawn(executable, args, {
    cwd,
    env,
    stdio: ["pipe", "pipe", "pipe"],
    detached: process.platform !== "win32",
  });
  const id = options.id || randomUUID();
  const map = agent === "claude" ? createClaudeMapper() : createCodexExecMapper();
  let buffered = "",
    stopped = false,
    failed = false,
    sessionId = null,
    finished = false;
  const send = (event) => {
    if (
      event.type === "turn-complete" ||
      event.type === "turn-idle" ||
      event.type === "subagent-threads"
    )
      return;
    if (event.type === "session") sessionId = event.sessionId;
    if (event.type === "error") failed = true;
    emit({ id, ...event });
  };
  const line = (text) => {
    if (!text.trim()) return;
    if (!options.structured) {
      send({ type: "assistant-text-delta", text: text + "\n" });
      return;
    }
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      send({ type: "assistant-text-delta", text: text + "\n" });
      return;
    }
    for (const event of map(data)) send(event);
  };
  child.stdout.on("data", (data) => {
    buffered += data.toString();
    let end;
    while ((end = buffered.indexOf("\n")) >= 0) {
      line(buffered.slice(0, end));
      buffered = buffered.slice(end + 1);
    }
    if (buffered.length > 4 * 1048576) {
      send({ type: "status", text: "Oversized event omitted" });
      buffered = "";
    }
  });
  child.stdout.on("end", () => {
    if (buffered) line(buffered);
    buffered = "";
  });
  let stderr = "";
  child.stderr.on("data", (data) => {
    stderr = (stderr + data.toString()).slice(-8000);
  });
  const finish = (code) => {
    if (finished) return;
    finished = true;
    if (code !== 0 && !stopped && !failed && stderr.trim())
      send({ type: "error", text: stderr.trim().slice(-2000) });
    emit({ id, type: "done", code: code ?? 1, stopped, ...(sessionId ? { sessionId } : {}) });
  };
  child.on("error", (e) => {
    send({ type: "error", text: e.message });
    finish(1);
  });
  child.on("close", (code) => finish(stopped ? 130 : code));
  child.stdin.on("error", () => {});
  child.stdin.end(prompt);
  return {
    id,
    runtime: agent === "claude" ? "claude-cli" : "codex-exec",
    cancel() {
      stopped = true;
      killTree(child);
      const timer = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) killTree(child, "SIGKILL");
      }, 2000);
      timer.unref?.();
    },
  };
}

module.exports = { discover, start, argumentsFor, childEnv, killTree };

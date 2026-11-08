/**
 * Dev servers and background commands for the agent shell tools (desktop main process).
 * =====================================================================================
 * Plain Node (no Electron imports) so tests can drive it directly.
 *
 *   const m = new ProcessManager({configFile})
 *   m.detect(root)            -> {command, script, packageManager, source} | null   (package.json scripts)
 *   m.status(root)            -> dev server status for a project (never throws)
 *   m.start(root, {command?, url?, waitMs?})  -> status once a localhost URL answers, the process
 *                                exits, or waitMs passes. One dev server per project root.
 *   m.stop(root)              -> status after the whole process group is gone
 *   m.configure(root, {command|null, url?, setup?, stop?, commands?})   -> persisted per-project override
 *                                (configFile JSON). setup/stop are one argv or a list of argv steps (run in
 *                                order, like `a && b`); commands is [{name, command, url?}] started together,
 *                                the first one with a url (else the first) decides the preview address.
 *   m.run(root, argv, {timeoutMs?, background?})  -> foreground: exit code + bounded output;
 *                                background: {id} readable with m.read(id)
 *   m.read(id, {since?, limit?}) -> {entries, nextSeq, dropped, state}   id "dev-server:<root>" or a job id
 *   m.kill(id) / m.list(root) / m.stopAll()   stopAll is synchronous (app quit)
 *
 * Every process is spawned from an argument array (never a shell) inside the project root, with
 * stdin closed, in its own process group (detached) so stop/kill reaches the whole tree. Output is
 * kept in bounded ring buffers with ANSI escapes removed.
 */
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { spawn } = require("node:child_process");
const { randomUUID } = require("node:crypto");

const LOG_BYTES = 512 * 1024; // per process ring buffer
const LINE_CHARS = 2000; // longer lines are cut
const MAX_ARGV = 64,
  MAX_ARG = 4096,
  MAX_ARGV_CHARS = 8192;
const MAX_JOBS = 20,
  MAX_RUNNING_JOBS = 4;
const FOREGROUND_OUTPUT = 30000; // characters of output returned by a foreground run
const SCRIPT_ORDER = ["dev", "start", "serve", "preview"];
const LOCK_FILES = [
  ["pnpm-lock.yaml", "pnpm"],
  ["yarn.lock", "yarn"],
  ["bun.lockb", "bun"],
  ["bun.lock", "bun"],
  ["package-lock.json", "npm"],
  ["npm-shrinkwrap.json", "npm"],
];
// oxlint-disable-next-line no-control-regex -- matches ANSI escape sequences, which start with ESC
const ANSI = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-Z\\-_]/g;
const LOCAL_URL =
  /\bhttps?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1?\]|\[::\])(?::\d{2,5})?(?:\/[^\s'"`<>)\]]*)?/i;

const extraDirs = () => [
  "/opt/homebrew/bin",
  "/usr/local/bin",
  path.join(os.homedir(), ".local/bin"),
  path.join(os.homedir(), ".vite-plus/bin"),
  path.join(os.homedir(), ".bun/bin"),
  path.join(os.homedir(), ".volta/bin"),
  path.join(os.homedir(), "Library/pnpm"),
];
/** Child environment: the app's env plus the usual tool directories (GUI apps get a short PATH). Python writes
 * unbuffered so a piped `python3 -m http.server` shows its "Serving HTTP on …" line (logs and URL detection). */
function childEnv(extra = {}) {
  const env = {
    ...process.env,
    BROWSER: "none",
    FORCE_COLOR: "0",
    NO_COLOR: "1",
    PYTHONUNBUFFERED: "1",
    ...extra,
  };
  delete env.ELECTRON_RUN_AS_NODE;
  const dirs = String(env.PATH || "")
    .split(path.delimiter)
    .filter(Boolean);
  for (const dir of extraDirs()) if (!dirs.includes(dir)) dirs.push(dir);
  env.PATH = dirs.join(path.delimiter);
  return env;
}
/** Resolve a bare program name on the child PATH; absolute/relative paths are kept as given. */
function resolveProgram(program, env) {
  if (program.includes("/")) return program;
  for (const dir of String(env.PATH || "").split(path.delimiter)) {
    if (!path.isAbsolute(dir)) continue;
    const candidate = path.join(dir, program);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch {}
  }
  throw new Error(
    `Command not found: ${program}. Install it or set the dev server command with configure_dev_server.`,
  );
}

/** Retry only pnpm's unreviewed-build error; this does not approve dependency scripts. */
function recoverIgnoredBuilds(argv, result) {
  if (
    result.exitCode === 0 ||
    result.state === "stopped" ||
    !/ERR_PNPM_IGNORED_BUILDS/.test(result.output || "")
  )
    return null;
  const program = path.basename(argv[0] || "");
  if (!["vp", "pnpm"].includes(program) || !["install", "i"].includes(argv[1])) return null;
  if (argv.some((arg) => /strict[-D]ep[-B]uilds|strict-dep-builds/i.test(arg))) return null;
  return [
    ...argv,
    ...(program === "vp" && !argv.includes("--") ? ["--"] : []),
    "--config.strict-dep-builds=false",
  ];
}

/** Validate an argument array; returns a copy. */
function checkArgv(argv) {
  if (!Array.isArray(argv) || !argv.length || argv.length > MAX_ARGV)
    throw new Error(
      `Command must be an argument array with 1-${MAX_ARGV} entries, e.g. ["npm","run","dev"]`,
    );
  let total = 0;
  for (const arg of argv) {
    if (typeof arg !== "string" || arg.length > MAX_ARG || arg.includes("\0"))
      throw new Error("Command arguments must be strings without NUL characters");
    total += arg.length;
  }
  if (!argv[0].trim()) throw new Error("The program name is empty");
  if (total > MAX_ARGV_CHARS) throw new Error("Command is too long");
  return [...argv];
}

const MAX_STEPS = 16,
  MAX_COMMANDS = 8,
  STOP_TIMEOUT = 60000;
/** One argv or a list of argv steps -> list of validated argv steps. */
function checkSteps(value) {
  if (Array.isArray(value) && value.length && Array.isArray(value[0])) {
    if (value.length > MAX_STEPS)
      throw new Error(`At most ${MAX_STEPS} chained steps are supported`);
    return value.map(checkArgv);
  }
  return [checkArgv(value)];
}
/** Preview start commands [{name, command, url?}] -> validated copies; at most MAX_COMMANDS. */
function checkCommands(list) {
  if (!Array.isArray(list) || !list.length || list.length > MAX_COMMANDS)
    throw new Error(`Add 1-${MAX_COMMANDS} start commands`);
  return list.map((entry, index) => {
    if (!entry || typeof entry !== "object") throw new Error("Each start command needs a command");
    const name =
      typeof entry.name === "string" && entry.name.trim()
        ? entry.name.trim().slice(0, 80)
        : index
          ? `Command ${index + 1}`
          : "App";
    return {
      name,
      command: checkArgv(entry.command),
      ...(entry.url ? { url: normalizeLocalURL(entry.url) } : {}),
    };
  });
}
/** Index of the command whose address the preview opens: the first with an explicit url, else the first. */
const primaryIndex = (commands) =>
  Math.max(
    0,
    commands.findIndex((entry) => entry.url),
  );
const stepsKey = (steps) => JSON.stringify(steps || null);

/** Normalize a URL printed by a dev server to something the preview accepts (0.0.0.0 -> localhost). */
function normalizeLocalURL(value) {
  const url = new URL(value.replace(/[.,;:!]+$/, ""));
  if (["0.0.0.0", "[::]"].includes(url.hostname)) url.hostname = "localhost";
  if (
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password
  )
    throw new Error("Not a localhost URL");
  return url.href;
}
function detectURL(line) {
  const match = LOCAL_URL.exec(line);
  if (!match) return null;
  try {
    return normalizeLocalURL(match[0]);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------------------------
// Bounded line log

class RingLog {
  constructor(maxBytes = LOG_BYTES) {
    this.maxBytes = maxBytes;
    this.entries = [];
    this.bytes = 0;
    this.seq = 0;
    this.dropped = 0;
    this.partial = { stdout: "", stderr: "" };
    this.listeners = new Set();
  }
  write(stream, chunk) {
    const text =
      (this.partial[stream] || "") +
      String(chunk)
        .replace(ANSI, "")
        .replace(/\r(?!\n)/g, "\n");
    const lines = text.split(/\r?\n/);
    this.partial[stream] = lines.pop();
    if (this.partial[stream].length > LINE_CHARS) {
      lines.push(this.partial[stream]);
      this.partial[stream] = "";
    }
    for (const line of lines) this.push(stream, line);
  }
  flush() {
    for (const stream of Object.keys(this.partial))
      if (this.partial[stream]) {
        this.push(stream, this.partial[stream]);
        this.partial[stream] = "";
      }
  }
  push(stream, line) {
    const text =
      line.length > LINE_CHARS
        ? `${line.slice(0, LINE_CHARS)}… (${line.length - LINE_CHARS} more characters)`
        : line;
    const entry = { seq: ++this.seq, stream, text, at: Date.now() };
    this.entries.push(entry);
    this.bytes += text.length + 32;
    while (this.bytes > this.maxBytes && this.entries.length > 1) {
      const old = this.entries.shift();
      this.bytes -= old.text.length + 32;
      this.dropped++;
    }
    for (const listener of this.listeners) {
      try {
        listener(entry);
      } catch {}
    }
  }
  read({ since = 0, limit = 200 } = {}) {
    limit = Math.max(1, Math.min(2000, Number(limit) || 200));
    const after = this.entries.filter((e) => e.seq > since);
    const slice = since ? after.slice(0, limit) : after.slice(-limit);
    const firstSeq = this.entries[0]?.seq || this.seq + 1;
    return {
      entries: slice.map(({ seq, stream, text }) => ({ seq, stream, text })),
      nextSeq: slice.length ? slice[slice.length - 1].seq : since || this.seq,
      latestSeq: this.seq,
      dropped: since && since + 1 < firstSeq ? firstSeq - since - 1 : 0,
      more: since ? after.length > limit : after.length > slice.length,
    };
  }
  tail(lines = 40) {
    return this.entries
      .slice(-lines)
      .map((e) => e.text)
      .join("\n");
  }
}

// ---------------------------------------------------------------------------------------------
// Process groups

function killGroup(child, signal) {
  if (!child?.pid) return;
  try {
    if (process.platform === "win32") child.kill(signal);
    else process.kill(-child.pid, signal);
  } catch {
    try {
      child.kill(signal);
    } catch {}
  }
}
const groupAlive = (pid) => {
  try {
    process.kill(process.platform === "win32" ? pid : -pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
};

/** Spawn argv in cwd as a new process group, piping output into a RingLog. */
function launch(argv, cwd, log, extraEnv = {}) {
  const env = childEnv(extraEnv);
  env.PATH = path.join(cwd, "node_modules/.bin") + path.delimiter + env.PATH;
  const program = resolveProgram(argv[0], env);
  const child = spawn(
    process.execPath,
    [
      path.join(__dirname, "process-supervisor.cjs"),
      String(process.pid),
      program,
      ...argv.slice(1),
    ],
    {
      cwd,
      env: { ...env, ELECTRON_RUN_AS_NODE: "1" },
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    },
  );
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (data) => log.write("stdout", data));
  child.stderr.on("data", (data) => log.write("stderr", data));
  return child;
}

/** SIGTERM the group, SIGKILL after graceMs; resolves when the group is gone (bounded). */
async function terminate(proc, graceMs = 3000) {
  if (!proc.child || proc.exited) {
    if (proc.child?.pid && groupAlive(proc.child.pid)) killGroup(proc.child, "SIGKILL");
    return;
  }
  killGroup(proc.child, "SIGTERM");
  const deadline = Date.now() + graceMs;
  while (!proc.exited && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
  if (!proc.exited || groupAlive(proc.child.pid)) killGroup(proc.child, "SIGKILL");
  const hard = Date.now() + 2000;
  while (!proc.exited && Date.now() < hard) await new Promise((r) => setTimeout(r, 25));
}

/** Resolves true once url answers any HTTP response, false at the deadline. */
async function probe(url, deadline) {
  while (Date.now() < deadline) {
    const ok = await new Promise((resolve) => {
      const req = http.get(url.replace(/^https:/, "http:"), { timeout: 1500 }, (res) => {
        res.resume();
        resolve(true);
      });
      req.on("error", () => resolve(false));
      req.on("timeout", () => {
        req.destroy();
        resolve(false);
      });
    });
    if (ok) return true;
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

// ---------------------------------------------------------------------------------------------

class ProcessManager {
  constructor({ configFile = null } = {}) {
    this.configFile = configFile;
    this.servers = new Map(); // root -> proc
    this.jobs = new Map(); // id -> proc
    this.config = null;
  }

  // ---- per-project override command (persisted) ----
  async loadConfig() {
    if (this.config) return this.config;
    let data = { version: 1, projects: {}, setupDone: {} };
    if (this.configFile) {
      try {
        const parsed = JSON.parse(await fsp.readFile(this.configFile, "utf8"));
        if (parsed && typeof parsed.projects === "object" && !Array.isArray(parsed.projects))
          data = {
            version: 1,
            projects: parsed.projects,
            proposals: parsed.proposals || {},
            setupDone:
              parsed.setupDone && typeof parsed.setupDone === "object" ? parsed.setupDone : {},
          };
      } catch {}
    }
    this.config = data;
    return data;
  }
  async save(data) {
    if (!this.configFile) return;
    await fsp.mkdir(path.dirname(this.configFile), { recursive: true });
    const temp = `${this.configFile}.${process.pid}.${randomUUID()}.tmp`;
    await fsp.writeFile(temp, JSON.stringify(data, null, 2) + "\n", { mode: 0o600 });
    await fsp.rename(temp, this.configFile);
  }
  async proposal(root) {
    return (await this.loadConfig()).proposals?.[root] || null;
  }
  async propose(root, { command, setup, port, chatId, name, saved } = {}) {
    const data = await this.loadConfig();
    data.proposals ||= {};
    if (saved === true && data.proposals[root]) data.proposals[root].saved = true;
    else if (command === null) delete data.proposals[root];
    else {
      if (!Number.isInteger(port) || port < 1 || port > 65535)
        throw new Error("Port must be between 1 and 65535");
      data.proposals[root] = {
        id: randomUUID(),
        command: checkArgv(command),
        ...(setup ? { setup: checkArgv(setup) } : {}),
        port,
        root,
        chatId: typeof chatId === "string" ? chatId.slice(0, 200) : null,
        name: typeof name === "string" ? name.slice(0, 200) : null,
        createdAt: new Date().toISOString(),
      };
    }
    await this.save(data);
    return { proposal: await this.proposal(root) };
  }
  async projectConfig(root) {
    const entry = (await this.loadConfig()).projects[root];
    if (!entry || typeof entry !== "object") return null;
    try {
      const commands =
        Array.isArray(entry.commands) && entry.commands.length
          ? checkCommands(entry.commands)
          : [
              {
                name: "App",
                command: checkArgv(entry.command),
                ...(entry.url ? { url: normalizeLocalURL(entry.url) } : {}),
              },
            ];
      const primary = commands[primaryIndex(commands)];
      const setupSteps = entry.setup ? checkSteps(entry.setup) : null,
        stopSteps = entry.stop ? checkSteps(entry.stop) : null;
      return {
        command: primary.command,
        ...(primary.url ? { url: primary.url } : {}),
        commands,
        // `setup` is the first step (older callers); setupSteps lists every step.
        ...(setupSteps ? { setup: setupSteps[0], setupSteps } : {}),
        ...(stopSteps ? { stopSteps } : {}),
        updatedAt: entry.updatedAt || null,
      };
    } catch {
      return null;
    }
  }
  async configure(root, { command, url, setup, stop, commands } = {}) {
    const data = await this.loadConfig();
    if (command === null && !commands) delete data.projects[root];
    else {
      const list = commands
        ? checkCommands(commands)
        : [
            {
              name: "App",
              command: checkArgv(command),
              ...(url ? { url: normalizeLocalURL(url) } : {}),
            },
          ];
      const primary = list[primaryIndex(list)];
      const setupSteps = setup ? checkSteps(setup) : null,
        stopSteps = stop ? checkSteps(stop) : null;
      data.projects[root] = {
        command: primary.command,
        ...(primary.url ? { url: primary.url } : {}),
        ...(list.length > 1 || list[0].name !== "App" ? { commands: list } : {}),
        ...(setupSteps ? { setup: setupSteps.length === 1 ? setupSteps[0] : setupSteps } : {}),
        ...(stopSteps ? { stop: stopSteps } : {}),
        updatedAt: new Date().toISOString(),
      };
    }
    await this.save(data);
    return { config: await this.projectConfig(root), detected: await this.detect(root) };
  }
  /** Setup runs again when its steps change or did not finish: remember the steps that last succeeded. */
  async setupPending(root) {
    const config = await this.projectConfig(root);
    return (
      !!config?.setupSteps &&
      (await this.loadConfig()).setupDone?.[root] !== stepsKey(config.setupSteps)
    );
  }
  async markSetupDone(root, steps) {
    const data = await this.loadConfig();
    data.setupDone ||= {};
    if (steps) data.setupDone[root] = stepsKey(steps);
    else delete data.setupDone[root];
    await this.save(data);
  }
  /** Run argv steps in order in the foreground, stopping at the first failure (like `a && b`). */
  async runSteps(root, steps, { timeoutMs = 60000 } = {}) {
    let result = { exitCode: 0, output: "" };
    const outputs = [];
    for (const step of steps) {
      try {
        result = await this.run(root, step, { timeoutMs });
      } catch (error) {
        result = { exitCode: null, state: "failed", error: error.message, output: error.message };
      }
      outputs.push(result.output || "");
      if (result.exitCode !== 0) break;
    }
    return { ...result, output: outputs.join("\n").slice(-FOREGROUND_OUTPUT) };
  }

  // ---- start command detection ----
  async detect(root) {
    let pkg;
    try {
      const file = path.join(root, "package.json");
      const stat = await fsp.stat(file);
      if (stat.size > 1024 * 1024) return null;
      pkg = JSON.parse(await fsp.readFile(file, "utf8"));
    } catch (error) {
      return error.code === "ENOENT" ? this.detectStatic(root) : null;
    }
    const scripts = pkg && typeof pkg.scripts === "object" ? pkg.scripts : {};
    const script = SCRIPT_ORDER.find(
      (name) => typeof scripts[name] === "string" && scripts[name].trim(),
    );
    if (!script) return null;
    let packageManager = null;
    const declared =
      typeof pkg.packageManager === "string"
        ? /^(npm|pnpm|yarn|bun)@/.exec(pkg.packageManager)
        : null;
    if (declared) packageManager = declared[1];
    else if (["npm", "pnpm", "yarn", "bun"].includes(pkg.devEngines?.packageManager?.name))
      packageManager = pkg.devEngines.packageManager.name;
    if (!packageManager)
      for (const [file, pm] of LOCK_FILES) {
        try {
          await fsp.access(path.join(root, file));
          packageManager = pm;
          break;
        } catch {}
      }
    if (!packageManager)
      for (const candidate of ["npm", "yarn", "pnpm", "bun"]) {
        try {
          resolveProgram(candidate, childEnv());
          packageManager = candidate;
          break;
        } catch {}
      }
    packageManager ||= "npm";
    return {
      command: [packageManager, "run", script],
      script,
      scriptBody: scripts[script].slice(0, 500),
      packageManager,
      source: "package.json",
    };
  }
  async detectStatic(root) {
    try {
      if (!(await fsp.stat(path.join(root, "index.html"))).isFile()) return null;
    } catch {
      return null;
    }
    const env = childEnv();
    // The saved command stays portable (`python3`, or the repository's own `.venv/bin/python`); the
    // interpreter is resolved on PATH only when the command is launched.
    for (const [executable, shown] of [
      [path.join(root, ".venv/bin/python"), ".venv/bin/python"],
      ["python3", "python3"],
      ["python", "python"],
    ]) {
      try {
        const program = resolveProgram(executable, env);
        await fsp.access(program, fs.constants.X_OK);
        return {
          command: [shown, "-u", "-m", "http.server", "8000", "--bind", "127.0.0.1"],
          packageManager: null,
          source: "index.html",
          script: null,
        };
      } catch {
        /* Try the next available interpreter. */
      }
    }
    return null;
  }
  async resolveCommand(root, override) {
    if (override) return { command: checkArgv(override), source: "argument" };
    const config = await this.projectConfig(root);
    if (config) {
      const primary = primaryIndex(config.commands);
      return {
        command: config.command,
        url: config.url,
        source: "saved",
        name: config.commands[primary].name,
        companions: config.commands.filter((_, i) => i !== primary),
      };
    }
    const detected = await this.detect(root);
    if (detected) return { command: detected.command, source: detected.source };
    return null;
  }

  // ---- dev server ----
  describe(proc, root, tailLines = 30) {
    if (!proc) return { state: "stopped", root };
    const running = !proc.exited;
    return {
      state: running
        ? proc.ready
          ? "running"
          : "starting"
        : proc.stopped
          ? "stopped"
          : proc.exitCode === 0
            ? "exited"
            : "failed",
      root,
      command: proc.argv,
      source: proc.source,
      pid: proc.child?.pid || null,
      url: proc.url || null,
      urlSource: proc.urlSource || null,
      startedAt: new Date(proc.startedAt).toISOString(),
      ...(proc.exited ? { exitCode: proc.exitCode, signal: proc.signal } : {}),
      ...(proc.error ? { error: proc.error } : {}),
      logId: proc.id,
      latestSeq: proc.log.seq,
      tail: proc.log.tail(Math.max(1, Math.min(400, Math.floor(Number(tailLines)) || 30))),
      ...(proc.companions?.length
        ? {
            companions: proc.companions.map((c) => ({
              name: c.name,
              command: c.argv,
              state: c.exited
                ? c.stopped
                  ? "stopped"
                  : c.exitCode === 0
                    ? "exited"
                    : "failed"
                : "running",
              ...(c.exited ? { exitCode: c.exitCode } : {}),
              tail: c.log.tail(10),
            })),
          }
        : {}),
      ...(proc.stopResult ? { stopCommand: proc.stopResult } : {}),
    };
  }
  async status(root, { tail } = {}) {
    const [config, detected] = await Promise.all([this.projectConfig(root), this.detect(root)]);
    return {
      ...this.describe(this.servers.get(root), root, tail),
      config,
      detected,
      proposal: await this.proposal(root),
      setupPending: await this.setupPending(root),
    };
  }
  /** Spawn one more start command next to the dev server; it lives and dies with it. */
  launchCompanion(proc, entry) {
    const log = new RingLog();
    const companion = {
      id: `${proc.id}#${entry.name}`,
      kind: "companion",
      root: proc.root,
      name: entry.name,
      argv: entry.command,
      log,
      startedAt: Date.now(),
      exited: false,
    };
    companion.child = launch(entry.command, proc.root, log);
    companion.exitPromise = new Promise((resolve) => {
      companion.child.on("error", (error) => {
        log.push("stderr", `[verynize] ${error.message}`);
        companion.exited = true;
        companion.exitCode = null;
        resolve();
      });
      companion.child.on("exit", (code, signal) => {
        log.flush();
        companion.exited = true;
        companion.exitCode = code;
        companion.signal = signal;
        resolve();
      });
    });
    return companion;
  }
  async start(root, { command, url, waitMs = 20000 } = {}) {
    const existing = this.servers.get(root);
    if (existing && !existing.exited) return { ...(await this.status(root)), alreadyRunning: true };
    // A new attempt supersedes the previous run's exit record, so status() never reports that old failure for it.
    if (existing) this.servers.delete(root);
    const resolved = await this.resolveCommand(root, command);
    if (!resolved)
      throw new Error(
        "No dev server command found: package.json has no dev/start/serve/preview script. Pass command (an argument array) or save one with configure_dev_server.",
      );
    const fixedURL = url ? normalizeLocalURL(url) : resolved.url || null;
    if (fixedURL && (await probe(fixedURL, Date.now() + 500)))
      throw new Error(
        `Preview address ${fixedURL} is already in use. Stop the existing server or choose another port before starting this preview.`,
      );
    const log = new RingLog();
    const proc = {
      id: `dev-server:${root}`,
      kind: "dev-server",
      root,
      argv: resolved.command,
      source: resolved.source,
      log,
      startedAt: Date.now(),
      exited: false,
      url: fixedURL,
      urlSource: fixedURL ? "config" : null,
      ready: false,
      companions: [],
    };
    // Extra start commands first: if one cannot be launched, nothing is left running.
    try {
      for (const entry of resolved.companions || [])
        proc.companions.push(this.launchCompanion(proc, entry));
    } catch (error) {
      await Promise.all(proc.companions.map((c) => terminate(c, 1000)));
      throw error;
    }
    try {
      proc.child = launch(resolved.command, root, log);
    } catch (error) {
      await Promise.all(proc.companions.map((c) => terminate(c, 1000)));
      throw error;
    }
    this.servers.set(root, proc);
    proc.exitPromise = new Promise((resolve) => {
      const ended = () => {
        for (const c of proc.companions)
          if (!c.exited) {
            c.stopped = true;
            void terminate(c, 2000);
          }
        resolve();
      };
      proc.child.on("error", (error) => {
        proc.error = error.message;
        log.push("stderr", `[verynize] ${error.message}`);
        proc.exited = true;
        proc.exitCode = null;
        ended();
      });
      proc.child.on("exit", (code, signal) => {
        log.flush();
        proc.exited = true;
        proc.exitCode = code;
        proc.signal = signal;
        ended();
      });
    });
    const urlFound = new Promise((resolve) => {
      if (proc.url) return resolve();
      const listener = (entry) => {
        const found = detectURL(entry.text);
        if (found) {
          proc.url = found;
          proc.urlSource = "output";
          log.listeners.delete(listener);
          this.watchReady(proc);
          resolve();
        }
      };
      log.listeners.add(listener);
    });
    const deadline = Date.now() + Math.max(0, Math.min(120000, Number(waitMs) || 0));
    let timer;
    await Promise.race([
      urlFound,
      proc.exitPromise,
      new Promise((r) => {
        timer = setTimeout(r, Math.max(0, deadline - Date.now()));
      }),
    ]);
    clearTimeout(timer);
    if (proc.url && !proc.exited)
      proc.ready = await probe(proc.url, Math.max(deadline, Date.now() + 1500));
    if (proc.url && !proc.ready && !proc.exited) this.watchReady(proc);
    return this.status(root);
  }
  watchReady(proc) {
    const tick = async () => {
      if (proc.exited || proc.ready) return;
      proc.ready = await probe(proc.url, Date.now() + 1000);
      if (!proc.ready) setTimeout(tick, 1000).unref?.();
    };
    setTimeout(tick, 500).unref?.();
  }
  async stop(root) {
    const proc = this.servers.get(root);
    if (!proc || proc.exited) return { ...(await this.status(root)), wasRunning: false };
    proc.stopped = true;
    for (const c of proc.companions || []) c.stopped = true;
    await Promise.all([terminate(proc), ...(proc.companions || []).map((c) => terminate(c))]);
    // The saved stop command ends what the start command left behind (containers…). It runs as its own
    // process group with a bounded timeout, only for servers started from the saved configuration.
    const config = proc.source === "saved" ? await this.projectConfig(root) : null;
    if (config?.stopSteps) {
      const result = await this.runSteps(root, config.stopSteps, { timeoutMs: STOP_TIMEOUT });
      proc.stopResult = {
        exitCode: result.exitCode,
        ...(result.state === "timed-out" ? { timedOut: true } : {}),
        tail: String(result.output || "")
          .split("\n")
          .slice(-10)
          .join("\n"),
      };
    }
    return { ...(await this.status(root)), wasRunning: true };
  }

  // ---- terminal commands ----
  async run(root, argv, { timeoutMs = 60000, background = false } = {}) {
    argv = checkArgv(argv);
    timeoutMs = Math.max(
      1000,
      Math.min(background ? 4 * 3600_000 : 600_000, Number(timeoutMs) || 60000),
    );
    if (background && [...this.jobs.values()].filter((j) => !j.exited).length >= MAX_RUNNING_JOBS)
      throw new Error(
        `At most ${MAX_RUNNING_JOBS} background commands may run at once; stop one with read_terminal {id, stop:true}`,
      );
    const id = `job-${randomUUID().slice(0, 8)}`;
    const log = new RingLog();
    const proc = {
      id,
      kind: "command",
      root,
      argv,
      log,
      startedAt: Date.now(),
      exited: false,
      background,
    };
    proc.child = launch(argv, root, log);
    this.jobs.set(id, proc);
    this.pruneJobs();
    proc.exitPromise = new Promise((resolve) => {
      proc.child.on("error", (error) => {
        proc.error = error.message;
        log.push("stderr", `[verynize] ${error.message}`);
        proc.exited = true;
        proc.exitCode = null;
        resolve();
      });
      proc.child.on("exit", (code, signal) => {
        log.flush();
        proc.exited = true;
        proc.exitCode = code;
        proc.signal = signal;
        proc.endedAt = Date.now();
        resolve();
      });
    });
    proc.timer = setTimeout(() => {
      proc.timedOut = true;
      void terminate(proc, 2000);
    }, timeoutMs);
    proc.timer.unref?.();
    proc.exitPromise.then(() => clearTimeout(proc.timer));
    if (background) {
      await Promise.race([proc.exitPromise, new Promise((r) => setTimeout(r, 300))]);
      return this.jobInfo(proc, { tail: 20 });
    }
    await proc.exitPromise;
    await new Promise((r) => setImmediate(r));
    return this.jobInfo(proc, { output: true });
  }
  jobInfo(proc, { output = false, tail = 0 } = {}) {
    const info = {
      id: proc.id,
      command: proc.argv,
      state: proc.exited
        ? proc.timedOut
          ? "timed-out"
          : proc.stopped
            ? "stopped"
            : "exited"
        : "running",
      pid: proc.child?.pid || null,
      background: !!proc.background,
      startedAt: new Date(proc.startedAt).toISOString(),
      ...(proc.exited
        ? {
            exitCode: proc.exitCode,
            signal: proc.signal,
            durationMs: (proc.endedAt || Date.now()) - proc.startedAt,
          }
        : {}),
      ...(proc.error ? { error: proc.error } : {}),
      latestSeq: proc.log.seq,
    };
    if (output) {
      const all = proc.log.entries.map((e) => e.text).join("\n");
      info.output = all.length > FOREGROUND_OUTPUT ? all.slice(-FOREGROUND_OUTPUT) : all;
      info.truncated = all.length > FOREGROUND_OUTPUT || proc.log.dropped > 0;
    }
    if (tail) info.tail = proc.log.tail(tail);
    return info;
  }
  pruneJobs() {
    const finished = [...this.jobs.values()]
      .filter((j) => j.exited)
      .sort((a, b) => a.startedAt - b.startedAt);
    while (this.jobs.size > MAX_JOBS && finished.length) this.jobs.delete(finished.shift().id);
  }
  find(id, root) {
    if (id === "dev-server") return this.servers.get(root) || null;
    const proc = id?.startsWith("dev-server:")
      ? this.servers.get(id.slice("dev-server:".length))
      : this.jobs.get(id);
    return proc && (!root || proc.root === root) ? proc : null;
  }
  read(id, { since = 0, limit = 200, root } = {}) {
    const proc = this.find(id, root);
    if (!proc)
      throw new Error(
        id === "dev-server"
          ? "No dev server has run for this project yet; call start_dev_server"
          : `Unknown terminal id ${id}; list them with read_terminal without an id`,
      );
    const out = proc.log.read({ since, limit });
    return {
      id: proc.id,
      kind: proc.kind,
      command: proc.argv,
      state:
        proc.kind === "dev-server"
          ? this.describe(proc, proc.root).state
          : this.jobInfo(proc).state,
      ...(proc.exited ? { exitCode: proc.exitCode } : {}),
      ...out,
    };
  }
  async kill(id, { root } = {}) {
    const proc = this.find(id, root);
    if (!proc) throw new Error(`Unknown terminal id ${id}`);
    if (!proc.exited) {
      proc.stopped = true;
      await terminate(proc, 2000);
    }
    return proc.kind === "dev-server"
      ? this.describe(proc, proc.root)
      : this.jobInfo(proc, { tail: 20 });
  }
  list(root) {
    const out = [];
    const server = this.servers.get(root);
    if (server)
      out.push({
        id: "dev-server",
        kind: "dev-server",
        command: server.argv,
        state: this.describe(server, root).state,
        latestSeq: server.log.seq,
      });
    for (const job of this.jobs.values())
      if (job.root === root) out.push({ ...this.jobInfo(job), kind: "command" });
    return out;
  }

  /** Synchronous best-effort shutdown for app quit: SIGTERM every group, brief grace, SIGKILL. */
  stopAll() {
    const procs = [
      ...this.servers.values(),
      ...[...this.servers.values()].flatMap((s) => s.companions || []),
      ...this.jobs.values(),
    ].filter((p) => p.child?.pid && (!p.exited || groupAlive(p.child.pid)));
    if (!procs.length) return 0;
    for (const proc of procs) {
      proc.stopped = true;
      killGroup(proc.child, "SIGTERM");
    }
    const until = Date.now() + 400;
    const sleeper = new Int32Array(new SharedArrayBuffer(4));
    while (Date.now() < until && procs.some((p) => groupAlive(p.child.pid)))
      Atomics.wait(sleeper, 0, 0, 25);
    for (const proc of procs) if (groupAlive(proc.child.pid)) killGroup(proc.child, "SIGKILL");
    return procs.length;
  }
}

module.exports = {
  recoverIgnoredBuilds,
  ProcessManager,
  RingLog,
  detectURL,
  normalizeLocalURL,
  checkArgv,
  checkSteps,
  checkCommands,
  childEnv,
};

const { onWindowClosed } = require("./window-cleanup.cjs");
/**
 * Integrated terminal (desktop main process)
 * ==========================================
 * Interactive PTY shells for the code-mode terminal panel (web/src/islands/code/terminal-panel.tsx), backed by
 * node-pty. Registered per window from main.cjs:
 *
 *   registerTerminal(handle, win, {getProject})   getProject() -> {root} | null
 *
 * IPC (all through main.cjs `handle()`, so only the app's own main frame can call them):
 *   terminalCreate({cwd, cols?, rows?}) -> {id, shell, cwd}
 *   terminalWrite({id, data})            data: string of at most WRITE_LIMIT characters (the renderer chunks pastes)
 *   terminalResize({id, cols, rows})     2..1000 columns, 1..500 rows
 *   terminalKill({id})                   -> true when the terminal existed
 *   terminalRecentOutput({cwd?})         -> {id, cwd, text} | null   recent output (ANSI stripped, last RECENT_LIMIT
 *                                           characters) of the most recently active terminal, preferring one in `cwd`;
 *                                           the chat composer's "+ › Terminal output" attaches it
 * Events (webContents.send):
 *   desktop:terminal-data  {id, data}            output, batched per OUTPUT_FLUSH_MS and cut into MESSAGE_LIMIT pieces
 *   desktop:terminal-exit  {id, exitCode, signal} sent once, after the last data event
 *
 * Shell: the user's login shell (`$SHELL` when it is an absolute, executable path, else /bin/zsh), started as a login
 * shell (`-l`) like Terminal.app, with TERM=xterm-256color, COLORTERM=truecolor and TERM_PROGRAM=Verynize. Electron's
 * own variables (ELECTRON_RUN_AS_NODE, …) are removed from the environment.
 *
 * Limits: MAX_PER_WINDOW live terminals per window. Every terminal of a window is killed when the window closes, and
 * every terminal of the app before quit (SIGHUP to the shell's process group, then SIGKILL).
 *
 * Working-directory guard (`isAllowedTerminalCwd`): the cwd must be an absolute, existing directory (compared after
 * realpath) that is
 *   - the window's open project root or a folder inside it,
 *   - one of the project's registered `git worktree list` entries (or a folder inside one), or
 *   - a folder under ~/Verynize/workspaces/.
 * The repository registry (built separately) can widen or narrow that policy with
 *   setTerminalCwdValidator(fn)   fn(realCwd, {projectRoot, defaultAllowed, win}) -> boolean | Promise<boolean>
 * When a validator is installed its answer is final (return `context.defaultAllowed` to keep the default policy as
 * a fallback); pass null to remove it. The cwd is always realpath-resolved and checked to be a directory first.
 */
const fs = require("node:fs/promises");
const fsSync = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { app } = require("electron");

const MAX_PER_WINDOW = 8;
const WRITE_LIMIT = 64 * 1024; // characters per terminalWrite call
const MESSAGE_LIMIT = 64 * 1024; // characters per desktop:terminal-data message
const OUTPUT_FLUSH_MS = 8;
const RECENT_LIMIT = 16 * 1024; // characters of recent output kept per terminal for terminalRecentOutput
const DEFAULT_COLS = 80,
  DEFAULT_ROWS = 24;
const workspacesRoot = () => path.join(os.homedir(), "Verynize", "workspaces");

let pty = null;
function loadPty() {
  if (!pty) pty = require("node-pty");
  return pty;
}

let customValidator = null;
/** Installs (or with null, removes) the policy hook described in the header. */
function setTerminalCwdValidator(fn) {
  if (fn !== null && typeof fn !== "function")
    throw TypeError("setTerminalCwdValidator expects a function or null");
  customValidator = fn;
}

const inside = (parent, child) =>
  child === parent || child.startsWith(parent.endsWith(path.sep) ? parent : parent + path.sep);

async function realDirectory(cwd) {
  if (typeof cwd !== "string" || !cwd || cwd.includes("\0") || !path.isAbsolute(cwd)) return null;
  try {
    const real = await fs.realpath(cwd);
    return (await fs.stat(real)).isDirectory() ? real : null;
  } catch {
    return null;
  }
}

async function worktreeRoots(projectRoot) {
  try {
    const { GitChanges } = require("./git-changes.cjs");
    const listing = await new GitChanges(projectRoot).git(
      ["worktree", "list", "--porcelain", "-z"],
      { timeout: 5000 },
    );
    if (listing.code !== 0) return [];
    const roots = [];
    for (const record of listing.stdout.split("\0")) {
      if (!record.startsWith("worktree ")) continue;
      const real = await fs.realpath(record.slice(9)).catch(() => null);
      if (real) roots.push(real);
    }
    return roots;
  } catch {
    return [];
  }
}

/** Default policy on an already realpath-resolved directory. */
async function defaultAllowed(real, projectRoot) {
  const workspaces = await fs.realpath(workspacesRoot()).catch(() => null);
  if (workspaces && real !== workspaces && inside(workspaces, real)) return true;
  if (!projectRoot) return false;
  const root = await fs.realpath(projectRoot).catch(() => null);
  if (!root) return false;
  if (inside(root, real)) return true;
  return (await worktreeRoots(root)).some((tree) => inside(tree, real));
}

/**
 * Resolves the requested cwd to its realpath when the policy allows it, else null.
 * `context.projectRoot` is the window's open project root (or null).
 */
async function isAllowedTerminalCwd(cwd, context = {}) {
  const real = await realDirectory(cwd);
  if (!real) return null;
  const projectRoot = context.projectRoot || null;
  const allowed = await defaultAllowed(real, projectRoot);
  if (customValidator)
    return (await customValidator(real, {
      projectRoot,
      defaultAllowed: allowed,
      win: context.win || null,
    })) === true
      ? real
      : null;
  return allowed ? real : null;
}

function userShell() {
  const candidate = process.env.SHELL;
  if (candidate && path.isAbsolute(candidate)) {
    try {
      fsSync.accessSync(candidate, fsSync.constants.X_OK);
      return candidate;
    } catch {}
  }
  return "/bin/zsh";
}

function shellEnv() {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === "string" && !key.startsWith("ELECTRON_")) env[key] = value;
  }
  Object.assign(env, {
    TERM: "xterm-256color",
    COLORTERM: "truecolor",
    TERM_PROGRAM: "Verynize",
    TERM_PROGRAM_VERSION: app.getVersion(),
  });
  if (!env.LANG) env.LANG = "en_US.UTF-8";
  return env;
}

const size = (value, min, max, fallback) =>
  Number.isInteger(value) && value >= min && value <= max ? value : fallback;
function checkSize(cols, rows) {
  if (
    !Number.isInteger(cols) ||
    cols < 2 ||
    cols > 1000 ||
    !Number.isInteger(rows) ||
    rows < 1 ||
    rows > 500
  )
    throw Error("Invalid terminal size");
}

// Every live terminal of the app, for the quit-time sweep.
const allTerminals = new Set();

function signalGroup(term, signal) {
  const pid = term.proc?.pid;
  if (!pid) return;
  try {
    process.kill(-pid, signal);
  } catch {
    try {
      process.kill(pid, signal);
    } catch {}
  }
}
const groupAlive = (pid) => {
  try {
    process.kill(-pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
};

// Membership ends only when the native exit callback has been delivered.
const pendingExit = new Set();
let quitting = false;
let drainPromise;
function shutdownTerminals(terms) {
  const list = [...terms];
  for (const term of list) {
    if (term.shutdown) continue;
    signalGroup(term, "SIGHUP");
    term.shutdown = new Promise((resolve) =>
      setTimeout(() => {
        if (groupAlive(term.proc.pid)) signalGroup(term, "SIGKILL");
        if (pendingExit.has(term)) {
          try {
            term.proc.kill("SIGKILL");
          } catch {}
        }
        resolve();
      }, 300),
    );
  }
  return Promise.all(list.map((term) => term.shutdown));
}
function waitForExits() {
  return new Promise((resolve) => {
    const deadline = Date.now() + 2000;
    const check = () => {
      if (!pendingExit.size || Date.now() >= deadline) return resolve();
      setTimeout(check, 10);
    };
    check();
  });
}
function drainTerminals() {
  quitting = true;
  return (drainPromise ||= shutdownTerminals(pendingExit)
    .then(waitForExits)
    .then(() => {
      if (!pendingExit.size) console.log("terminals drained");
    }));
}
let quitHooked = false;
function hookQuit() {
  if (quitHooked) return;
  quitHooked = true;
  let terminalsDrained = false;
  app.on("before-quit", (event) => {
    quitting = true;
    if (terminalsDrained || !pendingExit.size) return;
    event.preventDefault();
    if (drainPromise) return;
    drainTerminals().finally(() => {
      terminalsDrained = true;
      app.quit();
    });
  });
  app.on("will-quit", () => {
    for (const term of pendingExit) {
      signalGroup(term, "SIGKILL");
      try {
        term.proc.kill("SIGKILL");
      } catch {}
    }
  });
}

/** Terminal output as plain text: ANSI/OSC escape sequences removed, carriage-return overwrites applied. */
function plainTerminalText(raw) {
  /* oxlint-disable no-control-regex -- removing escape sequences and control characters is the point */
  const text = String(raw)
    .replace(/\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g, "")
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\u001b[@-Z\\-_]/g, "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");
  /* oxlint-enable no-control-regex */
  return text
    .split("\n")
    .map((line) => line.split("\r").filter(Boolean).pop() ?? "")
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function registerTerminal(handle, win, { getProject } = {}) {
  hookQuit();
  const terminals = new Map(); // id -> terminal
  const send = (channel, payload) => {
    if (!win.isDestroyed() && !win.webContents.isDestroyed())
      win.webContents.send(channel, payload);
  };

  const flush = (term) => {
    if (term.timer) {
      clearTimeout(term.timer);
      term.timer = null;
    }
    if (!term.pending) return;
    const data = term.pending;
    term.pending = "";
    for (let offset = 0; offset < data.length; offset += MESSAGE_LIMIT)
      send("desktop:terminal-data", {
        id: term.id,
        data: data.slice(offset, offset + MESSAGE_LIMIT),
      });
  };

  const get = (options) => {
    const term = options && typeof options.id === "string" ? terminals.get(options.id) : null;
    if (!term) throw Error("That terminal is no longer running");
    return term;
  };

  handle("terminalCreate", async (options) => {
    if (!options || typeof options !== "object") throw Error("Invalid terminal options");
    if (terminals.size >= MAX_PER_WINDOW)
      throw Error(`At most ${MAX_PER_WINDOW} terminals can be open in a window`);
    const projectRoot = (typeof getProject === "function" && getProject()?.root) || null;
    const cwd = await isAllowedTerminalCwd(options.cwd, { projectRoot, win });
    if (!cwd)
      throw Error(
        "The terminal can only open in the current project, one of its worktrees, or a Verynize workspace",
      );
    if (terminals.size >= MAX_PER_WINDOW)
      throw Error(`At most ${MAX_PER_WINDOW} terminals can be open in a window`);
    if (quitting || win.isDestroyed()) throw Error("The window is closed or the app is quitting");
    const shell = userShell();
    const cols = size(options.cols, 2, 1000, DEFAULT_COLS),
      rows = size(options.rows, 1, 500, DEFAULT_ROWS);
    const proc = loadPty().spawn(shell, ["-l"], {
      name: "xterm-256color",
      cols,
      rows,
      cwd,
      env: shellEnv(),
      encoding: "utf8",
    });
    const term = {
      id: crypto.randomUUID(),
      proc,
      pending: "",
      timer: null,
      cwd,
      recent: "",
      activeAt: Date.now(),
    };
    terminals.set(term.id, term);
    allTerminals.add(term);
    pendingExit.add(term);
    proc.onData((data) => {
      try {
        if (quitting) return;
        term.recent = (term.recent + data).slice(-RECENT_LIMIT * 2);
        term.activeAt = Date.now();
        term.pending += data;
        if (term.pending.length >= MESSAGE_LIMIT) flush(term);
        else if (!term.timer)
          term.timer = setTimeout(() => {
            try {
              if (!quitting) flush(term);
            } catch {}
          }, OUTPUT_FLUSH_MS);
      } catch {}
    });
    proc.onExit(({ exitCode, signal }) => {
      try {
        pendingExit.delete(term);
        if (term.timer) clearTimeout(term.timer);
        terminals.delete(term.id);
        allTerminals.delete(term);
        if (quitting) return;
        flush(term);
        if (groupAlive(proc.pid)) signalGroup(term, "SIGHUP"); // leftover jobs of the closed session
        send("desktop:terminal-exit", {
          id: term.id,
          exitCode: exitCode ?? null,
          signal: signal || null,
        });
      } catch {}
    });
    return { id: term.id, shell: path.basename(shell), cwd };
  });

  handle("terminalWrite", (options) => {
    const term = get(options);
    if (typeof options.data !== "string" || options.data.length > WRITE_LIMIT)
      throw Error("Terminal input must be text of at most 64 KB per write");
    if (options.data) term.proc.write(options.data);
    return true;
  });

  handle("terminalResize", (options) => {
    const term = get(options);
    checkSize(options.cols, options.rows);
    term.proc.resize(options.cols, options.rows);
    return true;
  });

  handle("terminalKill", (options) => {
    const term = options && typeof options.id === "string" ? terminals.get(options.id) : null;
    if (!term) return false;
    signalGroup(term, "SIGHUP");
    setTimeout(() => {
      if (term.proc.pid && groupAlive(term.proc.pid)) signalGroup(term, "SIGKILL");
    }, 1500).unref?.();
    return true;
  });

  handle("terminalRecentOutput", async (options = {}) => {
    const want =
      typeof options?.cwd === "string" && options.cwd
        ? await fs.realpath(options.cwd).catch(() => options.cwd)
        : null;
    const list = [...terminals.values()]
      .filter((term) => term.recent)
      .sort((a, b) => b.activeAt - a.activeAt);
    const term = (want && list.find((t) => t.cwd === want || inside(want, t.cwd))) || list[0];
    if (!term) return null;
    return {
      id: term.id,
      cwd: term.cwd,
      text: plainTerminalText(term.recent).slice(-RECENT_LIMIT),
    };
  });

  onWindowClosed(win, () => {
    void shutdownTerminals(terminals.values());
    terminals.clear();
  });
  return { count: () => terminals.size, killAll: () => shutdownTerminals(terminals.values()) };
}

module.exports = {
  drainTerminals,
  pendingExitCount: () => pendingExit.size,
  registerTerminal,
  plainTerminalText,
  isAllowedTerminalCwd,
  setTerminalCwdValidator,
  MAX_PER_WINDOW,
  WRITE_LIMIT,
};

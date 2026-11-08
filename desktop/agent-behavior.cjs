/**
 * Agent behaviour settings (Settings › Agents, lower half)
 * =========================================================
 * One JSON file, <userData>/agent-behavior.json, read by the main process (agent runtime, repositories)
 * and by the renderer through IPC:
 *
 *   followUp           'queue' | 'steer'   default way a message sent during a running turn goes (⌘↵ = the other way)
 *   expandWork         boolean             thinking and tool calls render unfolded
 *   claudeOutputStyle  ''|style name       '' = use the Claude Code setting; else passed as SDK settings.outputStyle
 *   codexPersonality   'default' | 'none'  'none' → thread/start personality:"none" (Codex config key `personality`)
 *   creditAgent        boolean             false → Claude settings.attribution {commit:'',pr:''} (+ includeCoAuthoredBy:false)
 *   folder             ''|absolute path    where new projects and worktrees go ('' = ~/Verynize)
 *   branchPrefix       ''|ref prefix       new worktree branches start with it ('' = GitHub username, else "verynize")
 *   repoModes          {repoId: access}    per-repository access for new chats (the Default lives in the chat defaults)
 *
 *   registerAgentBehavior(handle, win, {store, registry, dialog, shell, getRuntime, userData})
 *     agentBehaviorGet, agentBehaviorSet, agentBehaviorChooseFolder, agentOutputStyles, agentCommitAuthor,
 *     agentAllowList, agentAllowRemove, agentAllowOpen
 */
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { randomBytes } = require("node:crypto");
const permissions = require("./agent-permissions.cjs");
const exec = promisify(execFile);

const ACCESS = ["ask", "edit", "auto", "full"];
const DEFAULTS = Object.freeze({
  followUp: "queue",
  expandWork: false,
  claudeOutputStyle: "",
  codexPersonality: "default",
  creditAgent: true,
  folder: "",
  branchPrefix: "",
  repoModes: Object.freeze({}),
});
const STYLE = /^[\w .:-]{1,100}$/;
const PREFIX = /^[A-Za-z0-9][A-Za-z0-9._-]{0,60}(?:\/[A-Za-z0-9][A-Za-z0-9._-]{0,60}){0,3}$/;
const REPO_ID = /^[a-zA-Z0-9-]{1,80}$/;

/** A branch prefix git accepts as a ref component path ('' when empty after trimming slashes). Throws when invalid. */
function normalizeBranchPrefix(value) {
  const prefix = String(value ?? "")
    .trim()
    .replace(/^\/+|\/+$/g, "");
  if (!prefix) return "";
  if (!PREFIX.test(prefix) || prefix.includes("..") || /\.lock(\/|$)|\.(\/|$)/.test(prefix))
    throw Error("Use letters, numbers, dots, dashes or slashes for the branch prefix");
  return prefix;
}

function normalizeBehavior(input = {}, base = DEFAULTS) {
  const out = { ...DEFAULTS, ...base, repoModes: { ...(base.repoModes || {}) } };
  const value = input && typeof input === "object" ? input : {};
  if ("followUp" in value) {
    if (!["queue", "steer"].includes(value.followUp)) throw Error("Choose Steer or Queue");
    out.followUp = value.followUp;
  }
  if ("expandWork" in value) out.expandWork = value.expandWork === true;
  if ("creditAgent" in value) out.creditAgent = value.creditAgent !== false;
  if ("claudeOutputStyle" in value) {
    const style = String(value.claudeOutputStyle ?? "").trim();
    if (style && !STYLE.test(style)) throw Error("Invalid output style");
    out.claudeOutputStyle = style;
  }
  if ("codexPersonality" in value) {
    if (!["default", "none"].includes(value.codexPersonality))
      throw Error("Choose Default or None");
    out.codexPersonality = value.codexPersonality;
  }
  if ("folder" in value) {
    const folder = String(value.folder ?? "");
    if (folder && (!path.isAbsolute(folder) || folder.includes("\0")))
      throw Error("Choose a folder");
    out.folder = folder;
  }
  if ("branchPrefix" in value) out.branchPrefix = normalizeBranchPrefix(value.branchPrefix);
  if ("repoModes" in value) {
    const modes = value.repoModes && typeof value.repoModes === "object" ? value.repoModes : {};
    for (const [id, mode] of Object.entries(modes)) {
      if (!REPO_ID.test(id)) continue;
      if (mode === null || mode === "" || mode === "default") delete out.repoModes[id];
      else if (ACCESS.includes(mode)) out.repoModes[id] = mode;
      else throw Error("Choose Ask, Edit, Auto, or Full access");
    }
  }
  return out;
}

class AgentBehaviorStore {
  constructor({ file }) {
    if (!file) throw Error("Behavior file required");
    this.file = file;
    this.data = null;
    this.queue = Promise.resolve();
  }
  async get() {
    if (this.data) return { ...this.data, repoModes: { ...this.data.repoModes } };
    let raw = {};
    try {
      raw = JSON.parse(await fs.readFile(this.file, "utf8"));
    } catch {}
    let data;
    try {
      data = normalizeBehavior(raw);
    } catch {
      data = normalizeBehavior({});
    }
    this.data ||= data;
    return { ...this.data, repoModes: { ...this.data.repoModes } };
  }
  set(patch) {
    const run = async () => {
      const next = normalizeBehavior(patch, await this.get());
      await fs.mkdir(path.dirname(this.file), { recursive: true });
      const temp = `${this.file}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
      await fs.writeFile(temp, JSON.stringify(next, null, 2) + "\n", { mode: 0o600 });
      await fs.rename(temp, this.file);
      this.data = next;
      return this.get();
    };
    const next = this.queue.then(run, run);
    this.queue = next.catch(() => {});
    return next;
  }
}

/* ---------- Folders and branch names ---------- */
const defaultFolder = (env = process.env) =>
  env.VERYNIZE_HOME_DIR || path.join(os.homedir(), "Verynize");
const folderOf = (behavior, env = process.env) => behavior?.folder || defaultFolder(env);
/** Worktrees go to <folder>/workspaces (VERYNIZE_WORKSPACES_DIR still wins, for tests and power users). */
const workspacesOf = (behavior, env = process.env) =>
  env.VERYNIZE_WORKSPACES_DIR || path.join(folderOf(behavior, env), "workspaces");
const tildify = (file, home = os.homedir()) =>
  file === home ? "~" : file.startsWith(home + path.sep) ? "~" + file.slice(home.length) : file;

/* ---------- GitHub (gh) ---------- */
const run = (cmd, args, timeout = 8000) =>
  exec(cmd, args, {
    timeout,
    maxBuffer: 1024 * 1024,
    env: { ...process.env, GH_PROMPT_DISABLED: "1", GIT_TERMINAL_PROMPT: "0" },
  }).then((r) => r.stdout.trim());
let loginCache = null;
/** The gh-authenticated GitHub login, or '' (cached for 10 minutes). */
function githubLogin({ runner = run } = {}) {
  const cached = runner === run;
  if (cached && loginCache && Date.now() - loginCache.at < 600000) return loginCache.value;
  const value = runner("gh", ["api", "user", "--jq", ".login"])
    .then((login) => (/^[A-Za-z0-9-]{1,39}$/.test(login) ? login : ""))
    .catch(() => "");
  if (cached) loginCache = { at: Date.now(), value };
  return value;
}

/** Branch prefix for a new worktree: the setting, VERYNIZE_BRANCH_PREFIX, the GitHub username, else "verynize". */
async function resolveBranchPrefix(behavior, { env = process.env, login = githubLogin } = {}) {
  try {
    const own = normalizeBranchPrefix(behavior?.branchPrefix);
    if (own) return own;
  } catch {}
  try {
    const fromEnv = normalizeBranchPrefix(env.VERYNIZE_BRANCH_PREFIX);
    if (fromEnv) return fromEnv;
  } catch {}
  const user = String(await login()).toLowerCase();
  return user || "verynize";
}

/** Global git identity plus whether GitHub links the email to the gh account (null = unknown). */
async function commitAuthor({ runner = run } = {}) {
  const read = (key) => runner("git", ["config", "--global", "--get", key], 4000).catch(() => "");
  const [name, email] = await Promise.all([read("user.name"), read("user.email")]);
  const login = await githubLogin({ runner });
  let linked = null;
  if (login && email) {
    const lower = email.toLowerCase();
    if (/@users\.noreply\.github\.com$/.test(lower))
      linked = lower.split("@")[0].replace(/^\d+\+/, "") === login.toLowerCase();
    else {
      try {
        const emails = (
          await runner("gh", ["api", "user/emails", "--jq", ".[] | select(.verified) | .email"])
        )
          .split("\n")
          .map((e) => e.trim().toLowerCase())
          .filter(Boolean);
        linked = emails.includes(lower);
      } catch {
        linked = null;
      } // token without the user:email scope: no warning
    }
  }
  return { name, email, login: login || null, linked };
}

/* ---------- Claude output styles ---------- */
const BUILT_IN_STYLES = [
  { id: "default", name: "Default", description: "Efficient, concise answers for software work." },
  {
    id: "Explanatory",
    name: "Explanatory",
    description: "Explains implementation choices and codebase patterns as it works.",
  },
  {
    id: "Learning",
    name: "Learning",
    description: "Collaborative, asks you to write small pieces yourself.",
  },
];
function frontmatter(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  const out = {};
  if (match)
    for (const line of match[1].split(/\r?\n/)) {
      const kv = /^([A-Za-z_-]+)\s*:\s*(.*)$/.exec(line);
      if (kv) out[kv[1]] = kv[2].replace(/^["']|["']$/g, "").trim();
    }
  return out;
}
/** Built-in styles + custom ones from ~/.claude/output-styles/*.md; `current` = outputStyle in ~/.claude/settings.json. */
async function outputStyles({ home = os.homedir() } = {}) {
  const styles = [...BUILT_IN_STYLES.map((s) => ({ ...s, source: "built-in" }))];
  const dir = path.join(home, ".claude", "output-styles");
  let names = [];
  try {
    names = (await fs.readdir(dir)).filter((n) => n.endsWith(".md")).sort();
  } catch {}
  for (const file of names) {
    try {
      const meta = frontmatter(await fs.readFile(path.join(dir, file), "utf8"));
      const name = (meta.name || file.slice(0, -3)).slice(0, 100);
      if (!STYLE.test(name) || styles.some((s) => s.id.toLowerCase() === name.toLowerCase()))
        continue;
      styles.push({
        id: name,
        name,
        description: (meta.description || "").slice(0, 200),
        source: "custom",
      });
    } catch {}
  }
  let current = null;
  try {
    const value = JSON.parse(
      await fs.readFile(path.join(home, ".claude", "settings.json"), "utf8"),
    )?.outputStyle;
    if (typeof value === "string") current = value;
  } catch {}
  return { styles, current };
}

/* ---------- Runtime options ---------- */
/** Claude Agent SDK `settings` (flag layer) for the behaviour, or null when nothing differs from the user's setup. */
function claudeSettingsFor(behavior) {
  const out = {};
  if (behavior?.claudeOutputStyle) out.outputStyle = behavior.claudeOutputStyle;
  if (behavior && behavior.creditAgent === false) {
    out.attribution = { commit: "", pr: "" };
    out.includeCoAuthoredBy = false;
  }
  return Object.keys(out).length ? out : null;
}
/** Codex thread/start `personality` (only "none" is sent; Default leaves Codex's own setting). */
const codexPersonalityFor = (behavior) => (behavior?.codexPersonality === "none" ? "none" : null);

/* ---------- IPC ---------- */
function registerAgentBehavior(
  handle,
  win,
  { store, registry, dialog, shell, getRuntime, userData },
) {
  const view = async () => {
    const behavior = await store.get();
    const folder = folderOf(behavior);
    return {
      ...behavior,
      resolvedFolder: folder,
      displayFolder: tildify(folder),
      defaultFolder: tildify(defaultFolder()),
    };
  };
  handle("agentBehaviorGet", () => view());
  handle("agentBehaviorSet", async (patch) => {
    await store.set(patch);
    return view();
  });
  handle("agentBehaviorChooseFolder", async () => {
    const current = folderOf(await store.get());
    const result = await dialog.showOpenDialog(win, {
      title: "Choose the Verynize folder",
      defaultPath: current,
      properties: ["openDirectory", "createDirectory"],
    });
    if (result.canceled || !result.filePaths[0]) return view();
    await store.set({ folder: await fs.realpath(result.filePaths[0]) });
    return view();
  });
  handle("agentOutputStyles", () => outputStyles());
  handle("agentCommitAuthor", () => commitAuthor());

  const groups = async () => {
    const runtime = getRuntime?.();
    const repositories = registry ? await registry.list().catch(() => []) : [];
    const verynize = runtime
      ? (await runtime.listAllowRules({}).catch(() => ({ rules: {} }))).rules
      : {};
    const scopeOf = async (key) => {
      try {
        return (await registry.resolveRoot(key)).repository.name;
      } catch {
        return null;
      }
    };
    return permissions.listAllowGroups({
      repositories,
      verynize,
      verynizeFile: path.join(userData, "agent-allow-rules.json"),
      scopeOf,
    });
  };
  handle("agentAllowList", () => groups());
  handle("agentAllowRemove", async (id) => {
    if (typeof id !== "string") throw Error("Invalid rule");
    const runtime = getRuntime?.();
    return permissions.removeAllowRule(await groups(), id, {
      removeVerynize: async (projectKey, rule) =>
        (await runtime.removeAllowRule({ projectKey, rule })).removed,
    });
  });
  handle("agentAllowOpen", async (groupId) => {
    const group = (await groups()).find((g) => g.id === groupId);
    if (!group?.file) throw Error("That file is no longer listed");
    const error = await shell.openPath(group.file);
    if (error) throw Error(error);
    return true;
  });
}

module.exports = {
  DEFAULTS,
  AgentBehaviorStore,
  normalizeBehavior,
  normalizeBranchPrefix,
  resolveBranchPrefix,
  defaultFolder,
  folderOf,
  workspacesOf,
  tildify,
  githubLogin,
  commitAuthor,
  outputStyles,
  claudeSettingsFor,
  codexPersonalityFor,
  registerAgentBehavior,
};

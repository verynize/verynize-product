// Settings › Memory: what each installed agent remembers, read from the files the agents own.
//
// - Chats without a repository (quick chats) share one Claude Code auto-memory folder,
//   userData/agent-memory/<id>, passed to the SDK as the `autoMemoryDirectory` flag setting
//   (desktop/agent-runtime.cjs). Its id is created once and kept in userData/agent-memory/index.json.
// - About you: Codex memories (`[features] memories` in ~/.codex/config.toml, files in ~/.codex/memories:
//   rollout_summaries/*.md = conversation summaries, skills/<name>/ = skills) and Claude Code user memory
//   (~/.claude/CLAUDE.md, auto memory under ~/.claude/projects/*/memory or `autoMemoryDirectory`).
// - Instructions your chats load: ~/.codex/AGENTS.md (Codex reads it; Verynize adds it to Claude Code
//   chats, see homeInstructions) and ~/.claude/CLAUDE.md (Claude Code reads it).
//
// `VERYNIZE_AGENT_HOME` replaces the home folder (tests point it at a temp dir).
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { randomUUID } = require("node:crypto");

const INSTRUCTIONS_LIMIT = 12000;
const FILE_LIST_LIMIT = 200;

const resolveHome = (env = process.env) =>
  env.VERYNIZE_AGENT_HOME && path.isAbsolute(env.VERYNIZE_AGENT_HOME)
    ? env.VERYNIZE_AGENT_HOME
    : os.homedir();
const tilde = (file, home) =>
  file === home ? "~" : file.startsWith(home + path.sep) ? "~" + file.slice(home.length) : file;
const expand = (file, home) =>
  typeof file !== "string" || !file.trim()
    ? null
    : file.startsWith("~/")
      ? path.join(home, file.slice(2))
      : path.isAbsolute(file)
        ? file
        : null;
const exists = async (file) => {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
};
const isDir = async (dir) => {
  try {
    return (await fs.stat(dir)).isDirectory();
  } catch {
    return false;
  }
};
const truthy = (value) => /^(1|true|yes|on)$/i.test(String(value || "").trim());

const paths = (home) => ({
  codexConfig: path.join(home, ".codex", "config.toml"),
  codexMemories: path.join(home, ".codex", "memories"),
  codexAgents: path.join(home, ".codex", "AGENTS.md"),
  claudeUser: path.join(home, ".claude", "CLAUDE.md"),
  claudeSettings: path.join(home, ".claude", "settings.json"),
  claudeProjects: path.join(home, ".claude", "projects"),
});

/** The shared memory folder of chats without a repository (created on first use). */
async function repoLessMemoryDir(userData) {
  const root = path.join(userData, "agent-memory");
  const index = path.join(root, "index.json");
  let id = null;
  try {
    const raw = JSON.parse(await fs.readFile(index, "utf8"));
    if (
      typeof raw?.chatsWithoutRepository === "string" &&
      /^[0-9a-f-]{36}$/.test(raw.chatsWithoutRepository)
    )
      id = raw.chatsWithoutRepository;
  } catch {}
  if (!id) {
    id = randomUUID();
    await fs.mkdir(root, { recursive: true });
    await fs.writeFile(index, JSON.stringify({ chatsWithoutRepository: id }, null, 2));
  }
  const dir = path.join(root, id);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

/**
 * `features.memories` from a Codex config.toml: true / false, or null when unset.
 * Handles `[features]` tables, dotted keys (`features.memories = true`) and inline tables.
 */
function codexMemoriesSetting(toml) {
  if (typeof toml !== "string") return null;
  let table = "",
    value = null;
  for (const rawLine of toml.split(/\r?\n/)) {
    const line = rawLine.replace(/(^|\s)#.*$/, "").trim();
    if (!line) continue;
    const header = line.match(/^\[\s*([^\][]+?)\s*\]$/);
    if (header) {
      table = header[1].replace(/["'\s]/g, "");
      continue;
    }
    if (/^\[\[/.test(line)) {
      table = "\u0000";
      continue;
    }
    const pair = line.match(/^([A-Za-z0-9_."'\- ]+?)\s*=\s*(.+)$/);
    if (!pair) continue;
    const key = [table, pair[1].replace(/["'\s]/g, "")].filter(Boolean).join(".");
    const raw = pair[2].trim();
    if (key === "features.memories") {
      if (/^true\b/.test(raw)) value = true;
      else if (/^false\b/.test(raw)) value = false;
    } else if (key === "features" && raw.startsWith("{")) {
      const m = raw.match(/(?:^|[{,\s])memories\s*=\s*(true|false)\b/);
      if (m) value = m[1] === "true";
    }
  }
  return value;
}

/** Conversation summaries (rollout_summaries/*.md) and skills (skills/<name>/) in a Codex memories folder. */
async function codexMemoryCounts(dir) {
  const count = async (sub, test) => {
    try {
      return (await fs.readdir(path.join(dir, sub), { withFileTypes: true })).filter(test).length;
    } catch {
      return 0;
    }
  };
  return {
    summaries: await count("rollout_summaries", (e) => e.isFile() && e.name.endsWith(".md")),
    skills: await count("skills", (e) => e.isDirectory() && !e.name.startsWith(".")),
  };
}

/** Markdown files at the top of a memory folder, newest first. */
async function listMemoryFiles(dir) {
  let entries = [];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const files = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".md") || entry.name.startsWith(".")) continue;
    try {
      const stat = await fs.stat(path.join(dir, entry.name));
      files.push({ name: entry.name, size: stat.size, modified: stat.mtimeMs });
    } catch {}
  }
  return files.sort((a, b) => b.modified - a.modified).slice(0, FILE_LIST_LIMIT);
}

/** Claude Code auto memory: on unless `autoMemoryEnabled: false` or CLAUDE_CODE_DISABLE_AUTO_MEMORY. */
async function claudeAutoMemory({ home, env = process.env }) {
  let settings = {};
  try {
    settings = JSON.parse(await fs.readFile(paths(home).claudeSettings, "utf8")) || {};
  } catch {}
  const enabled =
    settings.autoMemoryEnabled !== false && !truthy(env.CLAUDE_CODE_DISABLE_AUTO_MEMORY);
  return { enabled, directory: expand(settings.autoMemoryDirectory, home) };
}

/** Repositories whose Claude Code auto-memory folder holds at least one file. */
async function claudeProjectsWithMemory(home) {
  let entries = [];
  try {
    entries = await fs.readdir(paths(home).claudeProjects, { withFileTypes: true });
  } catch {
    return 0;
  }
  let total = 0;
  for (const entry of entries)
    if (
      entry.isDirectory() &&
      (await listMemoryFiles(path.join(paths(home).claudeProjects, entry.name, "memory"))).length
    )
      total++;
  return total;
}

async function fileInfo(file, home) {
  try {
    const stat = await fs.stat(file);
    return {
      path: file,
      displayPath: tilde(file, home),
      exists: stat.isFile(),
      size: stat.size,
      modified: stat.mtimeMs,
    };
  } catch {
    return { path: file, displayPath: tilde(file, home), exists: false, size: 0, modified: null };
  }
}

async function readText(file) {
  try {
    return await fs.readFile(file, "utf8");
  } catch {
    return "";
  }
}

/** Everything the Memory page shows. Paths are the user's own files; no file contents are returned. */
async function memoryOverview({ userData, home = resolveHome(), env = process.env } = {}) {
  const p = paths(home);
  const repoLessDir = await repoLessMemoryDir(userData);
  const auto = await claudeAutoMemory({ home, env });
  const codexToml = await readText(p.codexConfig);
  const codexEnabled = codexMemoriesSetting(codexToml);
  return {
    repoLess: {
      claude: {
        enabled: auto.enabled,
        dir: repoLessDir,
        displayDir: tilde(repoLessDir, home),
        files: await listMemoryFiles(repoLessDir),
      },
    },
    aboutYou: {
      codex: {
        enabled: codexEnabled === true,
        configured: codexEnabled !== null,
        configPath: tilde(p.codexConfig, home),
        dir: p.codexMemories,
        displayDir: tilde(p.codexMemories, home),
        exists: await isDir(p.codexMemories),
        ...(await codexMemoryCounts(p.codexMemories)),
      },
      claude: {
        enabled: auto.enabled,
        userMemory: await fileInfo(p.claudeUser, home),
        autoMemoryDir: auto.directory
          ? {
              path: auto.directory,
              displayPath: tilde(auto.directory, home),
              files: (await listMemoryFiles(auto.directory)).length,
            }
          : null,
        projectsDir: tilde(p.claudeProjects, home),
        projectsWithMemory: await claudeProjectsWithMemory(home),
      },
    },
    instructions: [
      {
        id: "codexAgents",
        agent: "codex",
        readBy: "Codex",
        sharedWith: "Claude Code",
        ...(await fileInfo(p.codexAgents, home)),
      },
      {
        id: "claudeUser",
        agent: "claude",
        readBy: "Claude Code",
        sharedWith: null,
        ...(await fileInfo(p.claudeUser, home)),
      },
    ],
  };
}

/**
 * Home-folder instructions Verynize adds to a chat's persona because the agent would not read them
 * itself: ~/.codex/AGENTS.md for Claude Code. Skipped when ~/.claude/CLAUDE.md already has the same
 * text or imports it (`@~/.codex/AGENTS.md`).
 */
async function homeInstructions(agent, { home = resolveHome() } = {}) {
  if (agent !== "claude") return "";
  const p = paths(home);
  const text = (await readText(p.codexAgents)).trim();
  if (!text) return "";
  const claudeText = await readText(p.claudeUser);
  if (claudeText.trim() === text || /@~\/\.codex\/AGENTS\.md\b/.test(claudeText)) return "";
  return text.slice(0, INSTRUCTIONS_LIMIT);
}

/** Resolves a renderer request ({kind, name?}) to one of the known paths; anything else is refused. */
async function targetPath({ kind, name } = {}, { userData, home }) {
  const p = paths(home);
  switch (kind) {
    case "repoLess":
      return { file: await repoLessMemoryDir(userData), dir: true };
    case "repoLessFile": {
      if (typeof name !== "string" || name !== path.basename(name) || !name.endsWith(".md"))
        throw Error("Unknown memory file");
      return { file: path.join(await repoLessMemoryDir(userData), name), dir: false };
    }
    case "codexMemories":
      return { file: p.codexMemories, dir: true };
    case "claudeProjects":
      return { file: p.claudeProjects, dir: true };
    case "claudeAutoMemory": {
      const auto = await claudeAutoMemory({ home });
      if (!auto.directory) throw Error("No custom memory folder is set");
      return { file: auto.directory, dir: true };
    }
    case "codexAgents":
      return { file: p.codexAgents, dir: false, create: true };
    case "claudeUser":
      return { file: p.claudeUser, dir: false, create: true };
    default:
      throw Error("Unknown memory location");
  }
}

function registerAgentMemory(handle, { userData, shell }) {
  const home = () => resolveHome();
  handle("agentMemoryOverview", () => memoryOverview({ userData, home: home() }));
  // Show in Finder: folders open in Finder; files are selected in their folder.
  handle("agentMemoryReveal", async (request) => {
    const target = await targetPath(request, { userData, home: home() });
    if (target.dir) {
      if (await isDir(target.file)) {
        const error = await shell.openPath(target.file);
        if (error) throw Error(error);
        return true;
      }
      let parent = path.dirname(target.file);
      while (!(await isDir(parent)) && parent !== path.dirname(parent))
        parent = path.dirname(parent);
      const error = await shell.openPath(parent);
      if (error) throw Error(error);
      return true;
    }
    if (await exists(target.file)) shell.showItemInFolder(target.file);
    else await shell.openPath(path.dirname(target.file));
    return true;
  });
  // Open in the user's default editor; instruction files are created empty on first open.
  handle("agentMemoryOpen", async (request) => {
    const target = await targetPath(request, { userData, home: home() });
    if (target.dir) throw Error("Choose a file");
    if (!(await exists(target.file))) {
      if (!target.create) throw Error("This file no longer exists");
      await fs.mkdir(path.dirname(target.file), { recursive: true });
      await fs.writeFile(target.file, "", { flag: "wx" }).catch((error) => {
        if (error.code !== "EEXIST") throw error;
      });
    }
    const error = await shell.openPath(target.file);
    if (error) throw Error(error);
    return true;
  });
}

module.exports = {
  registerAgentMemory,
  memoryOverview,
  repoLessMemoryDir,
  codexMemoriesSetting,
  codexMemoryCounts,
  listMemoryFiles,
  claudeAutoMemory,
  claudeProjectsWithMemory,
  homeInstructions,
  targetPath,
  resolveHome,
  tilde,
};

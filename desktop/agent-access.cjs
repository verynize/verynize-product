// Settings › Agents › Access: what local agents may do, applied when a chat's agent next starts.
//
// Stored in userData/agent-access.json (like agent-allow-rules.json). desktop/agent-runtime.cjs reads it
// at the start of every turn and turns each switch into real launch options:
//   createFiles      persona + (Claude) a PreToolUse gate that asks before new files / canvas pages
//   shareMemory      the other agent's instruction and memory files are appended to the persona
//   askAgents        the `ask_agent` canvas tool (read-only second opinion from the other model)
//   claudeConnectors claude.ai connectors in Claude chats (ENABLE_CLAUDEAI_MCP_SERVERS)
//   claudeArtifacts  Claude artifact tools (CLAUDE_CODE_DISABLE_ARTIFACT + disallowedTools)
//   claudeChrome     Claude in Chrome (`--chrome` / `--no-chrome`)
//   codexApps        ChatGPT apps in Codex (`features.apps`)
//   codexComputerUse Computer Use in Codex (`features.computer_use`)
//
// Design preference writes (save/update/delete_design_preference) are not a switch: they always need
// the user. preferenceWritePolicy() decides per run whether they are 'approve' (Claude: approval card
// through a PreToolUse hook; Codex: persona rule) or 'blocked' (Ask access, plan-first chats, helper
// runs and the one-shot CLI fallbacks, which cannot show an approval card).
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");

const ACCESS_DEFAULTS = Object.freeze({
  createFiles: true,
  shareMemory: true,
  askAgents: false,
  claudeConnectors: true,
  claudeArtifacts: true,
  claudeChrome: false,
  codexApps: true,
  codexComputerUse: false,
});
const ACCESS_KEYS = Object.keys(ACCESS_DEFAULTS);
const ACCESS_FILE = "agent-access.json";

function normalizeAccessSettings(value) {
  const out = { ...ACCESS_DEFAULTS };
  if (value && typeof value === "object")
    for (const key of ACCESS_KEYS) if (typeof value[key] === "boolean") out[key] = value[key];
  return out;
}

const accessFile = (userData) => path.join(userData, ACCESS_FILE);

async function loadAccessSettings(userData) {
  try {
    return normalizeAccessSettings(JSON.parse(await fs.readFile(accessFile(userData), "utf8")));
  } catch {
    return { ...ACCESS_DEFAULTS };
  }
}

/** Merge `changes` (known boolean keys only) into the stored settings; returns {previous, settings}. */
async function saveAccessSettings(userData, changes) {
  if (!changes || typeof changes !== "object") throw Error("Invalid access settings");
  const previous = await loadAccessSettings(userData);
  const next = { ...previous };
  for (const [key, value] of Object.entries(changes)) {
    if (!ACCESS_KEYS.includes(key)) throw Error(`Unknown access setting: ${key}`);
    if (typeof value !== "boolean") throw Error(`${key} must be on or off`);
    next[key] = value;
  }
  await fs.mkdir(userData, { recursive: true });
  const file = accessFile(userData),
    temp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(temp, JSON.stringify(next, null, 2) + "\n", { mode: 0o600 });
  await fs.rename(temp, file);
  return { previous, settings: next };
}

// --- design preference writes --------------------------------------------------------------------
const PREFERENCE_WRITE_TOOLS = Object.freeze([
  "save_design_preference",
  "update_design_preference",
  "delete_design_preference",
]);
const isPreferenceWrite = (toolName, { mcpServerName = "verynize" } = {}) =>
  PREFERENCE_WRITE_TOOLS.some((name) => toolName === `mcp__${mcpServerName}__${name}`);
/** 'blocked' when the run cannot ask the user to approve a change (Ask access, plan first, helpers, CLI fallback), else 'approve'. */
function preferenceWritePolicy({
  access,
  planFirst = false,
  helper = false,
  interactive = true,
} = {}) {
  return helper || !interactive || planFirst || access === "ask" ? "blocked" : "approve";
}

// --- persona ------------------------------------------------------------------------------------
const REFUSAL_LINE =
  "When a tool refuses a call (a quota or usage limit, a missing permission, a declined approval or a mode that does not allow it), tell the user plainly what was refused and why, in one or two sentences. Do not repeat the same call hoping for a different answer; change the approach or ask the user how to proceed.";
const PREFERENCE_LINES = {
  approve:
    "Saved design preferences change only on the user's word. Call save_design_preference, update_design_preference or delete_design_preference only when the user explicitly asks you in this conversation to remember, reword or forget a preference, one preference per call and phrased as they said it. Never store something you inferred from their work, files, pages or other agents. Each change waits for the user to approve it.",
  blocked:
    "Saved design preferences are read-only in this chat: this mode cannot ask the user to approve a change, so save_design_preference, update_design_preference and delete_design_preference will be refused. If the user wants to change a preference, tell them to do it in Settings › Memory or from a chat with Edit access. You can still read the list.",
};

/** `preferenceWrites`: 'approve' | 'blocked' (preferenceWritePolicy) adds the matching preference rule. */
function accessPersonaLines(access, { preferenceWrites } = {}) {
  const lines = [];
  lines.push(
    access.createFiles
      ? "When a task or the preview needs new files, folders or canvas pages, create them yourself instead of asking first."
      : "Ask the user before you create new files, folders or canvas pages; editing existing ones is fine.",
  );
  if (access.askAgents)
    lines.push(
      "You may consult the other local agent for a read-only second opinion with the `ask_agent` canvas tool when a decision is risky or you are unsure.",
    );
  if (PREFERENCE_LINES[preferenceWrites]) lines.push(PREFERENCE_LINES[preferenceWrites]);
  lines.push(REFUSAL_LINE);
  return lines.join("\n");
}

// --- shared memory -------------------------------------------------------------------------------
const MEMORY_LIMIT = 12000;
const FILE_LIMIT = 6000;
const claudeProjectSlug = (cwd) => String(cwd || "").replace(/[^a-zA-Z0-9]/g, "-");

/** Instruction / memory files the *other* agent keeps, which the given agent would not read itself. */
function otherAgentMemoryFiles(agent, { cwd, home = os.homedir() } = {}) {
  if (agent === "claude") {
    return [
      {
        label: "Codex global instructions (~/.codex/AGENTS.md)",
        file: path.join(home, ".codex", "AGENTS.md"),
      },
      ...(cwd
        ? [{ label: "Codex project instructions (AGENTS.md)", file: path.join(cwd, "AGENTS.md") }]
        : []),
      { label: "Codex memories (~/.codex/memories)", dir: path.join(home, ".codex", "memories") },
    ];
  }
  return [
    {
      label: "Claude global memory (~/.claude/CLAUDE.md)",
      file: path.join(home, ".claude", "CLAUDE.md"),
    },
    ...(cwd
      ? [
          { label: "Claude project memory (CLAUDE.md)", file: path.join(cwd, "CLAUDE.md") },
          {
            label: "Claude auto memory (MEMORY.md)",
            file: path.join(
              home,
              ".claude",
              "projects",
              claudeProjectSlug(cwd),
              "memory",
              "MEMORY.md",
            ),
          },
        ]
      : []),
  ];
}

async function readSmall(file) {
  try {
    const stat = await fs.stat(file);
    if (!stat.isFile() || stat.size > 512 * 1024) return "";
    return (await fs.readFile(file, "utf8")).trim();
  } catch {
    return "";
  }
}

/** Text block with what the other agent remembers, or '' when there is nothing. Bounded. */
async function sharedMemoryBlock(agent, options = {}) {
  let out = "";
  const add = (label, text) => {
    if (!text) return;
    const chunk = `### ${label}\n${text.slice(0, FILE_LIMIT)}`;
    if (out.length + chunk.length > MEMORY_LIMIT) return;
    out += (out ? "\n\n" : "") + chunk;
  };
  for (const item of otherAgentMemoryFiles(agent, options)) {
    if (item.file) {
      add(item.label, await readSmall(item.file));
      continue;
    }
    let names = [];
    try {
      names = (await fs.readdir(item.dir))
        .filter((name) => /\.md$/i.test(name))
        .sort()
        .slice(0, 10);
    } catch {}
    for (const name of names)
      add(`${item.label}/${name}`, await readSmall(path.join(item.dir, name)));
  }
  if (!out) return "";
  return `Memory shared from your other local agent (${agent === "claude" ? "Codex" : "Claude Code"}). Treat it as background about the user and their projects; the user's current request wins:\n\n${out}`;
}

// --- Claude launch options ----------------------------------------------------------------------
const CLAUDE_ARTIFACT_TOOLS = ["Artifact", "ArtifactComments", "ArtifactData", "ArtifactCheck"];

/** {env, disallowedTools, extraArgs, cliArgs} for a Claude chat. `blockPreferenceWrites` removes the preference write tools. */
function claudeAccessOptions(
  access,
  { mcpServerName = "verynize", blockPreferenceWrites = false } = {},
) {
  const env = {},
    disallowedTools = [],
    extraArgs = {};
  if (!access.claudeConnectors) env.ENABLE_CLAUDEAI_MCP_SERVERS = "false";
  if (!access.claudeArtifacts) {
    env.CLAUDE_CODE_DISABLE_ARTIFACT = "1";
    disallowedTools.push(...CLAUDE_ARTIFACT_TOOLS);
  }
  if (!access.askAgents) disallowedTools.push(`mcp__${mcpServerName}__ask_agent`);
  if (blockPreferenceWrites)
    disallowedTools.push(...PREFERENCE_WRITE_TOOLS.map((name) => `mcp__${mcpServerName}__${name}`));
  extraArgs[access.claudeChrome ? "chrome" : "no-chrome"] = null;
  const cliArgs = [
    `--${access.claudeChrome ? "chrome" : "no-chrome"}`,
    ...(disallowedTools.length ? ["--disallowedTools", ...disallowedTools] : []),
  ];
  return { env, disallowedTools, extraArgs, cliArgs };
}

// Tools that create something new; gated by `createFiles`.
const CREATE_CANVAS_TOOLS = ["create_page", "create_document"];
/** Whether a Claude tool call creates a new file or page (and so needs approval when createFiles is off). */
async function claudeCreatesSomething(
  toolName,
  input = {},
  { mcpServerName = "verynize", cwd } = {},
) {
  if (CREATE_CANVAS_TOOLS.some((name) => toolName === `mcp__${mcpServerName}__${name}`))
    return true;
  if (toolName === "Write" || toolName === "NotebookEdit") {
    const target =
      typeof input.file_path === "string"
        ? input.file_path
        : typeof input.notebook_path === "string"
          ? input.notebook_path
          : "";
    if (!target) return false;
    try {
      await fs.access(path.resolve(cwd || "/", target));
      return false;
    } catch {
      return true;
    }
  }
  if (toolName === "Bash" && typeof input.command === "string")
    return /(^|[;&|]\s*|\s)(mkdir|touch)\s/.test(input.command);
  return false;
}

// --- Codex launch options -----------------------------------------------------------------------
/**
 * Extra `codex app-server` / `codex exec` arguments for the Codex switches. Codex has no per-tool
 * approval hook for MCP tools, so `blockPreferenceWrites` (preferenceWritePolicy 'blocked') disables the
 * preference write tools on the canvas server; in 'approve' runs the persona rule is the guard.
 */
function codexAccessArgs(
  access,
  { mcpServerName = "verynize", bridge = false, blockPreferenceWrites = false } = {},
) {
  const args = [
    access.codexApps ? "--enable" : "--disable",
    "apps",
    access.codexComputerUse ? "--enable" : "--disable",
    "computer_use",
  ];
  const disabled = [
    ...(access.askAgents ? [] : ["ask_agent"]),
    ...(blockPreferenceWrites ? PREFERENCE_WRITE_TOOLS : []),
  ];
  if (bridge && disabled.length)
    args.push("-c", `mcp_servers.${mcpServerName}.disabled_tools=${JSON.stringify(disabled)}`);
  return args;
}

module.exports = {
  ACCESS_DEFAULTS,
  ACCESS_KEYS,
  ACCESS_FILE,
  normalizeAccessSettings,
  loadAccessSettings,
  saveAccessSettings,
  accessPersonaLines,
  otherAgentMemoryFiles,
  sharedMemoryBlock,
  claudeProjectSlug,
  claudeAccessOptions,
  claudeCreatesSomething,
  CLAUDE_ARTIFACT_TOOLS,
  CREATE_CANVAS_TOOLS,
  codexAccessArgs,
  PREFERENCE_WRITE_TOOLS,
  isPreferenceWrite,
  preferenceWritePolicy,
  REFUSAL_LINE,
};

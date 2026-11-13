/**
 * Slash commands for the chat composer ("Runs in this chat" list)
 * ================================================================
 * Lists the commands an agent can run from the composer and expands Codex custom prompts / skills before a turn starts.
 *
 *   scanCommands(agent, {home, cwd, env}) -> [{name, description, argumentHint, source, path?}]
 *     Claude: ~/.claude/commands/**.md (sub folders become `ns:name`), ~/.claude/skills/<name>/SKILL.md and the same
 *             folders under <cwd>/.claude. Claude Code runs these itself when the prompt starts with `/name`.
 *     Codex:  $CODEX_HOME|~/.codex/prompts/*.md (as `prompts:name`, like the Codex CLI), ~/.codex/skills/<name>/SKILL.md
 *             and <cwd>/.codex/skills. Codex's app-server does not expand them, so expandCodexCommand() does.
 *   mergeCommands(...lists)  first list wins per name; later lists only fill in missing descriptions / hints.
 *   expandCodexCommand(prompt, {home, cwd, env}) -> prompt with a leading `/prompts:name args` (or `/name args` for a
 *     prompt or skill) replaced by the prompt body ($ARGUMENTS, $1…$9, $$) or a skill instruction; anything else is
 *     returned unchanged.
 *
 * IPC (registered by registerAgentCommands, via main.cjs `handle()`):
 *   listAgentCommands({agent, root?}) -> {commands}   root: the chat's folder (repository or worktree), optional.
 *     Claude also merges the SDK's own list (Query.supportedCommands(), plus `slash_commands` seen in init messages)
 *     through runtime.claudeCommands(cwd).
 */
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const MAX_COMMANDS = 400;
const MAX_FILE = 256 * 1024;
const NAME = /^[a-zA-Z0-9][\w.:-]{0,80}$/;

const codexHome = (home, env = process.env) =>
  env.CODEX_HOME && home === os.homedir() ? env.CODEX_HOME : path.join(home, ".codex");
const clean = (value, limit = 300) =>
  String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit);

/** Minimal front matter reader: `key: value` lines between leading `---` fences (quotes stripped). */
function frontMatter(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  const data = {};
  if (!match) return { data, body: text };
  for (const line of match[1].split(/\r?\n/)) {
    const pair = /^([A-Za-z][\w-]*)\s*:\s*(.*)$/.exec(line);
    if (!pair) continue;
    let value = pair[2].trim();
    if (/^(['"]).*\1$/.test(value)) value = value.slice(1, -1);
    if (value === ">" || value === "|") value = "";
    data[pair[1].toLowerCase()] = value;
  }
  return { data, body: text.slice(match[0].length) };
}

const firstLine = (body) =>
  clean(
    body
      .split(/\r?\n/)
      .map((l) => l.replace(/^#+\s*/, "").trim())
      .find(Boolean) || "",
  );

async function readText(file) {
  try {
    const stat = await fs.stat(file);
    if (!stat.isFile() || stat.size > MAX_FILE) return null;
    return await fs.readFile(file, "utf8");
  } catch {
    return null;
  }
}

async function listDir(dir) {
  try {
    return await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

/** `<dir>/**.md` command files; nested folders become `a:b` names (Claude Code's namespacing). */
async function markdownCommands(dir, source, { prefix = "", depth = 0, namespace = true } = {}) {
  const out = [];
  for (const entry of await listDir(dir)) {
    if (entry.name.startsWith(".")) continue;
    const file = path.join(dir, entry.name);
    if (entry.isDirectory() && namespace && depth < 3)
      out.push(
        ...(await markdownCommands(file, source, {
          prefix: prefix + entry.name + ":",
          depth: depth + 1,
        })),
      );
    else if (entry.isFile() && entry.name.endsWith(".md")) {
      const name = prefix + entry.name.slice(0, -3);
      const text = await readText(file);
      if (text === null || !NAME.test(name)) continue;
      const { data, body } = frontMatter(text);
      out.push({
        name,
        description: clean(data.description) || firstLine(body),
        argumentHint: clean(data["argument-hint"], 120),
        source,
        path: file,
      });
    }
  }
  return out;
}

/** `<dir>/<name>/SKILL.md` skills. */
async function skills(dir, source) {
  const out = [];
  for (const entry of await listDir(dir)) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const file = path.join(dir, entry.name, "SKILL.md");
    const text = await readText(file);
    if (text === null) continue;
    const { data, body } = frontMatter(text);
    const name = NAME.test(data.name || "") ? data.name : entry.name;
    if (!NAME.test(name)) continue;
    out.push({
      name,
      description: clean(data.description) || firstLine(body),
      argumentHint: clean(data["argument-hint"], 120),
      source,
      path: file,
    });
  }
  return out;
}

function mergeCommands(...lists) {
  const byName = new Map();
  for (const list of lists) {
    for (const item of list || []) {
      if (!item || !NAME.test(item.name || "")) continue;
      const known = byName.get(item.name);
      if (!known)
        byName.set(item.name, {
          name: item.name,
          description: clean(item.description),
          argumentHint: clean(item.argumentHint, 120),
          source: item.source || "agent",
          ...(item.path ? { path: item.path } : {}),
        });
      else {
        if (!known.description && item.description) known.description = clean(item.description);
        if (!known.argumentHint && item.argumentHint)
          known.argumentHint = clean(item.argumentHint, 120);
      }
    }
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name)).slice(0, MAX_COMMANDS);
}

async function validCwd(cwd) {
  if (typeof cwd !== "string" || !path.isAbsolute(cwd) || cwd.includes("\0")) return null;
  try {
    return (await fs.stat(cwd)).isDirectory() ? cwd : null;
  } catch {
    return null;
  }
}

async function scanCommands(agent, { home = os.homedir(), cwd = null, env = process.env } = {}) {
  const dir = await validCwd(cwd);
  if (agent === "claude") {
    return mergeCommands(
      dir ? await markdownCommands(path.join(dir, ".claude", "commands"), "project") : [],
      dir ? await skills(path.join(dir, ".claude", "skills"), "project-skill") : [],
      await markdownCommands(path.join(home, ".claude", "commands"), "user"),
      await skills(path.join(home, ".claude", "skills"), "skill"),
    );
  }
  if (agent === "codex") {
    const codex = codexHome(home, env);
    const prompts = (
      await markdownCommands(path.join(codex, "prompts"), "prompt", { namespace: false })
    ).map((c) => ({ ...c, name: "prompts:" + c.name }));
    return mergeCommands(
      prompts,
      dir ? await skills(path.join(dir, ".codex", "skills"), "project-skill") : [],
      await skills(path.join(codex, "skills"), "skill"),
    );
  }
  return [];
}

/** Splits `a "b c" d` into positional arguments. */
function splitArgs(text) {
  const out = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m;
  while ((m = re.exec(text))) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}

function fillPrompt(body, args) {
  const positional = splitArgs(args);
  return body.replace(/\$(\$|ARGUMENTS|[1-9])/g, (_, key) =>
    key === "$" ? "$" : key === "ARGUMENTS" ? args : (positional[Number(key) - 1] ?? ""),
  );
}

const LEADING = /^\/([a-zA-Z0-9][\w.:-]{0,80})(?:[ \t]+([\s\S]*))?$/;

async function expandCodexCommand(prompt, options = {}) {
  if (typeof prompt !== "string") return prompt;
  const [head, ...rest] = prompt.split(
    /\n\n(?=<attached-|<linked-|<figma-|<terminal-output|Open file |Attachment )/,
  );
  const match = LEADING.exec(head.trimEnd());
  if (!match) return prompt;
  const commands = await scanCommands("codex", options);
  const wanted = match[1],
    args = (match[2] || "").trim();
  const command =
    commands.find((c) => c.name === wanted) ||
    commands.find((c) => c.source === "prompt" && c.name === "prompts:" + wanted);
  if (!command?.path) return prompt;
  const tail = rest.length ? "\n\n" + rest.join("\n\n") : "";
  if (command.source === "prompt") {
    const text = await readText(command.path);
    if (text === null) return prompt;
    return fillPrompt(frontMatter(text).body.trim(), args) + tail;
  }
  return (
    `Use the "${command.name}" skill: read ${command.path} and follow its instructions.${args ? "\n\n" + args : ""}` +
    tail
  );
}

function registerAgentCommands(handle, { getRuntime, home = null } = {}) {
  handle("listAgentCommands", async (options = {}) => {
    const agent = options?.agent;
    if (!["claude", "codex"].includes(agent)) throw Error("Choose Codex or Claude");
    const runtime = getRuntime?.();
    const base = home || runtime?.home || os.homedir();
    const cwd = await validCwd(options.root);
    const files = await scanCommands(agent, { home: base, cwd });
    if (agent !== "claude" || !runtime?.claudeCommands) return { commands: files };
    const sdk = await runtime.claudeCommands(cwd).catch(() => []);
    return { commands: mergeCommands(sdk, files) };
  });
}

module.exports = {
  scanCommands,
  mergeCommands,
  expandCodexCommand,
  frontMatter,
  fillPrompt,
  registerAgentCommands,
};

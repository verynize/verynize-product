/**
 * "Allowed without asking" rules from every agent (Settings › Agents)
 * ====================================================================
 * Collects the rules saved with "don't ask again" in three places and removes single entries:
 *   - Verynize: <userData>/agent-allow-rules.json, per project (read/removed through the runtime's AllowRules)
 *   - Claude Code: `permissions.allow` in ~/.claude/settings.json and <repo>/.claude/settings{,.local}.json
 *   - Codex: `prefix_rule(pattern=[...], decision="allow")` lines in ~/.codex/rules/*.rules (and <repo>/.codex/rules)
 *
 * The renderer never names files: list() returns opaque ids and remove(id)/fileFor(groupId) recompute the
 * list and act only on entries found there. Removal edits exactly one entry and leaves the rest of the file
 * as it was (Codex: the rule's own text and its line break; Claude: one array element, same indentation).
 */
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { createHash, randomBytes } = require("node:crypto");

const hash = (...parts) => createHash("sha256").update(parts.join("\0")).digest("hex").slice(0, 24);
const readText = async (file) => {
  try {
    return await fs.readFile(file, "utf8");
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "ENOTDIR") return null;
    throw error;
  }
};

async function writeAtomic(file, text) {
  let mode = 0o600;
  try {
    mode = (await fs.stat(file)).mode & 0o777;
  } catch {}
  const temp = `${file}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  await fs.writeFile(temp, text, { mode });
  await fs.rename(temp, file);
}

/* ---------- Codex rules (Starlark subset) ---------- */

/** Reads one Starlark string literal at `i`; returns [value, nextIndex] or null. */
function readString(text, i) {
  const quote = text[i];
  if (quote !== '"' && quote !== "'") return null;
  let out = "";
  for (let j = i + 1; j < text.length; j++) {
    const c = text[j];
    if (c === "\\") {
      const n = text[++j];
      out += n === "n" ? "\n" : n === "t" ? "\t" : n;
      continue;
    }
    if (c === quote) return [out, j + 1];
    if (c === "\n") return null;
    out += c;
  }
  return null;
}
const skipSpace = (text, i) => {
  while (i < text.length && /\s/.test(text[i])) i++;
  return i;
};

/** Parses a value: string, list of values, or a bare identifier (True/False/None). */
function readValue(text, i) {
  i = skipSpace(text, i);
  if (text[i] === '"' || text[i] === "'") return readString(text, i);
  if (text[i] === "[") {
    const list = [];
    i = skipSpace(text, i + 1);
    while (i < text.length && text[i] !== "]") {
      const item = readValue(text, i);
      if (!item) return null;
      list.push(item[0]);
      i = skipSpace(text, item[1]);
      if (text[i] === ",") i = skipSpace(text, i + 1);
      else if (text[i] !== "]") return null;
    }
    return text[i] === "]" ? [list, i + 1] : null;
  }
  const word = /^[A-Za-z_][A-Za-z0-9_]*/.exec(text.slice(i));
  return word ? [word[0], i + word[0].length] : null;
}

/** Every `prefix_rule(...)` call: {start, end, raw, line, pattern, decision}. `end` includes the line break. */
function parseCodexRules(text) {
  const rules = [];
  const re = /prefix_rule\s*\(/g;
  let match;
  while ((match = re.exec(String(text)))) {
    const lineStart = text.lastIndexOf("\n", match.index) + 1;
    if (text.slice(lineStart, match.index).trim()) continue; // only calls that start a line (no comments / nesting)
    let i = match.index + match[0].length;
    const args = {};
    let ok = true;
    for (;;) {
      i = skipSpace(text, i);
      if (text[i] === ")") {
        i++;
        break;
      }
      const key = /^[A-Za-z_][A-Za-z0-9_]*/.exec(text.slice(i));
      if (!key) {
        ok = false;
        break;
      }
      i = skipSpace(text, i + key[0].length);
      if (text[i] !== "=") {
        ok = false;
        break;
      }
      const value = readValue(text, i + 1);
      if (!value) {
        ok = false;
        break;
      }
      args[key[0]] = value[0];
      i = skipSpace(text, value[1]);
      if (text[i] === ",") i++;
      else if (text[i] !== ")") {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    let end = i;
    while (end < text.length && (text[end] === " " || text[end] === "\t")) end++;
    if (text[end] === "\r") end++;
    if (text[end] === "\n") end++;
    const raw = text.slice(match.index, i);
    const line = text.slice(0, match.index).split("\n").length;
    rules.push({
      start: lineStart,
      end,
      raw,
      line,
      pattern: Array.isArray(args.pattern) ? args.pattern : [],
      decision: typeof args.decision === "string" ? args.decision : "allow",
    });
    re.lastIndex = i;
  }
  return rules;
}

const token = (part) => (Array.isArray(part) ? part.map(String).join(" / ") : String(part));
function describeCodexRule(pattern) {
  const words = (Array.isArray(pattern) ? pattern : []).map(token).filter(Boolean);
  return words.length ? `Commands that start with “${words.join(" ")}”` : "Every command";
}

/** Text with one rule (matched by its exact raw text and occurrence) removed. Throws when it is gone. */
function removeCodexRule(text, raw, occurrence = 0) {
  const matches = parseCodexRules(text).filter((r) => r.raw === raw);
  const rule = matches[occurrence] ?? matches[0];
  if (!rule) throw Error("That rule is no longer in the file");
  return text.slice(0, rule.start) + text.slice(rule.end);
}

/* ---------- Claude Code permission rules ---------- */
const RULE = /^([^()\s]+)(?:\(([\s\S]*)\))?$/;
const quote = (text) => `“${text}”`;

/** Human text for a Claude-style rule ("Bash(npm test:*)", "Read(./src/**)", "mcp__github__get_issue", "WebFetch(domain:x)"). */
function describeRule(rule) {
  const match = RULE.exec(String(rule).trim());
  if (!match) return String(rule);
  const [, tool, spec] = match;
  if (tool.startsWith("mcp__")) {
    const [, server, name] = tool.split("__");
    return !name || name === "*"
      ? `Every tool from the ${server} MCP server`
      : `${name} from the ${server} MCP server`;
  }
  const command = ["Bash", "shell", "PowerShell"].includes(tool);
  if (spec === undefined || spec === "*" || spec === "")
    return command ? "Every command" : tool === "WebSearch" ? "Web searches" : `Every ${tool} call`;
  if (command) {
    const prefix = /^(.*?)(?::\*|\s*\*)$/.exec(spec);
    return prefix
      ? `Commands that start with ${quote(prefix[1].trim())}`
      : `The command ${quote(spec)}`;
  }
  if (tool === "WebFetch" && spec.startsWith("domain:")) return `Fetching from ${spec.slice(7)}`;
  if (tool === "Read") return `Reading ${spec}`;
  if (tool === "Edit" || tool === "Write" || tool === "MultiEdit") return `Editing ${spec}`;
  return `${tool} ${quote(spec)}`;
}

function detectIndent(text) {
  const match = /\n([ \t]+)"/.exec(text);
  return match ? match[1] : 2;
}

/** Settings text with one exact `permissions.allow` entry removed (formatting kept: indentation and final newline). */
function removeClaudeAllow(text, rule) {
  const data = JSON.parse(text);
  const allow = data?.permissions?.allow;
  const index = Array.isArray(allow) ? allow.indexOf(rule) : -1;
  if (index < 0) throw Error("That rule is no longer in the file");
  allow.splice(index, 1);
  return JSON.stringify(data, null, detectIndent(text)) + (text.endsWith("\n") ? "\n" : "");
}

async function claudeAllow(file) {
  const text = await readText(file);
  if (text === null) return null;
  try {
    const allow = JSON.parse(text)?.permissions?.allow;
    return Array.isArray(allow) ? allow.filter((r) => typeof r === "string") : [];
  } catch {
    return [];
  }
}

async function codexRuleFiles(dir) {
  try {
    return (await fs.readdir(dir))
      .filter((n) => n.endsWith(".rules"))
      .sort()
      .map((n) => path.join(dir, n));
  } catch {
    return [];
  }
}

/* ---------- Listing ---------- */

/**
 * Groups of rules. `repositories`: [{name, root}]; `verynize`: {projectKey: [rule]} from AllowRules.list();
 * `scopeOf(projectKey)`: optional async name lookup for Verynize project keys (worktrees → repository name).
 */
async function listAllowGroups({
  home = os.homedir(),
  repositories = [],
  verynize = {},
  verynizeFile = "",
  scopeOf,
} = {}) {
  const groups = [];
  const add = (group, rules) => {
    if (rules.length)
      groups.push({ ...group, id: hash(group.agent, group.file, group.key || ""), rules });
  };

  // Verynize's own rules, one group per project.
  for (const [key, rules] of Object.entries(verynize || {})) {
    if (!Array.isArray(rules) || !rules.length) continue;
    const scope =
      key === "unattached"
        ? "Quick chats"
        : (await Promise.resolve(scopeOf?.(key)).catch(() => null)) || path.basename(key);
    add(
      { agent: "verynize", scope, global: false, file: verynizeFile, key, location: "Verynize" },
      rules.map((rule) => ({
        id: hash("verynize", key, rule),
        title: describeRule(rule),
        raw: rule,
      })),
    );
  }

  // Claude Code: user settings, then each repository's shared and local settings.
  const claudeFile = async (file, scope, global) => {
    const allow = await claudeAllow(file);
    if (allow)
      add(
        { agent: "claude", scope, global, file },
        allow.map((rule, i) => ({
          id: hash(
            "claude",
            file,
            rule,
            String(allow.slice(0, i).filter((r) => r === rule).length),
          ),
          title: describeRule(rule),
          raw: rule,
        })),
      );
  };
  await claudeFile(path.join(home, ".claude", "settings.json"), "Every repository", true);
  // Codex: user rules, then repository rules.
  const codexDir = async (dir, scope, global) => {
    for (const file of await codexRuleFiles(dir)) {
      const text = await readText(file);
      if (text === null) continue;
      const seen = new Map();
      const rules = [];
      for (const rule of parseCodexRules(text)) {
        const n = seen.get(rule.raw) || 0;
        seen.set(rule.raw, n + 1);
        if (rule.decision !== "allow") continue;
        rules.push({
          id: hash("codex", file, rule.raw, String(n)),
          title: describeCodexRule(rule.pattern),
          raw: rule.raw,
          occurrence: n,
          line: rule.line,
        });
      }
      add({ agent: "codex", scope, global, file }, rules);
    }
  };
  await codexDir(path.join(home, ".codex", "rules"), "Every repository", true);
  const seenRoots = new Set();
  for (const repo of repositories) {
    if (!repo?.root || seenRoots.has(repo.root)) continue;
    seenRoots.add(repo.root);
    await claudeFile(path.join(repo.root, ".claude", "settings.json"), repo.name, false);
    await claudeFile(path.join(repo.root, ".claude", "settings.local.json"), repo.name, false);
    await codexDir(path.join(repo.root, ".codex", "rules"), repo.name, false);
  }
  return groups;
}

/** Removes the rule with `id` from the groups `list` returned. `removeVerynize(key, rule)` handles Verynize's own. */
async function removeAllowRule(groups, id, { removeVerynize } = {}) {
  for (const group of groups) {
    const rule = group.rules.find((r) => r.id === id);
    if (!rule) continue;
    if (group.agent === "verynize") {
      if (!removeVerynize) throw Error("Verynize rules cannot be removed here");
      return { removed: !!(await removeVerynize(group.key, rule.raw)) };
    }
    const text = await readText(group.file);
    if (text === null) throw Error("That file no longer exists");
    const next =
      group.agent === "claude"
        ? removeClaudeAllow(text, rule.raw)
        : removeCodexRule(text, rule.raw, rule.occurrence);
    await writeAtomic(group.file, next);
    return { removed: true };
  }
  throw Error("That rule is no longer saved");
}

module.exports = {
  parseCodexRules,
  describeCodexRule,
  removeCodexRule,
  describeRule,
  removeClaudeAllow,
  listAllowGroups,
  removeAllowRule,
};

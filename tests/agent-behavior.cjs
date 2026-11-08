// Settings › Agents behaviour (desktop/agent-behavior.cjs) and "Allowed without asking" sources
// (desktop/agent-permissions.cjs). Every file lives in a temp dir: the real ~/.claude and ~/.codex are never read or written.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const permissions = require("../desktop/agent-permissions.cjs");
const behavior = require("../desktop/agent-behavior.cjs");
const { AgentRuntime, AllowRules, claudeQueryOptions } = require("../desktop/agent-runtime.cjs");
const { argumentsFor } = require("../desktop/agent-settings.cjs");
const { RepositoryRegistry } = require("../desktop/repositories.cjs");

const CHAT = "11111111-2222-3333-4444-555555555555";
async function tempDir(t, prefix = "agent-behavior-") {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), prefix)));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}

const CODEX_RULES = `# Saved by Codex
prefix_rule(pattern=["npm", "test"], decision="allow")
prefix_rule(pattern=["git", ["status", "diff"]], decision="allow")
# prefix_rule(pattern=["commented"], decision="allow")
prefix_rule(
    pattern = ["rm", "-rf"],
    decision = "forbidden",
)
prefix_rule(pattern=['cargo', 'build'], decision="allow", justification="builds")
prefix_rule(pattern=["npm", "test"], decision="allow")
`;

test("Codex rules: prefix_rule lines parse to patterns, decisions and human text; comments are ignored", () => {
  const rules = permissions.parseCodexRules(CODEX_RULES);
  assert.deepEqual(
    rules.map((r) => r.pattern),
    [
      ["npm", "test"],
      ["git", ["status", "diff"]],
      ["rm", "-rf"],
      ["cargo", "build"],
      ["npm", "test"],
    ],
  );
  assert.deepEqual(
    rules.map((r) => r.decision),
    ["allow", "allow", "forbidden", "allow", "allow"],
  );
  assert.equal(rules[0].raw, 'prefix_rule(pattern=["npm", "test"], decision="allow")');
  assert.equal(rules[0].line, 2);
  assert.equal(
    permissions.describeCodexRule(rules[0].pattern),
    "Commands that start with “npm test”",
  );
  assert.equal(
    permissions.describeCodexRule(rules[1].pattern),
    "Commands that start with “git status / diff”",
  );
});

test("Codex rules: removing one rule leaves every other byte (including a duplicate and the multi-line rule) in place", () => {
  const raw = 'prefix_rule(pattern=["npm", "test"], decision="allow")';
  const second = permissions.removeCodexRule(CODEX_RULES, raw, 1);
  assert.equal(
    second,
    CODEX_RULES.replace(/prefix_rule\(pattern=\["npm", "test"\], decision="allow"\)\n$/, ""),
  );
  const first = permissions.removeCodexRule(CODEX_RULES, raw, 0);
  assert.equal(first, CODEX_RULES.replace(raw + "\n", ""));
  assert.match(first, /pattern = \["rm", "-rf"\]/);
  assert.match(first, /# prefix_rule\(pattern=\["commented"\]/);
  assert.throws(
    () =>
      permissions.removeCodexRule(CODEX_RULES, 'prefix_rule(pattern=["nope"], decision="allow")'),
    /no longer/,
  );
  // Without a final newline the rule's own text still goes and nothing else.
  assert.equal(
    permissions.removeCodexRule(
      'a = 1\nprefix_rule(pattern=["x"], decision="allow")',
      'prefix_rule(pattern=["x"], decision="allow")',
    ),
    "a = 1\n",
  );
});

test("Claude rules: human text and removal of one permissions.allow entry keeps the rest of settings.json", () => {
  assert.equal(
    permissions.describeRule("Bash(npm run test:*)"),
    "Commands that start with “npm run test”",
  );
  assert.equal(
    permissions.describeRule("Bash(git status *)"),
    "Commands that start with “git status”",
  );
  assert.equal(permissions.describeRule("Bash(git status)"), "The command “git status”");
  assert.equal(permissions.describeRule("Bash"), "Every command");
  assert.equal(permissions.describeRule("WebFetch(domain:github.com)"), "Fetching from github.com");
  assert.equal(
    permissions.describeRule("mcp__github__get_issue"),
    "get_issue from the github MCP server",
  );
  assert.equal(
    permissions.describeRule("mcp__verynize__*"),
    "Every tool from the verynize MCP server",
  );
  assert.equal(permissions.describeRule("Read(./src/**)"), "Reading ./src/**");
  const text =
    '{\n    "model": "opus",\n    "permissions": {\n        "allow": [\n            "Bash(npm test:*)",\n            "WebSearch"\n        ],\n        "deny": ["Bash(rm:*)"]\n    },\n    "hooks": {}\n}\n';
  const next = permissions.removeClaudeAllow(text, "Bash(npm test:*)");
  const parsed = JSON.parse(next);
  assert.deepEqual(parsed.permissions.allow, ["WebSearch"]);
  assert.deepEqual(parsed.permissions.deny, ["Bash(rm:*)"]);
  assert.equal(parsed.model, "opus");
  assert.deepEqual(Object.keys(parsed), ["model", "permissions", "hooks"]);
  assert.match(next, /^\{\n {4}"model"/, "indentation kept");
  assert.ok(next.endsWith("}\n"), "final newline kept");
  assert.throws(() => permissions.removeClaudeAllow(text, "Bash(other)"), /no longer/);
});

test("allowed rules: groups by scope and agent across Verynize, Claude Code and Codex; trash removes exactly that entry", async (t) => {
  const home = await tempDir(t),
    repoRoot = path.join(home, "work", "site"),
    userData = path.join(home, "userData");
  await fs.mkdir(path.join(home, ".claude"), { recursive: true });
  await fs.mkdir(path.join(home, ".codex", "rules"), { recursive: true });
  await fs.mkdir(path.join(repoRoot, ".claude"), { recursive: true });
  const userSettings = path.join(home, ".claude", "settings.json");
  await fs.writeFile(
    userSettings,
    JSON.stringify(
      {
        outputStyle: "Explanatory",
        permissions: { allow: ["Bash(npm test:*)", "WebSearch"], defaultMode: "default" },
      },
      null,
      2,
    ) + "\n",
  );
  const local = path.join(repoRoot, ".claude", "settings.local.json");
  await fs.writeFile(
    local,
    JSON.stringify({ permissions: { allow: ["Bash(make build)"] } }, null, 2),
  );
  const rulesFile = path.join(home, ".codex", "rules", "default.rules");
  await fs.writeFile(rulesFile, CODEX_RULES);
  const allowRules = new AllowRules(path.join(userData, "agent-allow-rules.json"));
  await allowRules.add(repoRoot, "Bash(npm run lint*)");
  await allowRules.add("unattached", "WebFetch");

  const list = () =>
    permissions.listAllowGroups({
      home,
      repositories: [{ name: "site", root: repoRoot }],
      verynize: allowRules.data,
      verynizeFile: allowRules.file,
      scopeOf: (key) => (key === repoRoot ? "site" : null),
    });
  let groups = await list();
  const summary = groups.map((g) => [g.agent, g.scope, g.global, g.rules.map((r) => r.title)]);
  assert.deepEqual(summary, [
    ["verynize", "site", false, ["Commands that start with “npm run lint”"]],
    ["verynize", "Quick chats", false, ["Every WebFetch call"]],
    ["claude", "Every repository", true, ["Commands that start with “npm test”", "Web searches"]],
    [
      "codex",
      "Every repository",
      true,
      [
        "Commands that start with “npm test”",
        "Commands that start with “git status / diff”",
        "Commands that start with “cargo build”",
        "Commands that start with “npm test”",
      ],
    ],
    ["claude", "site", false, ["The command “make build”"]],
  ]);
  assert.equal(groups.find((g) => g.agent === "codex").file, rulesFile);
  assert.ok(
    groups.every((g) => g.rules.every((r) => /^[0-9a-f]{24}$/.test(r.id))),
    "opaque ids only",
  );

  // Codex: the second "npm test" duplicate goes, the first stays.
  const codexGroup = groups.find((g) => g.agent === "codex");
  await permissions.removeAllowRule(groups, codexGroup.rules[3].id);
  assert.equal(
    await fs.readFile(rulesFile, "utf8"),
    CODEX_RULES.replace(/prefix_rule\(pattern=\["npm", "test"\], decision="allow"\)\n$/, ""),
  );
  groups = await list();
  await permissions.removeAllowRule(groups, groups.find((g) => g.agent === "codex").rules[1].id);
  assert.doesNotMatch(await fs.readFile(rulesFile, "utf8"), /"git"/);
  assert.match(await fs.readFile(rulesFile, "utf8"), /forbidden/);

  // Claude user settings: one entry, other keys untouched.
  groups = await list();
  await permissions.removeAllowRule(
    groups,
    groups.find((g) => g.agent === "claude" && g.global).rules[0].id,
  );
  assert.deepEqual(JSON.parse(await fs.readFile(userSettings, "utf8")), {
    outputStyle: "Explanatory",
    permissions: { allow: ["WebSearch"], defaultMode: "default" },
  });
  // Repository local settings.
  groups = await list();
  await permissions.removeAllowRule(
    groups,
    groups.find((g) => g.agent === "claude" && !g.global).rules[0].id,
  );
  assert.deepEqual(JSON.parse(await fs.readFile(local, "utf8")).permissions.allow, []);

  // Verynize's own rules go through AllowRules (its cache stays right).
  groups = await list();
  const own = groups.find((g) => g.agent === "verynize" && g.scope === "site");
  const result = await permissions.removeAllowRule(groups, own.rules[0].id, {
    removeVerynize: (key, rule) => allowRules.remove(key, rule),
  });
  assert.deepEqual(result, { removed: true });
  assert.equal(await allowRules.matches(repoRoot, "Bash", { command: "npm run lint" }), false);
  await assert.rejects(
    permissions.removeAllowRule(await list(), "f".repeat(24)),
    /no longer saved/,
  );
});

test("behaviour store: validates, persists and resets per-repository modes", async (t) => {
  const dir = await tempDir(t);
  const file = path.join(dir, "agent-behavior.json");
  const store = new behavior.AgentBehaviorStore({ file });
  assert.deepEqual(await store.get(), { ...behavior.DEFAULTS, repoModes: {} });
  await store.set({
    followUp: "steer",
    expandWork: true,
    claudeOutputStyle: "Learning",
    codexPersonality: "none",
    creditAgent: false,
    branchPrefix: " adam/ ",
    repoModes: { "repo-1": "full", "repo-2": "ask" },
  });
  await store.set({ repoModes: { "repo-2": null } });
  const reopened = new behavior.AgentBehaviorStore({ file });
  const saved = await reopened.get();
  assert.equal(saved.followUp, "steer");
  assert.equal(saved.expandWork, true);
  assert.equal(saved.branchPrefix, "adam");
  assert.deepEqual(saved.repoModes, { "repo-1": "full" });
  await assert.rejects(store.set({ followUp: "later" }), /Steer or Queue/);
  await assert.rejects(store.set({ branchPrefix: "bad..prefix" }), /branch prefix/);
  await assert.rejects(store.set({ branchPrefix: "has space" }), /branch prefix/);
  await assert.rejects(store.set({ repoModes: { "repo-1": "root" } }), /Ask, Edit/);
  await assert.rejects(store.set({ folder: "relative/dir" }), /folder/);
  assert.equal((await store.get()).followUp, "steer", "a rejected change leaves the saved values");
});

test("runtime options: Claude settings (output style, attribution) and Codex personality", () => {
  assert.equal(
    behavior.claudeSettingsFor(behavior.DEFAULTS),
    null,
    "defaults leave the user’s Claude Code settings alone",
  );
  assert.deepEqual(
    behavior.claudeSettingsFor({
      ...behavior.DEFAULTS,
      claudeOutputStyle: "Explanatory",
      creditAgent: false,
    }),
    { outputStyle: "Explanatory", attribution: { commit: "", pr: "" }, includeCoAuthoredBy: false },
  );
  assert.equal(behavior.codexPersonalityFor(behavior.DEFAULTS), null);
  assert.equal(behavior.codexPersonalityFor({ codexPersonality: "none" }), "none");
  const options = claudeQueryOptions({
    cwd: "/p",
    access: "edit",
    persona: "P",
    claudeSettings: { outputStyle: "Learning" },
  });
  assert.deepEqual(options.settings, { outputStyle: "Learning" });
  assert.equal(claudeQueryOptions({ cwd: "/p", access: "edit", persona: "P" }).settings, undefined);
  const claudeArgs = argumentsFor("claude", {
    access: "ask",
    claudeSettings: { outputStyle: "Learning" },
  });
  assert.equal(claudeArgs[claudeArgs.indexOf("--settings") + 1], '{"outputStyle":"Learning"}');
  const codexArgs = argumentsFor("codex", { access: "ask", codexPersonality: "none" });
  assert.ok(codexArgs.join(" ").includes('-c personality="none"'));
  assert.ok(!argumentsFor("codex", { access: "ask" }).join(" ").includes("personality"));
});

test("runtime: behaviour reaches the Claude SDK settings and Codex thread/start personality", async (t) => {
  const root = await tempDir(t);
  const codex = path.join(root, "codex");
  await fs.copyFile(path.join(__dirname, "fixtures/fake-codex.cjs"), codex);
  await fs.chmod(codex, 0o755);
  const log = path.join(root, "codex.log");
  process.env.FAKE_CODEX_LOG = log;
  const record = {};
  const sdk = {
    query({ prompt, options }) {
      record.options = options;
      return (async function* () {
        await prompt[Symbol.asyncIterator]().next();
        yield { type: "system", subtype: "init", session_id: "s1", model: "m" };
        yield { type: "result", subtype: "success", result: "ok", session_id: "s1" };
      })();
    },
  };
  let current = {
    ...behavior.DEFAULTS,
    claudeOutputStyle: "Explanatory",
    creditAgent: false,
    codexPersonality: "none",
  };
  const events = [];
  const runtime = new AgentRuntime({
    userData: path.join(root, "userData"),
    discover: async () => [
      { id: "codex", available: true, path: codex },
      { id: "claude", available: true, path: "/usr/bin/true" },
    ],
    loadClaudeSdk: async () => sdk,
    getBridge: async () => null,
    loadPreferences: async () => [],
    getBehavior: async () => current,
    emit: (event) => events.push(event),
  });
  t.after(() => runtime.close());
  const done = (chatId) =>
    new Promise((resolve, reject) => {
      const end = Date.now() + 8000;
      const poll = () => {
        const hit = events.find((e) => e.type === "done" && e.chatId === chatId);
        if (hit) return resolve(hit);
        if (Date.now() > end) return reject(Error("timeout"));
        setTimeout(poll, 5);
      };
      poll();
    });
  await runtime.run({ agent: "claude", chatId: CHAT, prompt: "hello", access: "edit" });
  await done(CHAT);
  // A quick chat also carries its shared memory folder (Settings › Memory); the behaviour keys sit beside it.
  const { autoMemoryDirectory, ...behaviour } = record.options.settings;
  assert.match(autoMemoryDirectory, /agent-memory/);
  assert.deepEqual(behaviour, {
    outputStyle: "Explanatory",
    attribution: { commit: "", pr: "" },
    includeCoAuthoredBy: false,
  });
  const codexChat = "22222222-2222-3333-4444-555555555555";
  await runtime.run({ agent: "codex", chatId: codexChat, prompt: "hello", access: "edit" });
  await done(codexChat);
  const calls = (await fs.readFile(log, "utf8")).trim().split("\n").map(JSON.parse);
  assert.equal(calls.find((c) => c.rpc === "thread/start").params.personality, "none");
  current = { ...behavior.DEFAULTS };
  const third = "33333333-2222-3333-4444-555555555555";
  await runtime.run({ agent: "claude", chatId: third, prompt: "hello again", access: "edit" });
  await done(third);
  assert.deepEqual(
    Object.keys(record.options.settings ?? {}).filter((k) => k !== "autoMemoryDirectory"),
    [],
    '"Use my Claude Code setting" sends no behaviour settings',
  );
});

test("output styles: built-ins plus custom ~/.claude/output-styles, and the current Claude Code setting", async (t) => {
  const home = await tempDir(t);
  await fs.mkdir(path.join(home, ".claude", "output-styles"), { recursive: true });
  await fs.writeFile(
    path.join(home, ".claude", "output-styles", "terse.md"),
    "---\nname: Terse Reviewer\ndescription: Short: to the point\n---\nBody",
  );
  await fs.writeFile(path.join(home, ".claude", "output-styles", "plain.md"), "No frontmatter");
  await fs.writeFile(
    path.join(home, ".claude", "settings.json"),
    JSON.stringify({ outputStyle: "Terse Reviewer" }),
  );
  const { styles, current } = await behavior.outputStyles({ home });
  assert.deepEqual(
    styles.map((s) => s.id),
    ["default", "Explanatory", "Learning", "plain", "Terse Reviewer"],
  );
  assert.equal(styles.find((s) => s.id === "Terse Reviewer").description, "Short: to the point");
  assert.equal(current, "Terse Reviewer");
});

test("commit author: git identity, GitHub link check, graceful without gh", async () => {
  const runner =
    (emails, login = "octo") =>
    async (cmd, args) => {
      if (cmd === "git")
        return { "user.name": "Ada Lovelace", "user.email": "ada@example.com" }[args.at(-1)] ?? "";
      if (args[1] === "user") {
        if (!login) throw Error("gh: not logged in");
        return login;
      }
      if (args[1] === "user/emails") {
        if (!emails) throw Error("HTTP 404");
        return emails.join("\n");
      }
      throw Error("unexpected");
    };
  const fresh = (r) => behavior.commitAuthor({ runner: r });
  assert.deepEqual(await fresh(runner(["ada@example.com"])), {
    name: "Ada Lovelace",
    email: "ada@example.com",
    login: "octo",
    linked: true,
  });
  assert.equal((await fresh(runner(["other@example.com"]))).linked, false);
  assert.equal((await fresh(runner(null))).linked, null, "no user:email scope: no warning");
  assert.deepEqual(await fresh(runner([], "")), {
    name: "Ada Lovelace",
    email: "ada@example.com",
    login: null,
    linked: null,
  });
});

test('branch prefix: setting, then VERYNIZE_BRANCH_PREFIX, then GitHub username, then "verynize"', async () => {
  assert.equal(
    await behavior.resolveBranchPrefix(
      { branchPrefix: "team/adam" },
      { env: {}, login: async () => "Octo" },
    ),
    "team/adam",
  );
  assert.equal(
    await behavior.resolveBranchPrefix(
      { branchPrefix: "" },
      { env: { VERYNIZE_BRANCH_PREFIX: "ci" }, login: async () => "Octo" },
    ),
    "ci",
  );
  assert.equal(
    await behavior.resolveBranchPrefix(
      { branchPrefix: "" },
      { env: {}, login: async () => "Octo" },
    ),
    "octo",
  );
  assert.equal(
    await behavior.resolveBranchPrefix({ branchPrefix: "" }, { env: {}, login: async () => "" }),
    "verynize",
  );
  assert.equal(
    behavior.workspacesOf({ folder: "/x/Verynize" }, {}),
    path.join("/x/Verynize", "workspaces"),
  );
  assert.equal(
    behavior.workspacesOf({ folder: "" }, { VERYNIZE_HOME_DIR: "/h" }),
    path.join("/h", "workspaces"),
  );
  assert.equal(behavior.workspacesOf({ folder: "/x" }, { VERYNIZE_WORKSPACES_DIR: "/w" }), "/w");
});

test("worktrees: new ones use the chosen folder and branch prefix; existing ones stay where they are", async (t) => {
  const base = await tempDir(t);
  const repo = path.join(base, "site");
  await fs.mkdir(repo);
  const git = (...args) =>
    execFileSync("git", ["-C", repo, ...args], {
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "T",
        GIT_AUTHOR_EMAIL: "t@example.com",
        GIT_COMMITTER_NAME: "T",
        GIT_COMMITTER_EMAIL: "t@example.com",
      },
    });
  git("init", "-q");
  await fs.writeFile(path.join(repo, "a.txt"), "a");
  git("add", ".");
  git("commit", "-qm", "init");
  const settings = { folder: path.join(base, "first"), branchPrefix: "adam" };
  const registry = new RepositoryRegistry({
    file: path.join(base, "repositories.json"),
    workspacesRoot: async () => behavior.workspacesOf(settings, {}),
    branchPrefix: async () =>
      behavior.resolveBranchPrefix(settings, { env: {}, login: async () => "" }),
  });
  const added = await registry.add(repo);
  const one = await registry.createChatWorktree(added.id, "chat-aaaaaa");
  assert.match(one.branch, /^adam\/[a-z]+(-[0-9a-f]{4})?$/);
  assert.equal(path.dirname(one.path), path.join(base, "first", "workspaces", "site"));
  settings.folder = path.join(base, "second");
  settings.branchPrefix = "";
  const two = await registry.createChatWorktree(added.id, "chat-bbbbbb");
  assert.match(two.branch, /^verynize\//);
  assert.equal(path.dirname(two.path), path.join(base, "second", "workspaces", "site"));
  assert.equal(
    (await registry.createChatWorktree(added.id, "chat-aaaaaa")).path,
    one.path,
    "the first chat keeps its worktree",
  );
  assert.equal((await registry.resolveRoot(one.path)).worktree.branch, one.branch);
});

// Composer slash commands (desktop/agent-commands.cjs) and their runtime handling (desktop/agent-runtime.cjs): command
// files in a temp agent home (never the real ~/.claude or ~/.codex), Codex prompt/skill expansion, Claude commands sent
// as typed (no context preamble), SDK supportedCommands() merged with the files, extra working directories.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const {
  scanCommands,
  expandCodexCommand,
  fillPrompt,
  frontMatter,
  mergeCommands,
} = require("../desktop/agent-commands.cjs");
const { AgentRuntime } = require("../desktop/agent-runtime.cjs");

async function write(file, text) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, text);
}

async function fixture(t) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "agent-commands-")));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const home = path.join(root, "home"),
    project = path.join(root, "project");
  await write(
    path.join(home, ".claude/commands/fix-issue.md"),
    '---\ndescription: "Fix an issue"\nargument-hint: <number>\n---\nFix $ARGUMENTS\n',
  );
  await write(path.join(home, ".claude/commands/git/commit.md"), "# Commit staged work\n");
  await write(
    path.join(home, ".claude/skills/tidy/SKILL.md"),
    "---\nname: tidy\ndescription: Tidy a module\n---\n",
  );
  await write(path.join(home, ".claude/skills/no-skill-file/notes.md"), "ignored");
  await write(
    path.join(project, ".claude/commands/fix-issue.md"),
    "---\ndescription: Project fix flow\n---\n",
  );
  await write(
    path.join(project, ".claude/skills/ship/SKILL.md"),
    "---\ndescription: Ship the project\n---\n",
  );
  await write(
    path.join(home, ".codex/prompts/draftpr.md"),
    '---\ndescription: Draft a PR\nargument-hint: <title>\n---\nPR "$1": $ARGUMENTS ($$)\n',
  );
  await write(
    path.join(home, ".codex/skills/polish/SKILL.md"),
    "---\nname: polish\ndescription: Polish UI\n---\n",
  );
  return { root, home, project };
}

test("front matter, argument filling and merging", () => {
  assert.deepEqual(
    frontMatter("---\ndescription: 'Quoted'\nargument-hint: <a> [b]\n---\nBody").data,
    { description: "Quoted", "argument-hint": "<a> [b]" },
  );
  assert.equal(
    fillPrompt("$1 / $2 / $ARGUMENTS / $3 / $$", 'one "two words"'),
    'one / two words / one "two words" /  / $',
  );
  const merged = mergeCommands(
    [{ name: "a", description: "", source: "builtin" }],
    [{ name: "a", description: "From file", argumentHint: "<x>" }, { name: "bad name!" }],
  );
  assert.deepEqual(merged, [
    { name: "a", description: "From file", argumentHint: "<x>", source: "builtin" },
  ]);
});

test("Claude and Codex command files are read from the agent home and the chat folder", async (t) => {
  const { home, project } = await fixture(t);
  const claude = await scanCommands("claude", { home, cwd: project });
  const byName = Object.fromEntries(claude.map((c) => [c.name, c]));
  assert.deepEqual(Object.keys(byName).sort(), ["fix-issue", "git:commit", "ship", "tidy"]);
  assert.equal(
    byName["fix-issue"].description,
    "Project fix flow",
    "project commands win over user commands",
  );
  assert.equal(
    byName["git:commit"].description,
    "Commit staged work",
    "sub folders are namespaced; description falls back to the first line",
  );
  const codex = await scanCommands("codex", { home, cwd: project, env: {} });
  assert.deepEqual(
    codex.map((c) => [c.name, c.description, c.argumentHint]),
    [
      ["polish", "Polish UI", ""],
      ["prompts:draftpr", "Draft a PR", "<title>"],
    ],
  );
  assert.deepEqual(
    await scanCommands("claude", { home: path.join(home, "missing"), cwd: "/nonexistent" }),
    [],
  );
});

test("Codex: custom prompts and skills are expanded, anything else is left alone", async (t) => {
  const { home, project } = await fixture(t);
  const opts = { home, cwd: project, env: {} };
  assert.equal(
    await expandCodexCommand("/prompts:draftpr Launch now", opts),
    'PR "Launch": Launch now ($)',
  );
  assert.equal(
    await expandCodexCommand("/draftpr Launch", opts),
    'PR "Launch": Launch ($)',
    "the prompts: prefix is optional",
  );
  assert.equal(
    await expandCodexCommand('/draftpr Go\n\n<attached-file path="a">x</attached-file>', opts),
    'PR "Go": Go ($)\n\n<attached-file path="a">x</attached-file>',
    "attachments stay after the body",
  );
  assert.match(
    await expandCodexCommand("/polish the header", opts),
    /^Use the "polish" skill: read .*polish\/SKILL\.md and follow its instructions\.\n\nthe header$/,
  );
  assert.equal(await expandCodexCommand("/unknown thing", opts), "/unknown thing");
  assert.equal(await expandCodexCommand("not a command", opts), "not a command");
});

function commandSdk(record) {
  return {
    query({ prompt, options }) {
      record.options = options;
      const gen = (async function* () {
        if (typeof prompt === "object" && prompt[Symbol.asyncIterator]) {
          const iterator = prompt[Symbol.asyncIterator]();
          const first = (await iterator.next()).value;
          if (!first) return;
          record.message = first;
          yield {
            type: "system",
            subtype: "init",
            session_id: "s1",
            model: "fake",
            slash_commands: ["compact", "fix-issue", "from-init"],
          };
          yield {
            type: "result",
            subtype: "success",
            is_error: false,
            result: "ok",
            session_id: "s1",
            usage: { input_tokens: 1, output_tokens: 1 },
          };
          await iterator.next();
        }
      })();
      gen.interrupt = async () => {};
      gen.close = () => {};
      gen.supportedCommands = async () => {
        record.listed = (record.listed || 0) + 1;
        return [
          {
            name: "compact",
            description: "Compact the conversation",
            argumentHint: "<instructions>",
            builtin: true,
          },
          { name: "tidy", description: "", argumentHint: "" },
        ];
      };
      return gen;
    },
  };
}

test("runtime: Claude slash commands are sent as typed, directories become additionalDirectories, SDK commands merge", async (t) => {
  const { root, home, project } = await fixture(t);
  const record = {};
  const events = [];
  const runtime = new AgentRuntime({
    userData: path.join(root, "userData"),
    home,
    discover: async () => [{ id: "claude", available: true, path: "/usr/bin/true" }],
    loadClaudeSdk: async () => commandSdk(record),
    getBridge: async () => null,
    loadPreferences: async () => [],
    emit: (event) => events.push(event),
  });
  t.after(() => runtime.close());
  const done = () =>
    new Promise((resolve, reject) => {
      const end = Date.now() + 8000;
      const poll = () =>
        events.some((e) => e.type === "done")
          ? resolve()
          : Date.now() > end
            ? reject(Error("no done"))
            : setTimeout(poll, 5);
      poll();
    });
  await runtime.run({
    agent: "claude",
    chatId: "11111111-2222-3333-4444-555555555555",
    prompt: "/fix-issue 12",
    access: "full",
    context: { pageId: "page-1", selection: [] },
    directories: [project, "/", os.homedir(), path.join(root, "missing")],
  });
  await done();
  assert.equal(
    record.message.message.content,
    "/fix-issue 12",
    "no context preamble before a slash command",
  );
  assert.deepEqual(
    record.options.additionalDirectories,
    [project],
    "only existing folders, never / or $HOME",
  );
  // Commands from the init message are remembered for the chat folder; supportedCommands() fills in the rest.
  const cwd = (await runtime.workdir("11111111-2222-3333-4444-555555555555")).cwd;
  assert.deepEqual(
    (await runtime.claudeCommands(cwd)).map((c) => c.name),
    ["compact", "tidy"],
  );
  assert.equal(record.listed, 1);
  await runtime.claudeCommands(cwd);
  assert.equal(record.listed, 1, "cached");
});

test("runtime: extra directories reach the turn context and Codex writable roots", async (t) => {
  const { home, project } = await fixture(t);
  const {
    codexThreadParams,
    buildTurnContext,
    normalizeContext,
  } = require("../desktop/agent-runtime.cjs");
  assert.deepEqual(
    codexThreadParams({ cwd: "/w", access: "edit", persona: "p", directories: [project] }).config,
    { "sandbox_workspace_write.writable_roots": [project] },
  );
  assert.equal(codexThreadParams({ cwd: "/w", access: "edit", persona: "p" }).config, undefined);
  assert.equal(
    codexThreadParams({ cwd: "/w", access: "full", persona: "p", directories: [project] }).config,
    undefined,
    "full access has no sandbox to widen",
  );
  const ctx = {
    ...normalizeContext({ pageId: "p1", selection: [] }, home),
    directories: [project],
  };
  assert.match(
    buildTurnContext(ctx),
    new RegExp(
      `Additional working directories[^\n]*\n- ${project.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\n</verynize-context>`,
    ),
  );
});

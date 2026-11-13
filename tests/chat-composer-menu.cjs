// Chat composer "+" menu and slash commands in Electron (web/src/islands/chat/attach-menu.tsx, slash-commands.tsx;
// desktop/chat-attachments.cjs, desktop/agent-commands.cjs, desktop/terminal.cjs) against the fake Codex app-server.
// The agent home (VERYNIZE_AGENT_HOME) is a temp folder with ~/.claude/commands|skills and ~/.codex/prompts|skills
// fixtures; the real ones are never read or written.
// Covers: menu structure (Wonder 32), Add file / Add folder copied into the chat worktree, Link a chat (transcript +
// worktree as a working directory, grouped by repository), New worktree, Terminal output, Design references (save the
// attached images as a collection, attach it again), Commands, the "Runs in this chat" list (filtering, keyboard,
// Claude + Codex sources), a Codex custom prompt expanded and sent, and the /add-dir built-in.
// CHAT_MENU_SHOT=/dir saves screenshots of the menu, submenus and command list.
const { waitForAsync } = require("./helpers/wait-for-async.cjs");
const { _electron } = require("@playwright/test");
const { waitForUiReady } = require("./helpers/ui-ready.cjs");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const identity = {
  GIT_AUTHOR_NAME: "Test",
  GIT_AUTHOR_EMAIL: "test@example.invalid",
  GIT_COMMITTER_NAME: "Test",
  GIT_COMMITTER_EMAIL: "test@example.invalid",
};
const git = (cwd, ...args) =>
  execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, ...identity },
  }).trim();
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

async function write(file, text) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, text);
}

(async () => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "chat-menu-")));
  const repo = path.join(root, "site"),
    workspaces = path.join(root, "workspaces"),
    bin = path.join(root, "bin"),
    log = path.join(root, "codex.log");
  const home = path.join(root, "home"),
    profile = path.join(root, "profile"),
    outside = path.join(root, "outside");
  await fs.mkdir(repo, { recursive: true });
  await fs.mkdir(bin);
  await fs.writeFile(path.join(repo, "index.html"), "<h1>Hello</h1>\n");
  git(repo, "init", "--initial-branch=main");
  git(repo, "add", ".");
  git(repo, "commit", "-m", "Initial");
  await fs.copyFile(path.join(__dirname, "fixtures/fake-codex.cjs"), path.join(bin, "codex"));
  await fs.chmod(path.join(bin, "codex"), 0o755);
  // Agent home fixtures.
  await write(
    path.join(home, ".claude/commands/fix-issue.md"),
    "---\ndescription: Fix a GitHub issue end to end\nargument-hint: <issue-number>\n---\nFix issue $ARGUMENTS.\n",
  );
  await write(
    path.join(home, ".claude/commands/frontend/component.md"),
    "# Scaffold a React component\nCreate $1.\n",
  );
  await write(
    path.join(home, ".claude/skills/tidy/SKILL.md"),
    "---\nname: tidy\ndescription: Tidy up a messy module without changing behaviour\n---\nSteps.\n",
  );
  await write(
    path.join(home, ".codex/prompts/draftpr.md"),
    '---\ndescription: Draft a pull request description\nargument-hint: <title> [scope]\n---\nDraft a PR titled "$1" covering: $ARGUMENTS (cost $$5).\n',
  );
  await write(
    path.join(home, ".codex/skills/polish/SKILL.md"),
    "---\nname: polish\ndescription: Polish the UI details\n---\nPolish.\n",
  );
  // Files to add to the worktree.
  await write(path.join(outside, "notes.txt"), "outside notes\n");
  await write(path.join(outside, "kit/readme.md"), "# kit\n");
  await write(path.join(outside, "kit/.git/HEAD"), "ref: refs/heads/main\n");
  await fs.mkdir(path.join(outside, "extra-dir"), { recursive: true });

  const env = {
    ...process.env,
    ...identity,
    PATH: bin + path.delimiter + process.env.PATH,
    FAKE_CODEX_LOG: log,
    VERYNIZE_WORKSPACES_DIR: workspaces,
    VERYNIZE_BRANCH_PREFIX: "verynize",
    VERYNIZE_AGENT_HOME: home,
  };
  delete env.ELECTRON_RUN_AS_NODE;
  env.VERYNIZE_SKIP_ONBOARDING = "1";
  delete env.CODEX_HOME;
  const turns = async () =>
    (await fs.readFile(log, "utf8").catch(() => ""))
      .trim()
      .split("\n")
      .filter(Boolean)
      .map(JSON.parse)
      .filter(
        (c) =>
          c.rpc === "turn/start" &&
          !/word title for a design chat/.test(JSON.stringify(c.params || {})),
      );
  const shots = process.env.CHAT_MENU_SHOT;
  await require("./helpers/chatgpt-provider.cjs").seedChatGPTAccount(profile);
  const app = await _electron.launch({
    env,
    args: [".", `--user-data-dir=${profile}`],
    timeout: 20000,
  });
  try {
    const page = await app.firstWindow({ timeout: 20000 });
    await waitForUiReady(page);
    await page.setViewportSize({ width: 1440, height: 870 });
    await page.waitForSelector("#project-toggle", { state: "attached" });
    const state = () => page.evaluate(() => window.agentWorkspace.getState());
    const pickPaths = (paths) =>
      app.evaluate(
        ({ dialog }, list) =>
          (dialog.showOpenDialog = async () => ({ canceled: false, filePaths: list })),
        paths,
      );
    const completed = (n) =>
      page.waitForFunction(
        (n) => window.agentWorkspace.getUsage().completed === n && !window.agentWorkspace.isBusy(),
        n,
        { timeout: 15000 },
      );
    const openMenu = async () => {
      // Wait for the previous menu's exit animation (a click during it would toggle the menu shut again).
      if (await page.locator("[role=menu]").count()) await page.keyboard.press("Escape");
      await page.locator("[role=menu]").first().waitFor({ state: "detached" });
      await page.locator("#chat-attach-menu").click();
      await page.locator("[role=menu]").first().waitFor();
    };
    // capturePage (not page.screenshot, whose viewport emulation dismisses open submenus).
    const shot = async (name) => {
      if (!shots) return;
      await fs.mkdir(shots, { recursive: true });
      const png = await app.evaluate(async ({ BrowserWindow }) =>
        (await BrowserWindow.getAllWindows()[0].webContents.capturePage())
          .toPNG()
          .toString("base64"),
      );
      await fs.writeFile(path.join(shots, name + ".png"), Buffer.from(png, "base64"));
    };

    // Repository with a first chat (its own worktree).
    await page.evaluate(() =>
      window.agentWorkspace.setDefaults({ agent: "codex", access: "edit", model: "" }),
    );
    await page.evaluate(() => window.agentWorkspace.openProject());
    await pickPaths([repo]);
    await page.locator("#code-add-repository").click();
    await page.locator("#project-open").click();
    await page.waitForFunction(() => {
      const s = window.agentWorkspace.getState();
      return s.branch && s.activeRoot && s.activeRoot === s.chatRoot;
    });
    const first = await state();
    await page.locator("#project-prompt").fill("Build the hero");
    await page.locator("#project-run").click();
    await completed(1);

    // 1. Menu structure, in Wonder's order.
    await openMenu();
    const menuText = (await page.locator("[role=menu]").first().innerText())
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    assert.deepEqual(menuText, [
      "Add to this worktree",
      "Add file",
      "Add folder",
      "Link a chat or worktree",
      "Attach to this message",
      "Files and images",
      "Terminal output",
      "Figma design",
      "Design references",
      "Commands",
    ]);
    await shot("menu");

    // 2. Add file / Add folder copy into the chat's worktree (folders without .git).
    await pickPaths([path.join(outside, "notes.txt")]);
    await page.locator("#chat-add-file").click();
    await page.waitForFunction(() =>
      /Added notes\.txt/.test(window.agentWorkspace.getState().status || ""),
    );
    assert.equal(
      await fs.readFile(path.join(first.chatRoot, "notes.txt"), "utf8"),
      "outside notes\n",
    );
    await pickPaths([path.join(outside, "notes.txt")]);
    await openMenu();
    await page.locator("#chat-add-file").click();
    await page.waitForFunction(() =>
      /Added notes 2\.txt/.test(window.agentWorkspace.getState().status || ""),
    );
    await pickPaths([path.join(outside, "kit")]);
    await openMenu();
    await page.locator("#chat-add-folder").click();
    await page.waitForFunction(() =>
      /Added kit/.test(window.agentWorkspace.getState().status || ""),
    );
    assert.equal(await fs.readFile(path.join(first.chatRoot, "kit/readme.md"), "utf8"), "# kit\n");
    await assert.rejects(
      fs.access(path.join(first.chatRoot, "kit/.git")),
      "the copied folder leaves out .git",
    );
    await assert.rejects(
      fs.access(path.join(repo, "notes.txt")),
      "the repository checkout is untouched",
    );

    // 3. Link a chat or worktree: a second chat links the first (transcript + its worktree as a working directory).
    await page.evaluate(() => window.codeWorkspace.newChat());
    await page.waitForFunction((id) => {
      const s = window.agentWorkspace.getState();
      return (
        s.conversationId && s.conversationId !== id && s.chatRoot && s.activeRoot === s.chatRoot
      );
    }, first.conversationId);
    const second = await state();
    await openMenu();
    await page.locator("#chat-link-trigger").hover();
    await page.locator(`[data-link-chat="${first.conversationId}"]`).waitFor();
    const sub = (await page.locator("[role=menu]").last().innerText())
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    assert.deepEqual(
      sub,
      ["site", "Build the hero", "New worktree"],
      "grouped by repository, the current chat left out",
    );
    await shot("link");
    await page.locator(`[data-link-chat="${first.conversationId}"]`).click();
    await page.waitForFunction(() =>
      window.agentWorkspace.getState().attachments.some((a) => a.kind === "chat"),
    );
    assert.deepEqual((await state()).directories, [first.chatRoot]);
    assert.equal(
      await page
        .getByRole("button", { name: `Remove working directory ${first.chatRoot}` })
        .count(),
      1,
      "working directory chip",
    );
    // New worktree: a fresh worktree of the repository, linked as another working directory.
    await openMenu();
    await page.locator("#chat-link-trigger").hover();
    await page.locator("#chat-link-new-worktree").click();
    await page.waitForFunction(() => window.agentWorkspace.getState().directories?.length === 2);
    const linked = (await state()).directories[1];
    assert.equal(path.dirname(linked), path.join(workspaces, "site"));
    assert.ok(git(repo, "worktree", "list").includes(linked));

    // 4. Terminal output: recent output of a terminal in this worktree.
    const term = await page.evaluate(
      (cwd) => window.desktop.terminalCreate({ cwd, cols: 80, rows: 24 }),
      second.chatRoot,
    );
    await page.evaluate(
      (id) => window.desktop.terminalWrite({ id, data: "echo chat-menu-$((40+2))\r" }),
      term.id,
    );
    await waitForAsync(
      page,
      async (cwd) =>
        /chat-menu-42/.test((await window.desktop.terminalRecentOutput({ cwd }))?.text || ""),
      second.chatRoot,
      { timeout: 15000, interval: 300 },
    );
    await openMenu();
    await page.locator("#chat-attach-terminal").click();
    await page.waitForFunction(() =>
      window.agentWorkspace.getState().attachments.some((a) => a.kind === "terminal"),
    );
    await page.evaluate((id) => window.desktop.terminalKill({ id }), term.id);

    // Send: the transcript, terminal output and working directories reach the agent.
    await page.locator("#project-prompt").fill("Use the linked work");
    await page.locator("#project-run").click();
    await completed(2);
    const sent = (await turns()).at(-1).params.input[0].text;
    assert.match(sent, /<linked-chat title="Chat · Build the hero">[\s\S]*Build the hero/);
    assert.match(
      sent,
      /<terminal-output cwd="[^"]+">[\s\S]*chat-menu-42[\s\S]*<\/terminal-output>/,
    );
    assert.match(
      sent,
      new RegExp(
        `Additional working directories[^\\n]*\\n- ${first.chatRoot.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`,
      ),
    );

    // 5. Design references: save the attached images as a collection, then attach it again.
    await page.evaluate(
      (bytes) =>
        window.agentWorkspace.attachImages([
          new File([new Uint8Array(bytes)], "mood.png", { type: "image/png" }),
        ]),
      [...PNG],
    );
    await page.waitForFunction(() =>
      window.agentWorkspace.getState().attachments.some((a) => a.kind === "image"),
    );
    await page.evaluate(() => {
      window.askText = async () => "Moodboard";
    });
    await openMenu();
    await page.locator("#chat-references-trigger").hover();
    await page.locator("#chat-references-save").click();
    await page.waitForFunction(() =>
      /Saved “Moodboard” \(1 image\)/.test(window.agentWorkspace.getState().status || ""),
    );
    const saved = JSON.parse(
      await fs.readFile(path.join(profile, "design-references.json"), "utf8"),
    ).collections;
    assert.equal(saved.length, 1);
    const derivative = await page.evaluate(
      async (bytes) =>
        (
          await window.imageUpload.prepare(
            new Blob([new Uint8Array(bytes)], { type: "image/png" }),
            { purpose: "chat" },
          )
        ).src,
      [...PNG],
    );
    assert.deepEqual(
      await fs.readFile(path.join(profile, "design-references", saved[0].id, saved[0].images[0])),
      Buffer.from(derivative.split(",")[1], "base64"),
    );
    await page.evaluate(() => window.agentWorkspace.removeAttachment(0));
    await openMenu();
    await page.locator("#chat-references-trigger").hover();
    await page.locator(`[data-reference="${saved[0].id}"]`).waitFor();
    await shot("references");
    await page.locator(`[data-reference="${saved[0].id}"]`).click();
    await page.waitForFunction(
      () =>
        window.agentWorkspace.getState().attachments.filter((a) => a.kind === "image").length === 1,
    );
    assert.equal((await state()).attachments[0].name, "Moodboard 1");
    await page.evaluate(() => window.agentWorkspace.removeAttachment(0));

    // 6. Commands opens the list; "/" at the start of the prompt does too, filtered as you type.
    await page.locator("#project-prompt").fill("");
    await openMenu();
    await page.locator("#chat-open-commands").click();
    await page.locator("#chat-slash-commands").waitFor();
    assert.equal(await page.locator("#project-prompt").inputValue(), "/");
    assert.match(await page.locator("#chat-slash-commands").innerText(), /^Runs in this chat/);
    await page.locator('[data-command="prompts:draftpr"]').waitFor();
    const codexNames = await page
      .locator("#chat-slash-commands [data-command]")
      .evaluateAll((rows) => rows.map((r) => r.dataset.command));
    for (const name of ["add-dir", "add-file", "clear", "prompts:draftpr", "polish"])
      assert.ok(codexNames.includes(name), `Codex list has /${name}`);
    assert.ok(!codexNames.includes("fix-issue"), "Claude commands are not offered to Codex");
    assert.match(
      await page.locator('[data-command="prompts:draftpr"]').innerText(),
      /\/prompts:draftpr\s*<title> \[scope\] · Draft a pull request description/,
    );
    assert.match(
      await page.locator('[data-command="add-dir"]').innerText(),
      /Add a folder to this chat as a working directory/,
    );
    await page.locator("[role=menu]").first().waitFor({ state: "detached" });
    await shot("commands");
    await page.locator("#project-prompt").pressSequentially("dra");
    await page.waitForFunction(
      () => document.querySelectorAll("#chat-slash-commands [data-command]").length === 1,
    );
    await page.locator("#project-prompt").press("Enter");
    assert.equal(await page.locator("#project-prompt").inputValue(), "/prompts:draftpr ");
    assert.equal(
      await page.locator("[data-chat-command]").getAttribute("data-chat-command"),
      "prompts:draftpr",
      "the command shows as a badge",
    );
    assert.equal(
      await page.locator("#chat-slash-commands").count(),
      0,
      "the list closes once a command is chosen",
    );
    // Sending runs it: the Codex custom prompt is expanded with its arguments.
    // Text can go before and after the badge; sending moves the command to the front.
    await page.locator("#project-prompt").press("Home");
    await page.locator("#project-prompt").pressSequentially("Launch ");
    await page.locator("#project-prompt").press("End");
    await page.locator("#project-prompt").pressSequentially('"the hero"');
    assert.equal(
      await page.locator("#project-prompt").inputValue(),
      'Launch /prompts:draftpr "the hero"',
    );
    await shot("command-badge");
    // Enter sends.
    await page.locator("#project-prompt").press("Enter");
    await completed(3);
    assert.equal(await page.locator("[data-chat-command]").count(), 0, "sending clears the badge");
    const expanded = (await turns()).at(-1).params.input[0].text;
    assert.ok(
      expanded.endsWith('\n\nDraft a PR titled "Launch" covering: Launch "the hero" (cost $5).'),
      expanded.slice(-200),
    );
    assert.doesNotMatch(
      expanded,
      /prompts:draftpr/,
      "the command itself is replaced by the prompt body",
    );
    // Backspace right after a badge removes the whole command.
    await page.locator("#project-prompt").pressSequentially("/dra");
    await page.waitForFunction(
      () => document.querySelectorAll("#chat-slash-commands [data-command]").length === 1,
    );
    await page.locator("#project-prompt").press("Enter");
    await page.locator("#project-prompt").press("Backspace");
    await page.locator("#project-prompt").press("Backspace");
    assert.equal(await page.locator("#project-prompt").inputValue(), "");
    // Shift+Enter adds a line; Enter on an empty prompt does nothing.
    await page.locator("#project-prompt").press("Enter");
    assert.equal(await page.locator("#project-prompt").inputValue(), "");
    await page.locator("#project-prompt").pressSequentially("line one");
    await page.locator("#project-prompt").press("Shift+Enter");
    await page.locator("#project-prompt").pressSequentially("line two");
    assert.equal(await page.locator("#project-prompt").inputValue(), "line one\nline two");
    assert.equal((await turns()).length, 3, "Shift+Enter does not send");

    // Keyboard: ↑↓ move, Tab chooses, Escape closes.
    await page.locator("#project-prompt").fill("");
    await page.locator("#project-prompt").pressSequentially("/");
    await page.locator("#chat-slash-commands").waitFor();
    const firstRow = await page
      .locator("#chat-slash-commands [data-selected=true]")
      .getAttribute("data-command");
    await page.locator("#project-prompt").press("ArrowDown");
    const secondRow = await page
      .locator("#chat-slash-commands [data-selected=true]")
      .getAttribute("data-command");
    assert.notEqual(firstRow, secondRow);
    await page.locator("#project-prompt").press("ArrowUp");
    assert.equal(
      await page.locator("#chat-slash-commands [data-selected=true]").getAttribute("data-command"),
      firstRow,
    );
    await page.locator("#project-prompt").press("Escape");
    assert.equal(await page.locator("#chat-slash-commands").count(), 0);
    assert.equal(await page.locator("#project-prompt").inputValue(), "/", "Escape keeps the text");

    // 7. Built-in /add-dir runs in the app: the picked folder becomes a working directory.
    await page.locator("#project-prompt").fill("");
    await pickPaths([path.join(outside, "extra-dir")]);
    await page.locator("#project-prompt").pressSequentially("/add-d");
    await page.locator('[data-command="add-dir"][data-selected=true]').waitFor();
    await page.locator("#project-prompt").press("Tab");
    await page.waitForFunction(
      (dir) => window.agentWorkspace.getState().directories?.includes(dir),
      path.join(outside, "extra-dir"),
    );
    assert.equal(await page.locator("#project-prompt").inputValue(), "");

    // 8. Claude: its user/project commands and skills from the agent home (namespaced sub folders, hints).
    await page.evaluate(() => window.agentWorkspace.setDefaults({ agent: "claude" }));
    await page.locator("#project-prompt").fill("");
    await page.locator("#project-prompt").pressSequentially("/");
    await page.locator('[data-command="fix-issue"]').waitFor({ timeout: 15000 });
    const claudeNames = await page
      .locator("#chat-slash-commands [data-command]")
      .evaluateAll((rows) => rows.map((r) => r.dataset.command));
    for (const name of ["add-dir", "fix-issue", "frontend:component", "tidy"])
      assert.ok(claudeNames.includes(name), `Claude list has /${name}`);
    assert.ok(!claudeNames.includes("prompts:draftpr"), "Codex prompts are not offered to Claude");
    assert.match(
      await page.locator('[data-command="fix-issue"]').innerText(),
      /<issue-number> · Fix a GitHub issue end to end/,
    );
    assert.match(
      await page.locator('[data-command="frontend:component"]').innerText(),
      /Scaffold a React component/,
    );
    await page.locator("#project-prompt").press("Escape");
    await page.evaluate(() => window.agentWorkspace.setDefaults({ agent: "codex" }));

    // 9. Design style picker (style-picker.tsx): Wonder's composer toolbar has no style chip, so the picker opens only
    // from /style. "Auto" by default, lists window.desktop.designStylesList(), the pick is sent as the run's designStyle
    // (the runtime adds it to the turn context).
    assert.equal(
      await page.locator("#chat-style-picker").count(),
      0,
      "the composer has no Style chip",
    );
    const toolbarLabels = await page.locator("#project-prompt").evaluate((prompt) => {
      const composer = prompt.closest(".rounded-2xl");
      return [...composer.querySelectorAll("button")].map((b) =>
        `${b.getAttribute("aria-label") || ""} ${b.textContent}`.trim(),
      );
    });
    assert.ok(
      !toolbarLabels.some((label) => /\bstyle\b/i.test(label)),
      `no composer button mentions a style: ${toolbarLabels.join(" | ")}`,
    );
    const catalog = await page.evaluate(async () =>
      typeof window.desktop?.designStylesList === "function"
        ? await window.desktop.designStylesList()
        : null,
    );
    if (!catalog?.length) {
      assert.equal(
        await page.evaluate(() => window.chatDesignStyle?.get()),
        "",
        "without a style catalog no style is sent",
      );
      console.log("design style picker: skipped (this desktop build has no designStylesList)");
    } else {
      assert.equal(await page.evaluate(() => window.chatDesignStyle.get()), "", "Auto by default");
      const openStyles = async () => {
        await page.locator("#project-prompt").fill("");
        await page.locator("#project-prompt").pressSequentially("/sty");
        await page.locator('[data-command="style"][data-selected=true]').waitFor();
        await page.locator("#project-prompt").press("Enter");
        await page.locator("#chat-style-menu").waitFor();
        assert.equal(
          await page.locator("#project-prompt").inputValue(),
          "",
          "the /style command leaves no text behind",
        );
      };
      await openStyles();
      const rows = page.locator("#chat-style-menu [data-style-id]");
      await rows.nth(1).waitFor();
      assert.equal(await rows.count(), catalog.length + 1, "Auto plus every catalog style");
      assert.equal(
        await page.locator('#chat-style-menu [data-style-id=""]').getAttribute("aria-checked"),
        "true",
        "Auto is checked",
      );
      // Focus starts on the current choice (Auto).
      await page.waitForFunction(
        () =>
          document.activeElement?.closest("#chat-style-menu") &&
          document.activeElement.dataset.styleId === "",
      );
      // Anchored above the composer, like the slash command list.
      const menuBox = await page.locator("#chat-style-menu").boundingBox();
      const promptBox = await page.locator("#project-prompt").boundingBox();
      assert.ok(
        menuBox.y + menuBox.height <= promptBox.y + 1,
        "the style menu opens above the composer",
      );
      await shot("chat-style-menu");
      // Keyboard: ↓ moves to the first style, Enter picks it and closes the menu; focus returns to the prompt.
      await page.keyboard.press("ArrowDown");
      await page.waitForFunction(
        (id) => document.activeElement?.dataset.styleId === id,
        catalog[0].id,
      ); // ArrowDown reaches the first style
      await page.keyboard.press("Enter");
      await page.locator("#chat-style-menu").waitFor({ state: "detached" });
      assert.equal(
        await page.evaluate(() => window.chatDesignStyle.get()),
        catalog[0].id,
        "Enter picks the style",
      );
      assert.equal(
        await page.evaluate(() => document.activeElement?.id),
        "project-prompt",
        "focus returns to the prompt",
      );
      // Clicking a row picks too; the next run carries the choice.
      const choice = catalog.find((style) => style.id === "neo-brutalism") ?? catalog[0];
      await openStyles();
      assert.equal(
        await page
          .locator(`#chat-style-menu [data-style-id="${catalog[0].id}"]`)
          .getAttribute("aria-checked"),
        "true",
        "the menu shows the current choice",
      );
      await page.waitForFunction(
        (id) => document.activeElement?.dataset.styleId === id,
        catalog[0].id,
      ); // and focuses it
      await page.locator(`#chat-style-menu [data-style-id="${choice.id}"]`).click();
      await page.locator("#chat-style-menu").waitFor({ state: "detached" });
      assert.equal(await page.evaluate(() => window.chatDesignStyle.get()), choice.id);
      // Wait for the style menu's exit animation, as openMenu() does: the slash list opening above the composer moves
      // the layout under the pointer, and a still-mounted (closing) menu item takes focus from the prompt on pointer leave.
      await page.locator("#chat-style-menu").waitFor({ state: "detached" });
      const done = await page.evaluate(() => window.agentWorkspace.getUsage().completed);
      await page.locator("#project-prompt").fill("Restyle the hero");
      await page.locator("#project-prompt").press("Enter");
      await completed(done + 1);
      assert.ok(
        JSON.stringify((await turns()).at(-1).params).includes(choice.id),
        "the turn carries the chosen design style",
      );
      // Enter on Auto clears the choice.
      await openStyles();
      await page.locator('#chat-style-menu [data-style-id=""]').focus();
      await page.keyboard.press("Enter");
      await page.locator("#chat-style-menu").waitFor({ state: "detached" });
      assert.equal(await page.evaluate(() => window.chatDesignStyle.get()), "");
    }

    const race = await page.evaluate(
      async (bytes) => {
        while (window.agentWorkspace.getState().attachments.length)
          window.agentWorkspace.removeAttachment(0);
        const file = () => new File([new Uint8Array(bytes)], "race.png", { type: "image/png" });
        await Promise.all([
          window.agentWorkspace.attachImages(Array.from({ length: 7 }, file)),
          window.agentWorkspace.attachImages(Array.from({ length: 7 }, file)),
        ]);
        const count = window.agentWorkspace
          .getState()
          .attachments.filter((a) => a.kind === "image").length;
        while (window.agentWorkspace.getState().attachments.length)
          window.agentWorkspace.removeAttachment(0);
        await window.agentWorkspace.attachImages([
          new File(["bad"], "bad.png", { type: "image/png" }),
          file(),
        ]);
        return {
          count,
          partial: window.agentWorkspace.getState().attachments.filter((a) => a.kind === "image")
            .length,
        };
      },
      [...PNG],
    );
    assert.equal(race.count, 10, "concurrent batches reserve ten slots");
    assert.equal(race.partial, 1, "a failed image does not stop the batch");

    console.log("Chat composer + menu and slash commands passed");
  } finally {
    await app.close();
    await fs.rm(root, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
